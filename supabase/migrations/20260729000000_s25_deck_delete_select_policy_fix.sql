-- S-25 follow-up: allow owner SELECT on tombstoned decks so logical delete UPDATE passes RLS.
--
-- App read paths keep deleted decks hidden with explicit deleted_at IS NULL filters.

DROP POLICY IF EXISTS decks_select_owner ON public.decks;
CREATE POLICY decks_select_owner
ON public.decks
FOR SELECT
USING ((SELECT auth.uid()) = owner_user_id);
