-- S-25: owner-scoped logical deck deletion with an active study session guard.

ALTER TABLE public.decks
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX idx_decks_owner_active_created_at
ON public.decks (owner_user_id, created_at, id)
WHERE deleted_at IS NULL;

CREATE FUNCTION public.guard_deck_logical_delete_active_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.study_sessions AS sessions
    WHERE sessions.deck_id = OLD.id
      AND sessions.user_id = OLD.owner_user_id
      AND sessions.finished_at IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1007',
      MESSAGE = 'S-25 deck has an active session';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_deck_logical_delete_active_session() OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.guard_deck_logical_delete_active_session()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_deck_logical_delete_active_session
BEFORE UPDATE OF deleted_at ON public.decks
FOR EACH ROW EXECUTE FUNCTION public.guard_deck_logical_delete_active_session();

DROP POLICY IF EXISTS decks_select_owner ON public.decks;
CREATE POLICY decks_select_owner
ON public.decks
FOR SELECT
USING ((SELECT auth.uid()) = owner_user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS decks_update_owner ON public.decks;
CREATE POLICY decks_update_owner
ON public.decks
FOR UPDATE
USING ((SELECT auth.uid()) = owner_user_id AND deleted_at IS NULL)
WITH CHECK ((SELECT auth.uid()) = owner_user_id);

DROP POLICY IF EXISTS deck_cards_select_owner_deck ON public.deck_cards;
CREATE POLICY deck_cards_select_owner_deck
ON public.deck_cards
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.decks
    WHERE decks.id = deck_cards.deck_id
      AND decks.owner_user_id = (SELECT auth.uid())
      AND decks.deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS deck_cards_insert_owner_deck ON public.deck_cards;
CREATE POLICY deck_cards_insert_owner_deck
ON public.deck_cards
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.decks
    WHERE decks.id = deck_cards.deck_id
      AND decks.owner_user_id = (SELECT auth.uid())
      AND decks.deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS deck_cards_update_owner_deck ON public.deck_cards;
CREATE POLICY deck_cards_update_owner_deck
ON public.deck_cards
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.decks
    WHERE decks.id = deck_cards.deck_id
      AND decks.owner_user_id = (SELECT auth.uid())
      AND decks.deleted_at IS NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.decks
    WHERE decks.id = deck_cards.deck_id
      AND decks.owner_user_id = (SELECT auth.uid())
      AND decks.deleted_at IS NULL
  )
);

GRANT UPDATE (deleted_at) ON TABLE public.decks TO authenticated;
