-- S-13 AI card management and undo.
-- Accepted ADR-007/008 require owner/private/AI provenance validation before
-- the active-session guard and the canonical cards -> illustrations ->
-- ai_illustration_objects lock order for every destructive management path.

BEGIN;

CREATE INDEX cards_owner_private_created_id_idx
  ON public.cards (owner_user_id, created_at DESC, id DESC)
  WHERE visibility = 'private';

CREATE INDEX ai_import_items_owner_finalized_card_idx
  ON public.ai_import_items (owner_user_id, result_card_id, batch_id)
  WHERE status = 'finalized' AND result_card_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ai_s13_assert_managed_card(
  p_owner_user_id uuid,
  p_card_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE managed_item_id uuid;
BEGIN
  SELECT items.id INTO managed_item_id
  FROM public.ai_import_items AS items
  JOIN public.ai_import_batches AS batches
    ON batches.id = items.batch_id
   AND batches.owner_user_id = items.owner_user_id
  JOIN public.cards AS cards ON cards.id = items.result_card_id
  WHERE cards.id = p_card_id
    AND cards.owner_user_id = p_owner_user_id
    AND cards.visibility = 'private'
    AND items.owner_user_id = p_owner_user_id
    AND items.status = 'finalized'
    AND batches.source IN ('app_ai', 'remote_mcp')
  ORDER BY items.id
  LIMIT 1;
  IF managed_item_id IS NULL THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  RETURN managed_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ai_managed_cards(
  p_limit integer DEFAULT 20,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_deck_id uuid DEFAULT NULL,
  p_tag_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_created_from timestamptz DEFAULT NULL,
  p_created_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE actor_id uuid;
DECLARE result jsonb;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'authenticated' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  IF actor_id IS NULL THEN PERFORM public.ai_raise_import_error('UNAUTHORIZED'); END IF;
  IF p_limit NOT BETWEEN 1 AND 100
    OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
    OR p_source IS NOT NULL AND p_source NOT IN ('app_ai', 'remote_mcp')
    OR p_created_from IS NOT NULL AND p_created_to IS NOT NULL AND p_created_from >= p_created_to
  THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  IF p_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.decks d WHERE d.id = p_deck_id AND d.owner_user_id = actor_id
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  IF p_tag_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tags t WHERE t.id = p_tag_id AND t.owner_user_id = actor_id
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;

  WITH selected AS (
    SELECT c.id, c.front_text, c.back_text, c.skill, c.pattern,
      c.created_at, c.updated_at, b.source, b.id AS batch_id,
      i.id AS item_id, ill.id AS illustration_id, ill.status AS illustration_status
    FROM public.cards c
    JOIN public.ai_import_items i
      ON i.result_card_id = c.id AND i.owner_user_id = actor_id AND i.status = 'finalized'
    JOIN public.ai_import_batches b
      ON b.id = i.batch_id AND b.owner_user_id = actor_id
     AND b.source IN ('app_ai', 'remote_mcp')
    LEFT JOIN LATERAL (
      SELECT candidate.id,candidate.status
      FROM public.illustrations candidate
      WHERE candidate.owner_user_id=actor_id AND candidate.illustration_key=c.illustration_key
      ORDER BY candidate.id
      LIMIT 1
    ) ill ON true
    WHERE c.owner_user_id = actor_id AND c.visibility = 'private'
      AND (p_cursor_created_at IS NULL OR (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
      AND (p_deck_id IS NULL OR EXISTS (
        SELECT 1 FROM public.deck_cards dc WHERE dc.card_id = c.id AND dc.deck_id = p_deck_id
      ))
      AND (p_tag_id IS NULL OR EXISTS (
        SELECT 1 FROM public.card_tags ct WHERE ct.card_id = c.id AND ct.tag_id = p_tag_id
      ))
      AND (p_source IS NULL OR b.source = p_source)
      AND (p_created_from IS NULL OR c.created_at >= p_created_from)
      AND (p_created_to IS NULL OR c.created_at < p_created_to)
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT p_limit + 1
  ), enriched AS (
    SELECT s.*,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
        FROM public.deck_cards dc JOIN public.decks d ON d.id = dc.deck_id
        WHERE dc.card_id = s.id AND d.owner_user_id = actor_id), '[]'::jsonb) AS decks,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) ORDER BY t.display_name, t.id)
        FROM public.card_tags ct JOIN public.tags t ON t.id = ct.tag_id
        WHERE ct.card_id = s.id AND t.owner_user_id = actor_id), '[]'::jsonb) AS tags
    FROM selected s
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'frontText', e.front_text, 'backText', e.back_text,
      'skill', e.skill, 'pattern', e.pattern, 'createdAt', e.created_at,
      'updatedAt', e.updated_at, 'source', e.source, 'batchId', e.batch_id,
      'itemId', e.item_id, 'decks', e.decks, 'tags', e.tags,
      'illustration', CASE WHEN e.illustration_id IS NULL THEN NULL ELSE
        jsonb_build_object('id', e.illustration_id, 'status', e.illustration_status) END
    ) ORDER BY e.created_at DESC, e.id DESC), '[]'::jsonb),
    'hasMore', (SELECT count(*) > p_limit FROM selected)
  ) INTO result FROM enriched e;
  RETURN COALESCE(result, jsonb_build_object('items', '[]'::jsonb, 'hasMore', false));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_imported_card_internal(
  p_owner_user_id uuid, p_card_id uuid, p_patch jsonb, p_expected_updated_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE locked_card public.cards%ROWTYPE; DECLARE updated_card public.cards%ROWTYPE;
DECLARE next_skill text; DECLARE next_pattern text; DECLARE next_front text; DECLARE next_back text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb OR
    p_expected_updated_at IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_each(p_patch) e
      WHERE e.key NOT IN ('skill','pattern','frontText','backText') OR jsonb_typeof(e.value) <> 'string'
    ) THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  SELECT c.* INTO locked_card FROM public.cards c
  WHERE c.id=p_card_id AND c.owner_user_id=p_owner_user_id AND c.visibility='private' FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,p_card_id);
  IF locked_card.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text,1010));
  PERFORM public.ai_assert_card_inactive(p_card_id,p_owner_user_id);
  PERFORM 1 FROM public.ai_import_items i WHERE i.result_card_id=p_card_id AND i.owner_user_id=p_owner_user_id ORDER BY i.id FOR UPDATE;
  next_skill := CASE WHEN p_patch ? 'skill' THEN p_patch->>'skill' ELSE locked_card.skill END;
  next_pattern := CASE WHEN p_patch ? 'pattern' THEN p_patch->>'pattern' ELSE locked_card.pattern END;
  next_front := public.ai_normalize_display_text(CASE WHEN p_patch ? 'frontText' THEN p_patch->>'frontText' ELSE locked_card.front_text END);
  next_back := public.ai_normalize_display_text(CASE WHEN p_patch ? 'backText' THEN p_patch->>'backText' ELSE locked_card.back_text END);
  IF (next_pattern='R1' AND next_skill<>'reading') OR (next_pattern='W1' AND next_skill<>'writing')
    OR next_pattern NOT IN ('R1','W1') OR next_skill NOT IN ('reading','writing')
    OR char_length(next_front) NOT BETWEEN 1 AND 200 OR char_length(next_back) NOT BETWEEN 1 AND 200
    OR (next_pattern='R1' AND next_front !~ '[㐀-䶿一-鿿豈-﫿𠀀-𮹟丽-𪘀𰀀-𲎯々〇〆]')
    OR (next_pattern='W1' AND next_back !~ '[㐀-䶿一-鿿豈-﫿𠀀-𮹟丽-𪘀𰀀-𲎯々〇〆]')
  THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  IF (locked_card.skill,locked_card.pattern,locked_card.front_text,locked_card.back_text)
    IS NOT DISTINCT FROM (next_skill,next_pattern,next_front,next_back) THEN
    RETURN jsonb_build_object('cardId',locked_card.id,'updatedAt',locked_card.updated_at,'cardKey',locked_card.card_key);
  END IF;
  BEGIN
    UPDATE public.cards SET skill=next_skill,pattern=next_pattern,front_text=next_front,back_text=next_back
    WHERE id=p_card_id RETURNING * INTO updated_card;
  EXCEPTION WHEN unique_violation THEN PERFORM public.ai_raise_import_error('CONFLICT'); END;
  RETURN jsonb_build_object('cardId',updated_card.id,'updatedAt',updated_card.updated_at,'cardKey',updated_card.card_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_imported_cards_internal(
  p_owner_user_id uuid, p_cards jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target_ids uuid[]; DECLARE target_id uuid; DECLARE input_count integer;
DECLARE locked_card public.cards%ROWTYPE; DECLARE expected_at timestamptz;
DECLARE illustration_ids uuid[]; DECLARE deleted_count integer;
BEGIN
  IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  input_count := jsonb_array_length(p_cards);
  IF input_count NOT BETWEEN 1 AND 100 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_cards) e
    WHERE jsonb_typeof(e) <> 'object' OR NOT (e ? 'cardId') OR NOT (e ? 'expectedUpdatedAt')
      OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
      OR (e->>'cardId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  BEGIN
    SELECT array_agg((e->>'cardId')::uuid ORDER BY (e->>'cardId')::uuid)
    INTO target_ids FROM jsonb_array_elements(p_cards) e;
    PERFORM (e->>'expectedUpdatedAt')::timestamptz FROM jsonb_array_elements(p_cards) e;
  EXCEPTION WHEN OTHERS THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END;
  IF (SELECT count(DISTINCT value) FROM unnest(target_ids) AS values(value)) <> input_count THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;

  FOREACH target_id IN ARRAY target_ids LOOP
    SELECT c.* INTO locked_card FROM public.cards c
    WHERE c.id=target_id AND c.owner_user_id=p_owner_user_id AND c.visibility='private' FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
    PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,target_id);
    SELECT (e->>'expectedUpdatedAt')::timestamptz INTO expected_at
    FROM jsonb_array_elements(p_cards) e WHERE (e->>'cardId')::uuid=target_id;
    IF locked_card.updated_at IS DISTINCT FROM expected_at THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(target_id::text,1010));
  END LOOP;
  FOREACH target_id IN ARRAY target_ids LOOP
    PERFORM public.ai_assert_card_inactive(target_id,p_owner_user_id);
  END LOOP;
  SELECT COALESCE(array_agg(DISTINCT ill.id ORDER BY ill.id),'{}'::uuid[]) INTO illustration_ids
  FROM public.cards c JOIN public.illustrations ill
    ON ill.owner_user_id=p_owner_user_id AND ill.illustration_key=c.illustration_key
  WHERE c.id=ANY(target_ids);
  PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);
  PERFORM 1 FROM public.ai_import_items i
  WHERE i.result_card_id=ANY(target_ids) AND i.owner_user_id=p_owner_user_id ORDER BY i.id FOR UPDATE;
  DELETE FROM public.cards c WHERE c.id=ANY(target_ids) AND c.owner_user_id=p_owner_user_id AND c.visibility='private';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> input_count THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  RETURN jsonb_build_object('status','deleted','deletedCount',deleted_count,'cardIds',to_jsonb(target_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_delete_imported_cards(p_cards jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_id uuid;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'authenticated' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  actor_id:=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid;
  IF actor_id IS NULL THEN PERFORM public.ai_raise_import_error('UNAUTHORIZED'); END IF;
  RETURN public.bulk_delete_imported_cards_internal(actor_id,p_cards);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_private_card_internal(
  p_owner_user_id uuid,p_card_id uuid,p_expected_updated_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result := public.bulk_delete_imported_cards_internal(
    p_owner_user_id,
    jsonb_build_array(jsonb_build_object('cardId',p_card_id,'expectedUpdatedAt',p_expected_updated_at))
  );
  RETURN jsonb_build_object('cardId',p_card_id,'status','deleted');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_decks_internal(
  p_owner_user_id uuid,p_card_id uuid,p_deck_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target_ids uuid[]; DECLARE locked_count integer; DECLARE current_ids uuid[];
DECLARE locked_card public.cards%ROWTYPE;
BEGIN
  IF p_deck_ids IS NULL OR array_position(p_deck_ids,NULL) IS NOT NULL THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id),'{}'::uuid[]) INTO target_ids FROM unnest(p_deck_ids) x(id);
  SELECT cards.* INTO locked_card FROM public.cards AS cards
  WHERE cards.id=p_card_id AND cards.owner_user_id=p_owner_user_id
    AND cards.visibility='private' FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,locked_card.id);
  PERFORM pg_advisory_xact_lock(hashtextextended(locked_card.id::text,1010));
  PERFORM public.ai_assert_card_inactive(locked_card.id,p_owner_user_id);
  PERFORM 1 FROM public.ai_import_items AS items
  WHERE items.result_card_id=p_card_id AND items.owner_user_id=p_owner_user_id
    AND items.status='finalized' ORDER BY items.id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_import_items i
    WHERE i.result_card_id=p_card_id AND i.owner_user_id=p_owner_user_id
      AND i.status='finalized'
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM 1 FROM public.decks AS target_decks
  WHERE target_decks.id=ANY(target_ids) AND target_decks.owner_user_id=p_owner_user_id
  ORDER BY target_decks.id FOR UPDATE;
  SELECT count(*) INTO locked_count FROM public.decks d
  WHERE d.id=ANY(target_ids) AND d.owner_user_id=p_owner_user_id;
  IF locked_count<>cardinality(target_ids) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  SELECT COALESCE(array_agg(dc.deck_id ORDER BY dc.deck_id),'{}'::uuid[]) INTO current_ids FROM public.deck_cards dc WHERE dc.card_id=p_card_id;
  IF current_ids IS NOT DISTINCT FROM target_ids THEN RETURN jsonb_build_object('cardId',p_card_id,'deckIds',to_jsonb(target_ids)); END IF;
  DELETE FROM public.deck_cards WHERE card_id=p_card_id AND NOT (deck_id=ANY(target_ids));
  INSERT INTO public.deck_cards(deck_id,card_id) SELECT x.id,p_card_id FROM unnest(target_ids) x(id) ORDER BY x.id ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('cardId',p_card_id,'deckIds',to_jsonb(target_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_tags_internal(
  p_owner_user_id uuid,p_card_id uuid,p_tag_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target_ids uuid[]; DECLARE locked_count integer; DECLARE current_ids uuid[];
BEGIN
  IF p_tag_ids IS NULL OR array_position(p_tag_ids,NULL) IS NOT NULL OR cardinality(p_tag_ids)>10 THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id),'{}'::uuid[]) INTO target_ids FROM unnest(p_tag_ids) x(id);
  PERFORM 1 FROM public.cards c WHERE c.id=p_card_id AND c.owner_user_id=p_owner_user_id AND c.visibility='private' FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,p_card_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text,1010));
  PERFORM public.ai_assert_card_inactive(p_card_id,p_owner_user_id);
  PERFORM 1 FROM public.ai_import_items i
  WHERE i.result_card_id=p_card_id AND i.owner_user_id=p_owner_user_id
    AND i.status='finalized' ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.tags t WHERE t.id=ANY(target_ids) AND t.owner_user_id=p_owner_user_id ORDER BY t.id FOR UPDATE;
  GET DIAGNOSTICS locked_count=ROW_COUNT;
  IF locked_count<>cardinality(target_ids) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  SELECT COALESCE(array_agg(ct.tag_id ORDER BY ct.tag_id),'{}'::uuid[]) INTO current_ids FROM public.card_tags ct WHERE ct.card_id=p_card_id;
  IF current_ids IS NOT DISTINCT FROM target_ids THEN RETURN jsonb_build_object('cardId',p_card_id,'tagIds',to_jsonb(target_ids)); END IF;
  DELETE FROM public.card_tags WHERE card_id=p_card_id AND NOT (tag_id=ANY(target_ids));
  INSERT INTO public.card_tags(owner_user_id,card_id,tag_id) SELECT p_owner_user_id,p_card_id,x.id FROM unnest(target_ids) x(id) ORDER BY x.id ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('cardId',p_card_id,'tagIds',to_jsonb(target_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_tag_names_internal(
  p_owner_user_id uuid,p_card_id uuid,p_tag_names text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE display_names text[]; DECLARE normalized_names text[]; DECLARE target_ids uuid[];
DECLARE tag_name text;
BEGIN
  IF p_tag_names IS NULL OR array_position(p_tag_names,NULL) IS NOT NULL OR cardinality(p_tag_names)>10 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  SELECT COALESCE(array_agg(name ORDER BY normalized),'{}'::text[]),
    COALESCE(array_agg(normalized ORDER BY normalized),'{}'::text[])
  INTO display_names,normalized_names
  FROM (
    SELECT min(public.ai_normalize_display_text(value)) AS name,
      public.ai_normalize_key_text(value) AS normalized
    FROM unnest(p_tag_names) names(value)
    GROUP BY public.ai_normalize_key_text(value)
  ) prepared;
  IF cardinality(display_names)<>cardinality(p_tag_names) OR EXISTS (
    SELECT 1 FROM unnest(display_names) names(value)
    WHERE char_length(value) NOT BETWEEN 1 AND 30
  ) THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  PERFORM 1 FROM public.cards c WHERE c.id=p_card_id AND c.owner_user_id=p_owner_user_id
    AND c.visibility='private' FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,p_card_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text,1010));
  PERFORM public.ai_assert_card_inactive(p_card_id,p_owner_user_id);
  PERFORM 1 FROM public.ai_import_items i
  WHERE i.result_card_id=p_card_id AND i.owner_user_id=p_owner_user_id
    AND i.status='finalized' ORDER BY i.id FOR UPDATE;
  FOREACH tag_name IN ARRAY display_names LOOP
    INSERT INTO public.tags(owner_user_id,display_name,normalized_name)
    VALUES(p_owner_user_id,tag_name,public.ai_normalize_key_text(tag_name))
    ON CONFLICT (owner_user_id,normalized_name) DO NOTHING;
  END LOOP;
  SELECT COALESCE(array_agg(t.id ORDER BY t.id),'{}'::uuid[]) INTO target_ids
  FROM public.tags t WHERE t.owner_user_id=p_owner_user_id
    AND t.normalized_name=ANY(normalized_names);
  IF cardinality(target_ids)<>cardinality(normalized_names) THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  RETURN public.set_card_tags_internal(p_owner_user_id,p_card_id,target_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_tag_names(p_card_id uuid,p_tag_names text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_id uuid;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'authenticated' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  actor_id:=NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid;
  IF actor_id IS NULL THEN PERFORM public.ai_raise_import_error('UNAUTHORIZED'); END IF;
  RETURN public.set_card_tag_names_internal(actor_id,p_card_id,p_tag_names);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_illustration_internal(
  p_owner_user_id uuid,p_card_id uuid,p_illustration_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE locked_card public.cards%ROWTYPE; DECLARE target_key text; DECLARE illustration_ids uuid[];
BEGIN
  SELECT c.* INTO locked_card FROM public.cards c
  WHERE c.id=p_card_id AND c.owner_user_id=p_owner_user_id AND c.visibility='private' FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(p_owner_user_id,p_card_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text,1010));
  PERFORM public.ai_assert_card_inactive(p_card_id,p_owner_user_id);
  SELECT COALESCE(array_agg(DISTINCT ill.id ORDER BY ill.id),'{}'::uuid[]) INTO illustration_ids
  FROM public.illustrations ill WHERE ill.owner_user_id=p_owner_user_id AND
    ((locked_card.illustration_key IS NOT NULL AND ill.illustration_key=locked_card.illustration_key)
      OR (p_illustration_id IS NOT NULL AND ill.id=p_illustration_id));
  PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);
  IF p_illustration_id IS NOT NULL THEN
    SELECT ill.illustration_key INTO target_key FROM public.illustrations ill
    LEFT JOIN public.ai_illustration_objects o ON o.illustration_id=ill.id
    WHERE ill.id=p_illustration_id AND ill.owner_user_id=p_owner_user_id
      AND ill.status='ready' AND ill.storage_path IS NOT NULL
      AND (o.id IS NULL OR o.state IN ('ready','delete_pending')) FOR UPDATE OF ill;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  END IF;
  IF locked_card.illustration_key IS DISTINCT FROM target_key THEN
    INSERT INTO s10_private.management_mutation_context(backend_pid,transaction_id) VALUES(pg_backend_pid(),txid_current());
    UPDATE public.cards SET illustration_key=target_key WHERE id=p_card_id;
    DELETE FROM s10_private.management_mutation_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
    UPDATE public.ai_import_items i SET user_edited_at=COALESCE(i.user_edited_at,statement_timestamp())
    WHERE i.result_card_id=p_card_id AND i.owner_user_id=p_owner_user_id AND i.status='finalized';
  END IF;
  RETURN jsonb_build_object('cardId',p_card_id,'illustrationId',p_illustration_id,'illustrationKey',target_key);
END;
$$;

-- Replace the S-10 function as one body so every destructive path follows the
-- same lock matrix. Calling a renamed body after a lifecycle-lock prefix would
-- reacquire batch/items/deck/relations in the legacy order and permit a cycle.
ALTER FUNCTION public.undo_import_internal(uuid,uuid) RENAME TO undo_import_internal_s10;

CREATE FUNCTION public.undo_import_internal(p_owner_user_id uuid,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE initial_batch public.ai_import_batches%ROWTYPE;
DECLARE locked_batch public.ai_import_batches%ROWTYPE;
DECLARE candidate_card_ids uuid[] := '{}'::uuid[];
DECLARE locked_card_ids uuid[] := '{}'::uuid[];
DECLARE illustration_ids uuid[] := '{}'::uuid[];
DECLARE candidate_tag_ids uuid[] := '{}'::uuid[];
DECLARE target_id uuid;
DECLARE modified_card_id uuid;
DECLARE auto_deck_owner uuid;
DECLARE deleted_card_count integer := 0;
DECLARE deleted_skip_count integer := 0;
DECLARE auto_deck_status text := 'not_applicable';
DECLARE original_auto_deck_id uuid;
DECLARE result jsonb;
BEGIN
  SELECT batches.* INTO initial_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.id=p_batch_id;
  IF NOT FOUND OR initial_batch.owner_user_id IS DISTINCT FROM p_owner_user_id
    OR initial_batch.source NOT IN ('app_ai','remote_mcp') THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;

  SELECT COALESCE(array_agg(items.result_card_id ORDER BY items.result_card_id),'{}'::uuid[])
  INTO candidate_card_ids
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status='finalized' AND items.result_card_id IS NOT NULL;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM 1
    FROM public.cards AS cards
    WHERE cards.id=target_id AND cards.owner_user_id=p_owner_user_id
      AND cards.visibility='private'
    FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  END LOOP;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(target_id::text,1010));
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT illustrations.id ORDER BY illustrations.id),'{}'::uuid[])
  INTO illustration_ids
  FROM public.cards AS cards
  JOIN public.illustrations AS illustrations
    ON illustrations.owner_user_id=p_owner_user_id
   AND illustrations.illustration_key=cards.illustration_key
  WHERE cards.id=ANY(candidate_card_ids);
  PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);

  SELECT batches.* INTO locked_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.id=p_batch_id AND batches.owner_user_id=p_owner_user_id
    AND batches.source IN ('app_ai','remote_mcp')
  FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  IF locked_batch.status='undone' THEN RETURN locked_batch.undo_result; END IF;

  PERFORM 1
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
  ORDER BY items.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(i.result_card_id ORDER BY i.result_card_id),'{}'::uuid[])
  INTO locked_card_ids
  FROM (
    SELECT i.result_card_id
    FROM public.ai_import_items i
    WHERE i.batch_id=p_batch_id AND i.owner_user_id=p_owner_user_id
      AND i.status='finalized' AND i.result_card_id IS NOT NULL
    ORDER BY i.id FOR UPDATE
  ) AS i;
  IF locked_card_ids IS DISTINCT FROM candidate_card_ids THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;

  SELECT i.result_card_id INTO modified_card_id
  FROM public.ai_import_items i
  WHERE i.batch_id=p_batch_id AND i.owner_user_id=p_owner_user_id
    AND i.status='finalized' AND i.user_edited_at IS NOT NULL
  ORDER BY i.result_card_id
  LIMIT 1;
  IF modified_card_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error('CARD_MODIFIED',jsonb_build_object('cardId',modified_card_id));
  END IF;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM public.ai_assert_card_inactive(target_id,p_owner_user_id);
  END LOOP;

  original_auto_deck_id:=locked_batch.auto_created_deck_id;
  IF original_auto_deck_id IS NOT NULL THEN
    SELECT auto_decks.owner_user_id INTO auto_deck_owner
    FROM public.decks AS auto_decks
    WHERE auto_decks.id=original_auto_deck_id
    FOR UPDATE;
    IF NOT FOUND OR auto_deck_owner IS DISTINCT FROM p_owner_user_id THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
  END IF;

  PERFORM 1
  FROM public.deck_cards AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
  ORDER BY relations.card_id,relations.deck_id FOR UPDATE;
  PERFORM 1 FROM public.card_tags AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
  ORDER BY relations.card_id,relations.tag_id FOR UPDATE;
  PERFORM 1 FROM public.ai_import_item_tags AS relations
  JOIN public.ai_import_items AS items ON items.id=relations.item_id
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
  ORDER BY relations.item_id,relations.tag_id FOR UPDATE OF relations;

  SELECT COALESCE(array_agg(DISTINCT relations.tag_id ORDER BY relations.tag_id),'{}'::uuid[])
  INTO candidate_tag_ids
  FROM public.ai_import_item_tags AS relations
  JOIN public.ai_import_items AS items ON items.id=relations.item_id
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id;
  PERFORM 1 FROM public.tags AS tags
  WHERE tags.id=ANY(candidate_tag_ids) AND tags.owner_user_id=p_owner_user_id
  ORDER BY tags.id FOR UPDATE;

  SELECT count(*) INTO deleted_skip_count
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status='deleted';

  PERFORM public.ai_enable_internal_context();

  DELETE FROM public.deck_cards AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
    AND relations.deck_id=locked_batch.target_deck_id;
  DELETE FROM public.card_tags AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
    AND relations.tag_id=ANY(candidate_tag_ids);
  IF current_setting('app.s10_failpoint',true)='undo_after_relations' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  UPDATE public.ai_import_items AS items
  SET status='undone',result_card_id=NULL,deleted_card_id=NULL,
    undone_at=statement_timestamp()
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status<>'deleted';
  IF current_setting('app.s10_failpoint',true)='undo_after_items' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  DELETE FROM public.cards AS cards
  WHERE cards.id=ANY(candidate_card_ids) AND cards.owner_user_id=p_owner_user_id
    AND cards.visibility='private';
  GET DIAGNOSTICS deleted_card_count=ROW_COUNT;
  IF current_setting('app.s10_failpoint',true)='undo_after_cards' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  DELETE FROM public.ai_import_item_tags AS relations
  USING public.ai_import_items AS items
  WHERE items.id=relations.item_id AND items.batch_id=p_batch_id
    AND items.owner_user_id=p_owner_user_id;
  DELETE FROM public.tags AS tags
  WHERE tags.id=ANY(candidate_tag_ids) AND tags.owner_user_id=p_owner_user_id
    AND NOT EXISTS(SELECT 1 FROM public.ai_import_item_tags AS links WHERE links.tag_id=tags.id)
    AND NOT EXISTS(SELECT 1 FROM public.card_tags AS links WHERE links.tag_id=tags.id);
  IF current_setting('app.s10_failpoint',true)='undo_after_tags' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  IF original_auto_deck_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.deck_cards WHERE deck_id=original_auto_deck_id) THEN
      auto_deck_status:='retained';
    ELSE
      UPDATE public.ai_import_batches
      SET target_deck_id=NULL,auto_created_deck_id=NULL
      WHERE id=p_batch_id AND owner_user_id=p_owner_user_id;
      DELETE FROM public.decks
      WHERE id=original_auto_deck_id AND owner_user_id=p_owner_user_id;
      auto_deck_status:='deleted';
    END IF;
  END IF;
  IF current_setting('app.s10_failpoint',true)='undo_after_auto_deck' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  result:=jsonb_build_object(
    'batchId',p_batch_id,'status','undone',
    'deletedCardCount',deleted_card_count,'deletedSkipCount',deleted_skip_count,
    'autoDeckStatus',auto_deck_status,'autoDeckId',original_auto_deck_id
  );
  UPDATE public.ai_import_batches
  SET status='undone',undone_at=statement_timestamp(),undo_result=result
  WHERE id=p_batch_id AND owner_user_id=p_owner_user_id;

  PERFORM public.ai_disable_internal_context();
  RETURN result;
