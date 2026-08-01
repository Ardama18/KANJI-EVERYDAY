BEGIN;

DROP TRIGGER IF EXISTS guard_deck_logical_delete_active_session ON public.decks;
DROP FUNCTION IF EXISTS public.guard_deck_logical_delete_active_session();

REVOKE UPDATE (deleted_at) ON TABLE public.decks FROM authenticated;
GRANT UPDATE (finished_at, current_card_id, revealed) ON TABLE public.study_sessions
  TO s10_migration_owner;

CREATE OR REPLACE FUNCTION public.s29_guard_deck_deleted_at_internal_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    AND NOT COALESCE(public.ai_internal_context_active(), false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1008', MESSAGE = 'S-29 direct deck delete is not allowed';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.s29_guard_deck_deleted_at_internal_update()
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s29_guard_deck_deleted_at_internal_update()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS s29_guard_deck_deleted_at_internal_update ON public.decks;
CREATE TRIGGER s29_guard_deck_deleted_at_internal_update
BEFORE UPDATE OF deleted_at ON public.decks
FOR EACH ROW EXECUTE FUNCTION public.s29_guard_deck_deleted_at_internal_update();

CREATE OR REPLACE FUNCTION public.delete_deck_with_closed_sessions(p_deck_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  deleted_at_value timestamptz;
  closed_count integer;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P1001', MESSAGE = 'S-29 unauthorized';
  END IF;
  IF p_deck_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P1002', MESSAGE = 'S-29 deck not found';
  END IF;

  deleted_at_value := statement_timestamp();

  PERFORM 1
  FROM public.decks AS decks
  WHERE decks.id = p_deck_id
    AND decks.owner_user_id = actor_id
    AND decks.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P1002', MESSAGE = 'S-29 deck not found';
  END IF;

  UPDATE public.study_sessions AS sessions
  SET finished_at = deleted_at_value,
      current_card_id = NULL,
      revealed = false
  WHERE sessions.deck_id = p_deck_id
    AND sessions.user_id = actor_id
    AND sessions.finished_at IS NULL;
  GET DIAGNOSTICS closed_count = ROW_COUNT;

  PERFORM public.ai_enable_internal_context();
  BEGIN
    UPDATE public.decks AS decks
    SET deleted_at = deleted_at_value
    WHERE decks.id = p_deck_id
      AND decks.owner_user_id = actor_id
      AND decks.deleted_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.ai_disable_internal_context();
    RAISE;
  END;
  PERFORM public.ai_disable_internal_context();

  RETURN jsonb_build_object(
    'deckId', p_deck_id,
    'deletedAt', deleted_at_value,
    'closedSessionCount', closed_count
  );
END;
$$;

ALTER FUNCTION public.delete_deck_with_closed_sessions(uuid)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.delete_deck_with_closed_sessions(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_deck_with_closed_sessions(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.s29_guard_deck_cards_active_deck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.decks AS decks
    WHERE decks.id = NEW.deck_id
      AND decks.deleted_at IS NULL
  ) THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.s29_guard_deck_cards_active_deck()
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s29_guard_deck_cards_active_deck()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS s29_guard_deck_cards_active_deck ON public.deck_cards;
CREATE TRIGGER s29_guard_deck_cards_active_deck
BEFORE INSERT OR UPDATE OF deck_id ON public.deck_cards
FOR EACH ROW EXECUTE FUNCTION public.s29_guard_deck_cards_active_deck();

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
  WHERE target_decks.id=ANY(target_ids)
    AND target_decks.owner_user_id=p_owner_user_id
    AND target_decks.deleted_at IS NULL
  ORDER BY target_decks.id FOR UPDATE;
  SELECT count(*) INTO locked_count FROM public.decks d
  WHERE d.id=ANY(target_ids)
    AND d.owner_user_id=p_owner_user_id
    AND d.deleted_at IS NULL;
  IF locked_count<>cardinality(target_ids) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  SELECT COALESCE(array_agg(dc.deck_id ORDER BY dc.deck_id),'{}'::uuid[]) INTO current_ids FROM public.deck_cards dc WHERE dc.card_id=p_card_id;
  IF current_ids IS NOT DISTINCT FROM target_ids THEN RETURN jsonb_build_object('cardId',p_card_id,'deckIds',to_jsonb(target_ids)); END IF;
  DELETE FROM public.deck_cards WHERE card_id=p_card_id AND NOT (deck_id=ANY(target_ids));
  INSERT INTO public.deck_cards(deck_id,card_id) SELECT x.id,p_card_id FROM unnest(target_ids) x(id) ORDER BY x.id ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('cardId',p_card_id,'deckIds',to_jsonb(target_ids));
END;
$$;

ALTER FUNCTION public.set_card_decks_internal(uuid,uuid,uuid[])
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.set_card_decks_internal(uuid,uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_import_batch_deck_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.target_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.decks AS decks
    WHERE decks.id = NEW.target_deck_id
      AND decks.owner_user_id = NEW.owner_user_id
      AND decks.deleted_at IS NULL
    FOR KEY SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'S-10 deck not found';
  END IF;

  IF NEW.auto_created_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.decks AS decks
    WHERE decks.id = NEW.auto_created_deck_id
      AND decks.owner_user_id = NEW.owner_user_id
      AND decks.deleted_at IS NULL
    FOR KEY SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'S-10 deck not found';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_import_batch_deck_owner()
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.enforce_import_batch_deck_owner()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_import_internal(
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  prepared jsonb;
  prepared_item jsonb;
  prepared_tag jsonb;
  candidate_id uuid;
  candidate_key text;
  upload_candidate uuid;
  locked_upload_owner uuid;
  locked_upload_status text;
  existing_batch public.ai_import_batches%ROWTYPE;
  reservation public.ai_quota_reservations%ROWTYPE;
  resolved_deck_id uuid;
  auto_deck_id uuid;
  matching_deck_ids uuid[];
  created_batch_id uuid;
  created_item_id uuid;
  resolved_tag_id uuid;
  requested_card_count integer;
  requested_image_count integer;
  expected_reservation_units integer;
  expected_reservation_status text;
  duplicate_client_item_id text;
BEGIN
  prepared := public.ai_prepare_import_request(p_request);
  requested_card_count := (prepared ->> 'requestedCardCount')::integer;
  requested_image_count := (prepared ->> 'requestedImageCount')::integer;

  FOR candidate_id IN
    SELECT cards.id
    FROM public.cards AS cards
    WHERE cards.owner_user_id = p_actor_user_id
      AND cards.visibility = 'private'
      AND cards.card_key IN (
        SELECT items.value ->> 'cardKey'
        FROM jsonb_array_elements(prepared -> 'items') AS items(value)
      )
    ORDER BY cards.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  FOR candidate_key IN
    SELECT DISTINCT items.value ->> 'cardKey'
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    ORDER BY items.value ->> 'cardKey'
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_actor_user_id::text || chr(31) || 'card-key' || chr(31) || candidate_key, 1011
    ));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_actor_user_id::text || chr(31) || 'commit' || chr(31) || p_idempotency_key, 1012
  ));

  SELECT batches.* INTO existing_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.owner_user_id = p_actor_user_id
    AND batches.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF existing_batch.source IS DISTINCT FROM p_source OR
       existing_batch.import_request_hash IS DISTINCT FROM p_import_request_hash OR
       existing_batch.card_reservation_key IS DISTINCT FROM p_card_reservation_key THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
    IF prepared ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'importRequestHash', 'rule', 'mismatch')
      );
    END IF;
    IF (existing_batch.target_deck_id IS NOT NULL OR existing_batch.auto_created_deck_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM public.decks AS decks
        WHERE decks.id = COALESCE(existing_batch.target_deck_id, existing_batch.auto_created_deck_id)
          AND decks.owner_user_id = p_actor_user_id
          AND decks.deleted_at IS NULL
        FOR KEY SHARE
      ) THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object(
      'batchId', existing_batch.id,
      'status', existing_batch.status,
      'requestedCardCount', existing_batch.requested_card_count,
      'requestedImageCount', existing_batch.requested_image_count
    );
  END IF;

  IF prepared ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'importRequestHash', 'rule', 'mismatch')
    );
  END IF;

  SELECT items.value ->> 'clientItemId'
  INTO duplicate_client_item_id
  FROM jsonb_array_elements(prepared -> 'items') AS items(value)
  WHERE EXISTS (
    SELECT 1 FROM public.cards AS cards
    WHERE cards.owner_user_id = p_actor_user_id
      AND cards.visibility = 'private'
      AND cards.card_key = items.value ->> 'cardKey'
  )
  ORDER BY (items.value ->> 'ordinal')::integer
  LIMIT 1;
  IF duplicate_client_item_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error(
      'DUPLICATE_EXISTING', jsonb_build_object('itemId', duplicate_client_item_id)
    );
  END IF;

  SELECT reservations.* INTO reservation
  FROM public.ai_quota_reservations AS reservations
  WHERE reservations.owner_user_id = p_actor_user_id
    AND reservations.reservation_key = p_card_reservation_key
    AND reservations.kind = 'card_generation'
  FOR UPDATE;
  expected_reservation_units := CASE p_source WHEN 'app_ai' THEN requested_card_count ELSE 0 END;
  expected_reservation_status := CASE p_source WHEN 'app_ai' THEN 'reserved' ELSE 'exempt' END;
  IF NOT FOUND OR reservation.source IS DISTINCT FROM p_source OR
     reservation.units IS DISTINCT FROM expected_reservation_units OR
     reservation.status IS DISTINCT FROM expected_reservation_status OR
     reservation.provider_started_at IS NULL OR
     reservation.item_id IS NOT NULL OR reservation.concept_id IS NOT NULL OR
     reservation.import_request_hash IS NOT NULL AND
       reservation.import_request_hash IS DISTINCT FROM p_import_request_hash OR
     reservation.batch_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  IF prepared #>> '{deck,mode}' = 'id' THEN
    SELECT decks.id INTO resolved_deck_id
    FROM public.decks AS decks
    WHERE decks.id = (prepared #>> '{deck,id}')::uuid
      AND decks.owner_user_id = p_actor_user_id
      AND decks.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
  ELSIF prepared #>> '{deck,mode}' = 'name' THEN
    SELECT array_agg(decks.id ORDER BY decks.id)
    INTO matching_deck_ids
    FROM public.decks AS decks
    WHERE decks.owner_user_id = p_actor_user_id
      AND decks.deleted_at IS NULL
      AND public.ai_normalize_key_text(decks.name) =
        public.ai_normalize_key_text(prepared #>> '{deck,name}');
    IF matching_deck_ids IS NULL THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    IF array_length(matching_deck_ids, 1) > 1 THEN
      PERFORM public.ai_raise_import_error(
        'DECK_AMBIGUOUS', jsonb_build_object(
          'normalizedName', public.ai_normalize_key_text(prepared #>> '{deck,name}')
        )
      );
    END IF;
    SELECT decks.id INTO STRICT resolved_deck_id
    FROM public.decks AS decks
    WHERE decks.id = matching_deck_ids[1]
      AND decks.owner_user_id = p_actor_user_id
      AND decks.deleted_at IS NULL
    FOR UPDATE;
  ELSE
    INSERT INTO public.decks (owner_user_id, name)
    VALUES (p_actor_user_id, prepared #>> '{deck,name}')
    RETURNING id INTO STRICT resolved_deck_id;
    auto_deck_id := resolved_deck_id;
  END IF;

  FOR upload_candidate IN
    SELECT DISTINCT (items.value ->> 'uploadId')::uuid
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    WHERE items.value ->> 'imageMode' = 'upload'
    ORDER BY (items.value ->> 'uploadId')::uuid
  LOOP
    SELECT uploads.owner_user_id, uploads.status
    INTO locked_upload_owner, locked_upload_status
    FROM public.ai_uploads AS uploads
    WHERE uploads.id = upload_candidate
    FOR UPDATE;
    IF NOT FOUND OR locked_upload_owner IS DISTINCT FROM p_actor_user_id THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    IF locked_upload_status IS DISTINCT FROM 'ready' THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
  END LOOP;

  INSERT INTO public.ai_import_batches (
    owner_user_id, source, target_deck_id, auto_created_deck_id, status,
    idempotency_key, import_request_hash, card_reservation_key,
    requested_card_count, requested_image_count
  ) VALUES (
    p_actor_user_id, p_source, resolved_deck_id, auto_deck_id, 'committed',
    p_idempotency_key, p_import_request_hash, p_card_reservation_key,
    requested_card_count, requested_image_count
  ) RETURNING id INTO STRICT created_batch_id;

  UPDATE public.ai_quota_reservations
  SET import_request_hash = p_import_request_hash, batch_id = created_batch_id
  WHERE id = reservation.id;

  FOR prepared_tag IN
    SELECT DISTINCT ON (tags.value ->> 'normalizedName') tags.value
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    CROSS JOIN LATERAL jsonb_array_elements(items.value -> 'tags') AS tags(value)
    ORDER BY tags.value ->> 'normalizedName', tags.value ->> 'displayName'
  LOOP
    INSERT INTO public.tags (owner_user_id, display_name, normalized_name)
    VALUES (
      p_actor_user_id,
      prepared_tag ->> 'displayName',
      prepared_tag ->> 'displayName'
    )
    ON CONFLICT (owner_user_id, normalized_name) DO NOTHING;
  END LOOP;

  IF current_setting('app.s10_failpoint', true) = 'commit_after_tags' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  FOR prepared_item IN
    SELECT value FROM jsonb_array_elements(prepared -> 'items')
    ORDER BY (value ->> 'ordinal')::integer
  LOOP
    INSERT INTO public.ai_import_items (
      owner_user_id, batch_id, client_item_id, concept_id, ordinal,
      pattern, skill, front_text, back_text, card_key, image_mode, upload_id
    ) VALUES (
      p_actor_user_id, created_batch_id,
      prepared_item ->> 'clientItemId', prepared_item ->> 'conceptId',
      (prepared_item ->> 'ordinal')::integer,
      prepared_item ->> 'pattern', prepared_item ->> 'skill',
      prepared_item ->> 'frontText', prepared_item ->> 'backText',
      prepared_item ->> 'cardKey', prepared_item ->> 'imageMode',
      (prepared_item ->> 'uploadId')::uuid
    ) RETURNING id INTO STRICT created_item_id;

    FOR prepared_tag IN
      SELECT value FROM jsonb_array_elements(prepared_item -> 'tags')
      ORDER BY value ->> 'normalizedName'
    LOOP
      SELECT tags.id INTO STRICT resolved_tag_id
      FROM public.tags AS tags
      WHERE tags.owner_user_id = p_actor_user_id
        AND tags.normalized_name = prepared_tag ->> 'normalizedName'
      FOR KEY SHARE;
      INSERT INTO public.ai_import_item_tags (owner_user_id, item_id, tag_id)
      VALUES (p_actor_user_id, created_item_id, resolved_tag_id);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'batchId', created_batch_id,
    'status', 'committed',
    'requestedCardCount', requested_card_count,
    'requestedImageCount', requested_image_count
  );
END;
$$;

ALTER FUNCTION public.commit_import_internal(uuid, text, text, text, jsonb, text)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.commit_import_internal(uuid, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_generated_import_async(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text,
  p_mnemonics jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prepared jsonb;
DECLARE final_card_count integer;
DECLARE charged_units integer;
DECLARE reservation_id uuid;
DECLARE existing_batch_id uuid;
DECLARE result jsonb;
DECLARE target_batch_id uuid;
DECLARE mnemonic_row record;
DECLARE resolved_key text;
DECLARE matching_deck_ids uuid[];
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_actor_user_id IS NULL OR p_idempotency_key IS NULL
    OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128
    OR p_import_request_hash !~ '^[0-9a-f]{64}$'
    OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR p_card_reservation_key IS NULL
    OR char_length(p_card_reservation_key) NOT BETWEEN 1 AND 128 THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field','commit','rule','arguments')
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_actor_user_id::text || chr(31) || 'commit' || chr(31) || p_idempotency_key, 1012
  ));
  SELECT batches.id INTO existing_batch_id
  FROM public.ai_import_batches AS batches
  WHERE batches.owner_user_id=p_actor_user_id
    AND batches.idempotency_key=p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    result := public.commit_import_async(
      p_actor_user_id,'app_ai',p_idempotency_key,p_import_request_hash,
      p_request,p_card_reservation_key
    );
  ELSE
    prepared := public.ai_prepare_import_request(p_request);
    IF prepared #>> '{deck,mode}' = 'id' THEN
      PERFORM 1
      FROM public.decks AS decks
      WHERE decks.id = (prepared #>> '{deck,id}')::uuid
        AND decks.owner_user_id = p_actor_user_id
        AND decks.deleted_at IS NULL
      FOR KEY SHARE;
      IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
    ELSIF prepared #>> '{deck,mode}' = 'name' THEN
      SELECT array_agg(decks.id ORDER BY decks.id)
      INTO matching_deck_ids
      FROM public.decks AS decks
      WHERE decks.owner_user_id = p_actor_user_id
        AND decks.deleted_at IS NULL
        AND public.ai_normalize_key_text(decks.name) =
          public.ai_normalize_key_text(prepared #>> '{deck,name}');
      IF matching_deck_ids IS NULL THEN
        PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
      END IF;
      IF array_length(matching_deck_ids, 1) > 1 THEN
        PERFORM public.ai_raise_import_error(
          'DECK_AMBIGUOUS', jsonb_build_object(
            'normalizedName', public.ai_normalize_key_text(prepared #>> '{deck,name}')
          )
        );
      END IF;
    END IF;
    final_card_count := (prepared->>'requestedCardCount')::integer;
    SELECT reservations.id,reservations.units INTO reservation_id,charged_units
    FROM public.ai_quota_reservations AS reservations
    WHERE reservations.owner_user_id=p_actor_user_id
      AND reservations.reservation_key=p_card_reservation_key
      AND reservations.kind='card_generation'
      AND reservations.source='app_ai'
      AND reservations.status='reserved'
      AND reservations.provider_started_at IS NOT NULL
      AND reservations.batch_id IS NULL
    FOR UPDATE;
    IF NOT FOUND OR charged_units < final_card_count THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;

    UPDATE public.ai_quota_reservations SET units=final_card_count
    WHERE id=reservation_id;
    result := public.commit_import_async(
      p_actor_user_id,'app_ai',p_idempotency_key,p_import_request_hash,
      p_request,p_card_reservation_key
    );
    UPDATE public.ai_quota_reservations SET units=charged_units
    WHERE id=reservation_id AND batch_id=(result->>'batchId')::uuid;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  END IF;

  target_batch_id := (result->>'batchId')::uuid;
  IF p_mnemonics IS NOT NULL THEN
    IF jsonb_typeof(p_mnemonics) <> 'array' THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field','mnemonics','rule','type')
      );
    END IF;
    FOR mnemonic_row IN
      SELECT entry.value ->> 'conceptId' AS concept_id,
             entry.value -> 'slots' AS slots,
             entry.value -> 'explanation' AS explanation
      FROM jsonb_array_elements(p_mnemonics) AS entry(value)
    LOOP
      resolved_key := NULL;
      SELECT ill.illustration_key INTO resolved_key
      FROM public.ai_import_concept_jobs AS jobs
      JOIN public.illustrations AS ill ON ill.id = jobs.illustration_id
      WHERE jobs.batch_id = target_batch_id
        AND jobs.owner_user_id = p_actor_user_id
        AND jobs.concept_id = mnemonic_row.concept_id
        AND ill.owner_user_id = p_actor_user_id;
      IF resolved_key IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.card_mnemonics (
        owner_user_id, illustration_key, slots, explanation, status
      ) VALUES (
        p_actor_user_id, resolved_key, mnemonic_row.slots, mnemonic_row.explanation, 'approved'
      )
      ON CONFLICT (owner_user_id, illustration_key) DO UPDATE
        SET slots = EXCLUDED.slots,
            explanation = EXCLUDED.explanation,
            status = 'approved',
            updated_at = now();
    END LOOP;
  END IF;

  RETURN result;
END;
$$;

ALTER FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
  TO service_role;

DROP FUNCTION IF EXISTS public.validate_ai_import_preview(uuid,uuid,text,text,uuid[]);
DROP FUNCTION IF EXISTS public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb);

CREATE FUNCTION public.validate_ai_import_preview(
  p_owner_user_id uuid,
  p_deck_id uuid,
  p_reservation_key text,
  p_import_request_hash text,
  p_upload_ids uuid[] DEFAULT '{}'::uuid[],
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE duplicate_client_item_id text;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF NOT EXISTS (
    SELECT 1
    FROM public.decks
    WHERE id = p_deck_id
      AND owner_user_id = p_owner_user_id
      AND deleted_at IS NULL
  ) THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_quota_reservations
    WHERE owner_user_id=p_owner_user_id AND reservation_key=p_reservation_key
      AND kind='card_generation' AND source='app_ai' AND status='reserved'
      AND provider_started_at IS NOT NULL
  ) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  IF p_import_request_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE jsonb_typeof(item) <> 'object'
      OR item->>'clientItemId' IS NULL
      OR item->>'cardKey' !~ '^[0-9a-f]{64}$'
  ) THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
  SELECT item->>'clientItemId' INTO duplicate_client_item_id
  FROM jsonb_array_elements(p_items) item
  JOIN public.cards cards ON cards.owner_user_id=p_owner_user_id
    AND cards.visibility='private' AND cards.card_key=item->>'cardKey'
  ORDER BY item->>'clientItemId' LIMIT 1;
  IF duplicate_client_item_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error(
      'DUPLICATE_EXISTING', jsonb_build_object('itemId',duplicate_client_item_id)
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_upload_ids) upload_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_uploads uploads WHERE uploads.id=upload_id
        AND uploads.owner_user_id=p_owner_user_id AND uploads.usage_scope='card_illustration'
        AND uploads.status='ready'
    )
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('valid',true);
END;
$$;

ALTER FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.s14_remote_validate_import_preview(
  p_client_id text,
  p_session_id text,
  p_deck_id uuid,
  p_reservation_key text,
  p_import_request_hash text,
  p_upload_ids uuid[],
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  duplicate_client_item_id text;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  IF p_deck_id IS NULL OR p_reservation_key IS NULL
    OR char_length(p_reservation_key) NOT BETWEEN 1 AND 128
    OR p_import_request_hash IS NULL OR p_import_request_hash !~ '^[0-9a-f]{64}$'
    OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'object'
        OR item.value ->> 'clientItemId' IS NULL
        OR item.value ->> 'cardKey' !~ '^[0-9a-f]{64}$'
    ) THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  PERFORM 1 FROM public.decks AS decks
  WHERE decks.id = p_deck_id
    AND decks.owner_user_id = actor_id
    AND decks.deleted_at IS NULL;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_upload_ids, ARRAY[]::uuid[])) AS ids(id)
    LEFT JOIN public.ai_uploads AS uploads
      ON uploads.id = ids.id AND uploads.owner_user_id = actor_id
        AND uploads.usage_scope = 'card_illustration' AND uploads.status = 'ready'
    WHERE uploads.id IS NULL
  ) THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  SELECT item.value ->> 'clientItemId' INTO duplicate_client_item_id
  FROM jsonb_array_elements(p_items) AS item(value)
  JOIN public.cards AS cards ON cards.owner_user_id = actor_id
    AND cards.visibility = 'private' AND cards.card_key = item.value ->> 'cardKey'
  ORDER BY item.value ->> 'clientItemId'
  LIMIT 1;
  IF duplicate_client_item_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error(
      'DUPLICATE_EXISTING', jsonb_build_object('itemId', duplicate_client_item_id)
    );
  END IF;
