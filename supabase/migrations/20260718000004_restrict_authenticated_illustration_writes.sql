-- Restrict browser-side illustration lifecycle mutations to the legacy
-- pending insert and failed -> pending retry transition.

REVOKE INSERT, UPDATE ON TABLE public.illustrations FROM authenticated;
GRANT INSERT (owner_user_id, illustration_key) ON TABLE public.illustrations TO authenticated;
GRANT UPDATE (status, prompt) ON TABLE public.illustrations TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_authenticated_illustration_status_retry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	IF current_setting('request.jwt.claim.role', true) = 'authenticated'
		AND (OLD.status IS DISTINCT FROM 'failed' OR NEW.status IS DISTINCT FROM 'pending') THEN
		RAISE EXCEPTION USING ERRCODE = 'P1008', MESSAGE = 'CONFLICT';
	END IF;
	RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_authenticated_illustration_status_retry() OWNER TO s10_migration_owner;

DROP TRIGGER IF EXISTS guard_authenticated_illustration_status_retry ON public.illustrations;
CREATE TRIGGER guard_authenticated_illustration_status_retry
BEFORE UPDATE OF status ON public.illustrations
FOR EACH ROW EXECUTE FUNCTION public.guard_authenticated_illustration_status_retry();

REVOKE ALL ON FUNCTION public.guard_authenticated_illustration_status_retry() FROM PUBLIC, anon, authenticated;
