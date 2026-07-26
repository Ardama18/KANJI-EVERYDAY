-- S-19 (issue #64): expose the approved mnemonic on the AI card management list.
-- Read-side projection only: `list_ai_managed_cards` gains `illustrationKey`,
-- `mnemonic` and `mnemonicSharedCardCount`.  ADR-013 decision 1 keeps the write
-- path on the owner-scoped RLS policies that `card_mnemonics` already has, so this
-- migration adds no RPC, no GRANT for a new write entry point, and no schema change.
--
-- The function is replaced with CREATE OR REPLACE (no DROP): argument names, types,
-- defaults and the return type are unchanged, so owner and ACL survive.  They are
-- re-issued at the end anyway (same shape as S-14 did for `commit_import_async`)
-- so the state is deterministic even if the function was missing beforehand.

BEGIN;

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
  -- PostgREST v14 exposes JWT data through the packed request.jwt.claims GUC.
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
    SELECT 1 FROM public.decks d WHERE d.id = p_deck_id AND d.owner_user_id = actor_id
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
    SELECT s.*, mn.mnemonic, sc.shared_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id)
        FROM public.deck_cards dc JOIN public.decks d ON d.id = dc.deck_id
        WHERE dc.card_id = s.id AND d.owner_user_id = actor_id), '[]'::jsonb) AS decks,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name) ORDER BY t.display_name, t.id)
        FROM public.card_tags ct JOIN public.tags t ON t.id = ct.tag_id
        WHERE ct.card_id = s.id AND t.owner_user_id = actor_id), '[]'::jsonb) AS tags
    FROM selected s
    -- SECURITY DEFINER bypasses RLS here, so the explicit owner predicate is the
    -- only owner boundary for card_mnemonics.  (owner_user_id, illustration_key)
    -- is UNIQUE; LIMIT 1 is defensive.
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'slots', m.slots, 'explanation', m.explanation, 'status', m.status
      ) AS mnemonic
      FROM public.card_mnemonics m
      WHERE m.owner_user_id = actor_id
        AND m.illustration_key = s.illustration_key
      LIMIT 1
    ) mn ON true
    -- Every card of the caller that shares the illustration key, page-independent.
    -- A NULL key makes the predicate false, so the aggregate returns 0.
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
