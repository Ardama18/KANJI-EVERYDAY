-- S-29 follow-up: resolve the authenticated actor without requiring the
-- SECURITY DEFINER owner to have USAGE on the Supabase-managed auth schema.

BEGIN;

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
  actor_id := public.ai_s13_authenticated_actor();
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

COMMIT;
