-- S-03 runtime repair: RLS policies cannot authorize profile access unless the
-- authenticated API role also has the corresponding table privileges.

GRANT SELECT, INSERT, UPDATE ON TABLE public.users_profile TO authenticated;