END;
$$;

DROP FUNCTION public.undo_import_internal_s10(uuid,uuid);

ALTER FUNCTION public.ai_s13_assert_managed_card(uuid,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz) OWNER TO s10_migration_owner;
ALTER FUNCTION public.bulk_delete_imported_cards_internal(uuid,jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.bulk_delete_imported_cards(jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.update_imported_card_internal(uuid,uuid,jsonb,timestamptz) OWNER TO s10_migration_owner;
ALTER FUNCTION public.delete_private_card_internal(uuid,uuid,timestamptz) OWNER TO s10_migration_owner;
ALTER FUNCTION public.set_card_decks_internal(uuid,uuid,uuid[]) OWNER TO s10_migration_owner;
ALTER FUNCTION public.set_card_tags_internal(uuid,uuid,uuid[]) OWNER TO s10_migration_owner;
ALTER FUNCTION public.set_card_tag_names_internal(uuid,uuid,text[]) OWNER TO s10_migration_owner;
ALTER FUNCTION public.set_card_tag_names(uuid,text[]) OWNER TO s10_migration_owner;
ALTER FUNCTION public.set_card_illustration_internal(uuid,uuid,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.undo_import_internal(uuid,uuid) OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.ai_s13_assert_managed_card(uuid,uuid),
  public.bulk_delete_imported_cards_internal(uuid,jsonb),
  public.set_card_tag_names_internal(uuid,uuid,text[]),
  public.undo_import_internal(uuid,uuid)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz),
  public.bulk_delete_imported_cards(jsonb), public.set_card_tag_names(uuid,text[])
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz),
  public.bulk_delete_imported_cards(jsonb), public.set_card_tag_names(uuid,text[])
TO authenticated;

COMMIT;