END;
$$;

ALTER FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb)
  TO authenticated;

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
  actor_id := public.ai_s13_authenticated_actor();
  IF actor_id IS NULL THEN PERFORM public.ai_raise_import_error('UNAUTHORIZED'); END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
    OR p_source IS NOT NULL AND p_source NOT IN ('app_ai', 'remote_mcp')
    OR p_created_from IS NOT NULL AND p_created_to IS NOT NULL AND p_created_from >= p_created_to
  THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  IF p_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.decks d
    WHERE d.id = p_deck_id
      AND d.owner_user_id = actor_id
      AND d.deleted_at IS NULL
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  IF p_tag_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tags t WHERE t.id = p_tag_id AND t.owner_user_id = actor_id
  ) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;

  WITH selected AS (
    SELECT c.id, c.front_text, c.back_text, c.skill, c.pattern,
      c.created_at, c.updated_at, b.source, b.id AS batch_id,
      i.id AS item_id, c.illustration_key,
      ill.id AS illustration_id, ill.status AS illustration_status
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
        SELECT 1
        FROM public.deck_cards dc
        JOIN public.decks d ON d.id = dc.deck_id
        WHERE dc.card_id = c.id
          AND dc.deck_id = p_deck_id
          AND d.owner_user_id = actor_id
          AND d.deleted_at IS NULL
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
    SELECT s.*, mn.mnemonic, sc.shared_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
        FROM public.deck_cards dc JOIN public.decks d ON d.id = dc.deck_id
        WHERE dc.card_id = s.id
          AND d.owner_user_id = actor_id
          AND d.deleted_at IS NULL), '[]'::jsonb) AS decks,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) ORDER BY t.display_name, t.id)
        FROM public.card_tags ct JOIN public.tags t ON t.id = ct.tag_id
        WHERE ct.card_id = s.id AND t.owner_user_id = actor_id), '[]'::jsonb) AS tags
    FROM selected s
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'slots', m.slots, 'explanation', m.explanation, 'status', m.status
      ) AS mnemonic
      FROM public.card_mnemonics m
      WHERE m.owner_user_id = actor_id
        AND m.illustration_key = s.illustration_key
      LIMIT 1
    ) mn ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS shared_count
      FROM public.cards sibling
      WHERE sibling.owner_user_id = actor_id
        AND s.illustration_key IS NOT NULL
        AND sibling.illustration_key = s.illustration_key
    ) sc ON true
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
        jsonb_build_object('id', e.illustration_id, 'status', e.illustration_status) END,
      'illustrationKey', e.illustration_key,
      'mnemonic', e.mnemonic,
      'mnemonicSharedCardCount', COALESCE(e.shared_count, 0)
    ) ORDER BY e.created_at DESC, e.id DESC), '[]'::jsonb),
    'hasMore', (SELECT count(*) > p_limit FROM selected)
  ) INTO result FROM enriched e;
  RETURN COALESCE(result, jsonb_build_object('items', '[]'::jsonb, 'hasMore', false));
END;
$$;

ALTER FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
  TO authenticated;

COMMIT;
