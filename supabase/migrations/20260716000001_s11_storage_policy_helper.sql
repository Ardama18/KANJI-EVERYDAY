-- Restore legacy owner Storage mutation after S-11 owner-safe column ACLs.
-- The policy receives only a one-bit answer; tracking paths and fencing state
-- remain unavailable to authenticated callers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION public.ai_s11_storage_object_is_managed(
	p_bucket text,p_path text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE caller_claims jsonb;
DECLARE caller_role text;
DECLARE caller_subject text;
DECLARE caller_owner uuid;
BEGIN
	BEGIN
		caller_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
	EXCEPTION WHEN invalid_text_representation THEN
		RAISE EXCEPTION USING ERRCODE='42501',
			MESSAGE='authenticated storage owner required';
	END;
	caller_role := COALESCE(
		NULLIF(current_setting('request.jwt.claim.role',true),''),
		caller_claims->>'role'
	);
	IF caller_role IS DISTINCT FROM 'authenticated' THEN
		RAISE EXCEPTION USING ERRCODE='42501',
			MESSAGE='authenticated storage owner required';
	END IF;
	caller_subject := COALESCE(
		NULLIF(current_setting('request.jwt.claim.sub',true),''),
		caller_claims->>'sub'
	);
	IF caller_subject IS NULL OR caller_subject !~
		'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
		RAISE EXCEPTION USING ERRCODE='42501',
			MESSAGE='authenticated storage owner required';
	END IF;
	caller_owner := caller_subject::uuid;
	IF caller_owner IS NULL OR p_bucket IS DISTINCT FROM 'illustrations' OR
		p_path IS NULL OR split_part(p_path,'/',1) IS DISTINCT FROM caller_owner::text THEN
		RAISE EXCEPTION USING ERRCODE='42501',
			MESSAGE='storage object owner mismatch';
	END IF;
	RETURN EXISTS (
		SELECT 1
		FROM public.ai_illustration_objects AS managed
		WHERE managed.owner_user_id=caller_owner
			AND managed.storage_bucket=p_bucket
			AND managed.storage_path=p_path
	);
END;
$$;
ALTER FUNCTION public.ai_s11_storage_object_is_managed(text,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai_s11_storage_object_is_managed(text,text)
	FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ai_s11_storage_object_is_managed(text,text)
	TO authenticated;

DO $$
BEGIN
	IF current_setting('app.s11_storage_policy_failpoint',true)='after_helper' THEN
		RAISE EXCEPTION 'S-11 injected storage policy failure after helper';
	END IF;
END;
$$;

DROP POLICY IF EXISTS storage_objects_insert_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_insert_owner_illustrations
ON storage.objects FOR INSERT
WITH CHECK (
	bucket_id = 'illustrations'
	AND split_part(name, '/', 1) = auth.uid()::text
	AND NOT public.ai_s11_storage_object_is_managed(bucket_id,name)
);
DROP POLICY IF EXISTS storage_objects_update_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_update_owner_illustrations
ON storage.objects FOR UPDATE
USING (
	bucket_id = 'illustrations'
	AND split_part(name, '/', 1) = auth.uid()::text
	AND NOT public.ai_s11_storage_object_is_managed(bucket_id,name)
)
WITH CHECK (
	bucket_id = 'illustrations'
	AND split_part(name, '/', 1) = auth.uid()::text
	AND NOT public.ai_s11_storage_object_is_managed(bucket_id,name)
);
DROP POLICY IF EXISTS storage_objects_delete_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_delete_owner_illustrations
ON storage.objects FOR DELETE
USING (
	bucket_id = 'illustrations'
	AND split_part(name, '/', 1) = auth.uid()::text
	AND NOT public.ai_s11_storage_object_is_managed(bucket_id,name)
);

COMMIT;
