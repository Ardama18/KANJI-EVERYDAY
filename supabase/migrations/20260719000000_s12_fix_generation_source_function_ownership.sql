-- Restore the S-10 SECURITY DEFINER ownership contract for the S-12 source helpers.
-- The functions keep their existing fixed search_path and service-role-only API.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER FUNCTION public.prepare_ai_source_upload_scoped(uuid,text,text,bigint,text)
	OWNER TO s10_migration_owner;
ALTER FUNCTION public.get_ai_generation_sources(uuid,uuid[])
	OWNER TO s10_migration_owner;
ALTER FUNCTION public.release_ai_generation_source(uuid,uuid)
	OWNER TO s10_migration_owner;
ALTER FUNCTION public.complete_ai_generation_source_release(uuid,uuid,text,text,text,boolean)
	OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION
	public.prepare_ai_source_upload_scoped(uuid,text,text,bigint,text),
	public.get_ai_generation_sources(uuid,uuid[]),
	public.release_ai_generation_source(uuid,uuid),
	public.complete_ai_generation_source_release(uuid,uuid,text,text,text,boolean)
	FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
	public.prepare_ai_source_upload_scoped(uuid,text,text,bigint,text),
	public.get_ai_generation_sources(uuid,uuid[]),
	public.release_ai_generation_source(uuid,uuid),
	public.complete_ai_generation_source_release(uuid,uuid,text,text,text,boolean)
	TO service_role;
