SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER DEFAULT PRIVILEGES
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.invoke_ai_card_async_schedule(p_kind text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE project_url text;
DECLARE worker_secret text;
DECLARE endpoint text;
DECLARE request_id bigint;
DECLARE validated jsonb;
BEGIN
  IF p_kind NOT IN ('worker','cleanup') THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  SELECT decrypted_secret INTO project_url
  FROM vault.decrypted_secrets WHERE name='s11_project_url';
  SELECT decrypted_secret INTO worker_secret
  FROM vault.decrypted_secrets WHERE name='s11_worker_secret';
	validated := public.ai_s11_validate_schedule_config(project_url,worker_secret);
	project_url := validated->>'projectUrl';
	worker_secret := validated->>'workerSecret';
  endpoint := CASE p_kind
    WHEN 'worker' THEN '/functions/v1/ai-card-import-worker'
    ELSE '/functions/v1/ai-card-import-cleanup'
  END;
  SELECT net.http_post(
    url:=project_url||endpoint,
    headers:=jsonb_build_object(
      'Content-Type','application/json','x-ai-worker-secret',worker_secret
    ),
    body:='{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_ai_card_async_schedules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE worker_job bigint;
DECLARE cleanup_job bigint;
DECLARE project_url text;
DECLARE worker_secret text;
DECLARE validated jsonb;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
	SELECT decrypted_secret INTO project_url
	FROM vault.decrypted_secrets WHERE name='s11_project_url';
	SELECT decrypted_secret INTO worker_secret
	FROM vault.decrypted_secrets WHERE name='s11_worker_secret';
	validated := public.ai_s11_validate_schedule_config(project_url,worker_secret);
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('s11-ai-card-worker','s11-ai-card-cleanup');
  SELECT cron.schedule(
    's11-ai-card-worker','5 seconds',
    $command$SELECT public.invoke_ai_card_async_schedule('worker');$command$
  ) INTO worker_job;
  SELECT cron.schedule(
    's11-ai-card-cleanup','*/15 * * * *',
    $command$SELECT public.invoke_ai_card_async_schedule('cleanup');$command$
  ) INTO cleanup_job;
  RETURN jsonb_build_object('workerJobId',worker_job,'cleanupJobId',cleanup_job);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_ai_card_async_schedules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  SELECT count(*) INTO removed FROM cron.job WHERE jobname IN ('s11-ai-card-worker','s11-ai-card-cleanup');
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('s11-ai-card-worker','s11-ai-card-cleanup');
  RETURN jsonb_build_object('removed',removed);
END;
$$;

ALTER FUNCTION public.invoke_ai_card_async_schedule(text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.activate_ai_card_async_schedules() OWNER TO s10_migration_owner;
ALTER FUNCTION public.deactivate_ai_card_async_schedules() OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.invoke_ai_card_async_schedule(text),
  public.activate_ai_card_async_schedules(),public.deactivate_ai_card_async_schedules()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.activate_ai_card_async_schedules(),public.deactivate_ai_card_async_schedules()
  TO service_role;

GRANT USAGE ON SCHEMA cron,vault,net TO s10_migration_owner;
GRANT SELECT ON cron.job,vault.decrypted_secrets TO s10_migration_owner;
GRANT EXECUTE ON FUNCTION cron.schedule(text,text,text),cron.unschedule(bigint),
  net.http_post(text,jsonb,jsonb,jsonb,integer)
  TO s10_migration_owner;
GRANT EXECUTE ON FUNCTION vault._crypto_aead_det_decrypt(bytea, bytea, bigint, bytea, bytea)
  TO s10_migration_owner;

-- Deliberately no call to activate_ai_card_async_schedules(): deploy and smoke gates precede activation.
