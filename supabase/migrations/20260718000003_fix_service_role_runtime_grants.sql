-- Server-only clients still need table privileges even though service_role
-- bypasses RLS. Keep the grants limited to the tables used directly by the
-- deck verification and legacy illustration worker paths.

GRANT SELECT ON TABLE public.decks TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.illustrations TO service_role;

