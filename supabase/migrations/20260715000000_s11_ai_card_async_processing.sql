-- S-11 expand stage. This migration is intentionally not wrapped in one long
-- transaction: lock-taking DDL fails fast and the data backfill is a separate,
-- bounded compatibility stage before constraint validation.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Deny that
-- before the first CREATE FUNCTION so an autocommit interruption cannot expose
-- a partially installed SECURITY DEFINER surface.
ALTER DEFAULT PRIVILEGES
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pgmq;
SELECT pgmq.create('ai_card_imports');

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ai-card-sources', 'ai-card-sources', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

-- S-10 granted table-wide owner SELECT. Revoke it before adding internal
-- lifecycle columns so every autocommit failpoint remains token-safe.
REVOKE SELECT ON public.ai_uploads FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,owner_user_id,upload_key,purpose,mime_type,byte_size,status,
	created_at,consumed_at) ON public.ai_uploads TO authenticated;
GRANT SELECT ON public.ai_uploads TO service_role;

ALTER TABLE public.ai_uploads
  ADD COLUMN IF NOT EXISTS raw_storage_path text,
	ADD COLUMN IF NOT EXISTS raw_storage_bucket text,
  ADD COLUMN IF NOT EXISTS source_storage_path text,
	ADD COLUMN IF NOT EXISTS source_storage_bucket text,
	ADD COLUMN IF NOT EXISTS source_write_intent_path text,
	ADD COLUMN IF NOT EXISTS source_write_intent_bucket text,
  ADD COLUMN IF NOT EXISTS detected_mime_type text,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS delete_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleanup_claimed_at timestamptz,
	ADD COLUMN IF NOT EXISTS cleanup_claim_token uuid,
  ADD COLUMN IF NOT EXISTS cleanup_previous_status text,
  ADD COLUMN IF NOT EXISTS raw_cleanup_claimed_at timestamptz,
	ADD COLUMN IF NOT EXISTS raw_cleanup_claim_token uuid;

DO $$
BEGIN
	IF current_setting('app.s11_failpoint',true)='before_constraint_swap' THEN
		RAISE EXCEPTION 'S-11 injected autocommit failure before constraint swap';
	END IF;
END;
$$;

ALTER TABLE public.ai_uploads
  DROP CONSTRAINT IF EXISTS ai_uploads_status_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_status_time_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_s11_status_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_s11_dimensions_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_s11_digest_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_s11_bucket_check,
	DROP CONSTRAINT IF EXISTS ai_uploads_s11_status_time_check,
  ADD CONSTRAINT ai_uploads_s11_status_check
    CHECK (status IN ('prepared', 'ready', 'consumed', 'cleanup_pending', 'cleaning', 'deleted')) NOT VALID,
  ADD CONSTRAINT ai_uploads_s11_dimensions_check CHECK (
    (width IS NULL AND height IS NULL) OR
    (width > 0 AND height > 0 AND width::bigint * height::bigint <= 16000000)
  ) NOT VALID,
	ADD CONSTRAINT ai_uploads_s11_digest_check
		CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
	ADD CONSTRAINT ai_uploads_s11_bucket_check CHECK (
		(raw_storage_path IS NULL OR raw_storage_bucket = 'ai-card-sources') AND
		(source_storage_path IS NULL OR source_storage_bucket IN ('ai-card-sources','illustrations')) AND
		(source_write_intent_path IS NULL OR source_write_intent_bucket = 'ai-card-sources')
	) NOT VALID,
  ADD CONSTRAINT ai_uploads_s11_status_time_check CHECK (
    (status = 'prepared' AND consumed_at IS NULL AND deleted_at IS NULL) OR
    (status = 'ready' AND consumed_at IS NULL AND deleted_at IS NULL) OR
    (status = 'consumed' AND consumed_at IS NOT NULL AND deleted_at IS NULL) OR
    (status = 'cleanup_pending' AND deleted_at IS NULL) OR
    (status = 'cleaning' AND deleted_at IS NULL) OR
    (status = 'deleted' AND deleted_at IS NOT NULL)
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS public.ai_import_concept_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  concept_id text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  queue_message_id bigint,
  attempt smallint NOT NULL DEFAULT 0,
  claim_token uuid,
  claim_expires_at timestamptz,
	terminal_message_id bigint,
	terminal_claim_token_hash text,
  next_attempt_at timestamptz,
  error_code text,
  illustration_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_import_concept_jobs_batch_owner_fkey
    FOREIGN KEY (batch_id, owner_user_id)
    REFERENCES public.ai_import_batches (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT ai_import_concept_jobs_illustration_fkey
    FOREIGN KEY (illustration_id) REFERENCES public.illustrations (id) ON DELETE SET NULL,
  CONSTRAINT ai_import_concept_jobs_concept_check CHECK (char_length(concept_id) BETWEEN 1 AND 64),
  CONSTRAINT ai_import_concept_jobs_state_check
    CHECK (state IN ('queued', 'processing', 'succeeded', 'failed', 'undone')),
  CONSTRAINT ai_import_concept_jobs_attempt_check CHECK (attempt BETWEEN 0 AND 3),
  CONSTRAINT ai_import_concept_jobs_claim_check CHECK (
    (state = 'processing' AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL) OR
    (state <> 'processing' AND claim_token IS NULL AND claim_expires_at IS NULL)
  ),
	CONSTRAINT ai_import_concept_jobs_terminal_claim_check CHECK (
		(state = 'failed' AND terminal_message_id IS NOT NULL AND
			terminal_claim_token_hash ~ '^[0-9a-f]{64}$') OR
		(state <> 'failed' AND terminal_message_id IS NULL AND terminal_claim_token_hash IS NULL)
	),
  CONSTRAINT ai_import_concept_jobs_error_check
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT ai_import_concept_jobs_batch_concept_uq UNIQUE (batch_id, concept_id),
  CONSTRAINT ai_import_concept_jobs_id_owner_uq UNIQUE (id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS ai_import_concept_jobs_state_attempt_idx
  ON public.ai_import_concept_jobs (state, next_attempt_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_import_concept_jobs_message_uidx
	ON public.ai_import_concept_jobs (queue_message_id) WHERE queue_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_upload_consumers (
	upload_id uuid NOT NULL REFERENCES public.ai_uploads(id) ON DELETE RESTRICT,
	job_id uuid NOT NULL UNIQUE REFERENCES public.ai_import_concept_jobs(id) ON DELETE CASCADE,
	owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (upload_id,job_id),
	CONSTRAINT ai_upload_consumers_owner_check CHECK (owner_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_upload_consumers_upload_idx ON public.ai_upload_consumers(upload_id,job_id);

CREATE TABLE IF NOT EXISTS public.ai_illustration_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES public.ai_import_concept_jobs(id) ON DELETE CASCADE,
  illustration_id uuid NOT NULL UNIQUE REFERENCES public.illustrations(id) ON DELETE CASCADE,
	storage_bucket text NOT NULL DEFAULT 'illustrations',
  storage_path text NOT NULL,
  state text NOT NULL DEFAULT 'uploading',
	reference_count bigint NOT NULL DEFAULT 0,
  digest text,
  width integer,
  height integer,
  error_code text,
  delete_due_at timestamptz,
  cleanup_claimed_at timestamptz,
	cleanup_claim_token uuid,
  cleanup_previous_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
	CONSTRAINT ai_illustration_objects_path_check CHECK (
		storage_path = owner_user_id::text || '/s11-managed/' || illustration_id::text || '.png'
	),
	CONSTRAINT ai_illustration_objects_bucket_check CHECK (storage_bucket = 'illustrations'),
  CONSTRAINT ai_illustration_objects_state_check
    CHECK (state IN ('uploading', 'ready', 'orphan', 'delete_pending', 'cleaning', 'deleted')),
	CONSTRAINT ai_illustration_objects_reference_count_check CHECK (reference_count >= 0),
  CONSTRAINT ai_illustration_objects_cleanup_previous_state_check
    CHECK (cleanup_previous_state IS NULL OR cleanup_previous_state IN ('orphan', 'delete_pending')),
  CONSTRAINT ai_illustration_objects_digest_check CHECK (digest IS NULL OR digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_illustration_objects_dimensions_check CHECK (
    (width IS NULL AND height IS NULL) OR
    (width BETWEEN 1 AND 1024 AND height BETWEEN 1 AND 1024)
  ),
  CONSTRAINT ai_illustration_objects_owner_path_uq UNIQUE (owner_user_id, storage_path)
);

CREATE INDEX IF NOT EXISTS ai_illustration_objects_cleanup_idx
  ON public.ai_illustration_objects (delete_due_at, created_at)
  WHERE state IN ('orphan', 'delete_pending');

CREATE TABLE IF NOT EXISTS public.ai_worker_log_outbox (
	event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	event_type text NOT NULL,
	queue_message_id bigint NOT NULL,
	job_id uuid,
	batch_id uuid,
	error_code text,
	reason text,
	attempt smallint,
	dispatch_claim_token uuid,
	dispatch_claimed_at timestamptz,
	dispatched_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT ai_worker_log_outbox_event_check
		CHECK (event_type IN ('worker_failure','worker_poison','worker_duplicate')),
	CONSTRAINT ai_worker_log_outbox_error_check
		CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
	CONSTRAINT ai_worker_log_outbox_reason_check
		CHECK (reason IS NULL OR reason IN (
			'MALFORMED_PAYLOAD','JOB_MISSING','COMPENSATION_DELETED','COMPENSATION_PENDING'
		)),
	CONSTRAINT ai_worker_log_outbox_dispatch_check CHECK (
		(dispatched_at IS NULL) OR
		(dispatched_at IS NOT NULL AND dispatch_claim_token IS NULL AND dispatch_claimed_at IS NULL)
	),
	UNIQUE (event_type, queue_message_id)
);
CREATE INDEX IF NOT EXISTS ai_worker_log_outbox_pending_idx
	ON public.ai_worker_log_outbox (created_at,event_id) WHERE dispatched_at IS NULL;

ALTER TABLE public.ai_import_concept_jobs OWNER TO s10_migration_owner;
ALTER TABLE public.ai_upload_consumers OWNER TO s10_migration_owner;
ALTER TABLE public.ai_illustration_objects OWNER TO s10_migration_owner;
ALTER TABLE public.ai_worker_log_outbox OWNER TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_import_concept_jobs,
	public.ai_upload_consumers, public.ai_illustration_objects,
	public.ai_worker_log_outbox TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE ON public.illustrations TO s10_migration_owner;
GRANT USAGE ON SCHEMA pgmq TO s10_migration_owner;
GRANT EXECUTE ON FUNCTION pgmq.send(text,jsonb,integer),
	pgmq.read(text,integer,integer,jsonb), pgmq.archive(text,bigint)
	TO s10_migration_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON pgmq.q_ai_card_imports,pgmq.a_ai_card_imports
	TO s10_migration_owner;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE pgmq.q_ai_card_imports_msg_id_seq
	TO s10_migration_owner;

ALTER TABLE public.ai_import_concept_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_upload_consumers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_illustration_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_worker_log_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_import_concept_jobs_select_owner ON public.ai_import_concept_jobs;
CREATE POLICY ai_import_concept_jobs_select_owner ON public.ai_import_concept_jobs
  FOR SELECT USING ((SELECT auth.uid()) = owner_user_id);
DROP POLICY IF EXISTS ai_illustration_objects_select_owner ON public.ai_illustration_objects;
CREATE POLICY ai_illustration_objects_select_owner ON public.ai_illustration_objects
	FOR SELECT USING ((SELECT auth.uid()) = owner_user_id);
DROP POLICY IF EXISTS ai_upload_consumers_select_owner ON public.ai_upload_consumers;
CREATE POLICY ai_upload_consumers_select_owner ON public.ai_upload_consumers
	FOR SELECT USING ((SELECT auth.uid()) = owner_user_id);
REVOKE SELECT ON public.ai_uploads,public.ai_import_concept_jobs,
	public.ai_upload_consumers,public.ai_illustration_objects
	FROM PUBLIC,anon,authenticated;
REVOKE SELECT (storage_path,raw_storage_path,raw_storage_bucket,
	source_storage_path,source_storage_bucket,source_write_intent_path,
	source_write_intent_bucket,sha256,delete_due_at,cleanup_claimed_at,
	cleanup_claim_token,cleanup_previous_status,raw_cleanup_claimed_at,
	raw_cleanup_claim_token)
	ON public.ai_uploads FROM PUBLIC,anon,authenticated;
REVOKE SELECT (queue_message_id,claim_token,claim_expires_at,
	terminal_message_id,terminal_claim_token_hash)
	ON public.ai_import_concept_jobs FROM PUBLIC,anon,authenticated;
REVOKE SELECT (job_id,storage_bucket,storage_path,digest,delete_due_at,
	cleanup_claimed_at,cleanup_claim_token,cleanup_previous_state)
	ON public.ai_illustration_objects FROM PUBLIC,anon,authenticated;

GRANT SELECT (id,owner_user_id,upload_key,purpose,mime_type,byte_size,status,
	detected_mime_type,width,height,created_at,consumed_at,deleted_at)
	ON public.ai_uploads TO authenticated;
GRANT SELECT (id,owner_user_id,batch_id,concept_id,state,attempt,
	next_attempt_at,error_code,illustration_id,created_at,updated_at,completed_at)
	ON public.ai_import_concept_jobs TO authenticated;
GRANT SELECT (upload_id,job_id,owner_user_id,created_at)
	ON public.ai_upload_consumers TO authenticated;
GRANT SELECT (id,owner_user_id,illustration_id,state,reference_count,
	error_code,width,height,created_at,updated_at,deleted_at)
	ON public.ai_illustration_objects TO authenticated;
GRANT SELECT ON public.ai_uploads,public.ai_import_concept_jobs,
	public.ai_upload_consumers,public.ai_illustration_objects TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.ai_import_concept_jobs, public.ai_upload_consumers,
	public.ai_illustration_objects
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ai_worker_log_outbox FROM PUBLIC,anon,authenticated,service_role;

-- S-11 uses a reserved path segment for worker objects, but mutation denial is
-- tied to durable tracking rather than the segment alone. This keeps every
-- pre-S-11 owner object writable even if its legacy path happens to use the same
-- segment, while preventing replacement or deletion of tracked worker bytes.
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
REVOKE ALL ON FUNCTION public.ai_s11_storage_object_is_managed(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ai_s11_storage_object_is_managed(text,text) TO authenticated;

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

DO $$
BEGIN
	IF current_setting('app.s11_failpoint',true)='after_expand_tables' THEN
		RAISE EXCEPTION 'S-11 injected autocommit failure after expand tables';
	END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_require_service_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_validate_schedule_config(
	p_project_url text,p_worker_secret text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE project_url text := btrim(p_project_url);
DECLARE worker_secret text := btrim(p_worker_secret);
BEGIN
	IF project_url IS NULL OR worker_secret IS NULL OR worker_secret='' OR
		project_url !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
	RETURN jsonb_build_object('projectUrl',project_url,'workerSecret',worker_secret);
END;
$$;

-- Compatibility period: old S-10 writers remain valid while the application
-- and workers roll forward. New/updated legacy rows receive S-11 metadata, and
-- existing rows are handled by the bounded SKIP LOCKED function below.
CREATE OR REPLACE FUNCTION public.ai_s11_sync_upload_compat()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	IF NEW.status IN ('ready','consumed') AND NEW.source_storage_path IS NULL THEN
		NEW.source_storage_path := NEW.storage_path;
		NEW.source_storage_bucket := 'illustrations';
		NEW.detected_mime_type := NEW.mime_type;
		NEW.delete_due_at := COALESCE(NEW.delete_due_at,NEW.created_at+interval '23 hours 45 minutes');
	ELSIF NEW.status='deleted' THEN
		NEW.source_storage_path := NULL;
		NEW.source_storage_bucket := NULL;
		NEW.detected_mime_type := COALESCE(NEW.detected_mime_type,NEW.mime_type);
		NEW.deleted_at := COALESCE(NEW.deleted_at,NEW.consumed_at,NEW.created_at,statement_timestamp());
		NEW.delete_due_at := COALESCE(NEW.delete_due_at,NEW.deleted_at);
	END IF;
	RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ai_s11_sync_upload_compat ON public.ai_uploads;
CREATE TRIGGER ai_s11_sync_upload_compat
BEFORE INSERT OR UPDATE OF status,storage_path,mime_type ON public.ai_uploads
FOR EACH ROW EXECUTE FUNCTION public.ai_s11_sync_upload_compat();

CREATE OR REPLACE FUNCTION public.backfill_ai_uploads_s11(p_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE affected integer;
BEGIN
	IF p_limit NOT BETWEEN 1 AND 5000 THEN
		RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='S11_BACKFILL_LIMIT_INVALID';
	END IF;
	WITH batch AS MATERIALIZED (
		SELECT id FROM public.ai_uploads
		WHERE
			(status IN ('ready','consumed') AND
				(source_storage_path IS NULL OR source_storage_bucket IS NULL OR
				 detected_mime_type IS NULL OR delete_due_at IS NULL)) OR
			(status='deleted' AND (deleted_at IS NULL OR delete_due_at IS NULL))
		ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED
	)
	UPDATE public.ai_uploads uploads SET
		source_storage_path=CASE WHEN uploads.status<>'deleted' THEN uploads.storage_path ELSE NULL END,
		source_storage_bucket=CASE WHEN uploads.status<>'deleted' THEN 'illustrations' ELSE NULL END,
		detected_mime_type=COALESCE(uploads.detected_mime_type,uploads.mime_type),
		delete_due_at=COALESCE(uploads.delete_due_at,CASE WHEN uploads.status='deleted'
			THEN COALESCE(uploads.consumed_at,uploads.created_at)
			ELSE uploads.created_at+interval '23 hours 45 minutes' END),
		deleted_at=CASE WHEN uploads.status='deleted'
			THEN COALESCE(uploads.deleted_at,uploads.consumed_at,uploads.created_at) ELSE NULL END
	FROM batch WHERE uploads.id=batch.id;
	GET DIAGNOSTICS affected=ROW_COUNT;
	RETURN affected;
END;
$$;

-- Canonical lock order for the shared illustration lifecycle:
--   existing cards (UUID order) -> illustrations (UUID order) ->
--   ai_illustration_objects (UUID order).
-- Card INSERT has no pre-existing card row and therefore enters at illustrations.
-- Tracking-only claim/recovery paths must never acquire cards or illustrations later.
CREATE OR REPLACE FUNCTION public.ai_s11_lock_illustration_lifecycle(p_illustration_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE illustration_ids uuid[];
DECLARE object_ids uuid[];
DECLARE target_id uuid;
BEGIN
	SELECT COALESCE(array_agg(DISTINCT ids.id ORDER BY ids.id),'{}'::uuid[])
	INTO illustration_ids FROM unnest(COALESCE(p_illustration_ids,'{}'::uuid[])) AS ids(id)
	WHERE ids.id IS NOT NULL;
	FOREACH target_id IN ARRAY illustration_ids LOOP
		PERFORM 1 FROM public.illustrations illustrations
		WHERE illustrations.id=target_id FOR UPDATE;
	END LOOP;
	SELECT COALESCE(array_agg(objects.id ORDER BY objects.id),'{}'::uuid[])
	INTO object_ids FROM public.ai_illustration_objects objects
	WHERE objects.illustration_id=ANY(illustration_ids);
	FOREACH target_id IN ARRAY object_ids LOOP
		PERFORM 1 FROM public.ai_illustration_objects objects
		WHERE objects.id=target_id FOR UPDATE;
	END LOOP;
END;
$$;

-- Forward-compatible S-10 override. A different-key attach must not pre-lock
-- only NEW and then ask the card trigger for OLD+NEW: two A<->B swaps would
-- otherwise acquire opposite illustration prefixes. The existing card row is
-- already locked; resolve OLD+NEW without row locks, then acquire the complete
-- illustration/lifecycle set through the canonical UUID-ordered helper.
CREATE OR REPLACE FUNCTION public.set_card_illustration_internal(
	p_owner_user_id uuid,p_card_id uuid,p_illustration_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE locked_card public.cards%ROWTYPE;
DECLARE target_key text;
DECLARE illustration_ids uuid[];
BEGIN
	SELECT cards.* INTO locked_card FROM public.cards AS cards
	WHERE cards.id=p_card_id AND cards.owner_user_id=p_owner_user_id
		AND cards.visibility='private' FOR UPDATE;
	IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
	PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text,1010));
	PERFORM public.ai_assert_card_inactive(p_card_id,p_owner_user_id);

	SELECT COALESCE(array_agg(DISTINCT illustrations.id ORDER BY illustrations.id),'{}'::uuid[])
	INTO illustration_ids FROM public.illustrations illustrations
	WHERE illustrations.owner_user_id=p_owner_user_id AND (
		(locked_card.illustration_key IS NOT NULL
			AND illustrations.illustration_key=locked_card.illustration_key)
		OR (p_illustration_id IS NOT NULL AND illustrations.id=p_illustration_id)
	);
	PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);

	IF p_illustration_id IS NOT NULL THEN
		SELECT illustrations.illustration_key INTO target_key
		FROM public.illustrations AS illustrations
		WHERE illustrations.id=p_illustration_id
			AND illustrations.owner_user_id=p_owner_user_id
			AND illustrations.status='ready'
			AND illustrations.storage_path IS NOT NULL
		FOR UPDATE;
		IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
	END IF;
	PERFORM 1 FROM public.ai_import_items AS items
	WHERE items.result_card_id=p_card_id AND items.owner_user_id=p_owner_user_id FOR UPDATE;
	IF locked_card.illustration_key IS DISTINCT FROM target_key THEN
		INSERT INTO s10_private.management_mutation_context(backend_pid,transaction_id)
		VALUES(pg_backend_pid(),txid_current());
		UPDATE public.cards SET illustration_key=target_key WHERE id=p_card_id;
		DELETE FROM s10_private.management_mutation_context
		WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
		UPDATE public.ai_import_items AS items
		SET user_edited_at=COALESCE(items.user_edited_at,statement_timestamp())
		WHERE items.result_card_id=p_card_id AND items.status='finalized';
	END IF;
	RETURN jsonb_build_object(
		'cardId',p_card_id,'illustrationId',p_illustration_id,'illustrationKey',target_key
	);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_import_async(
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
DECLARE target_batch_id uuid;
DECLARE concept_row record;
DECLARE created_job_id uuid;
DECLARE created_illustration_id uuid;
DECLARE message_id bigint;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  result := public.commit_import_internal(
    p_actor_user_id, p_source, p_idempotency_key, p_import_request_hash,
    p_request, p_card_reservation_key
  );
  target_batch_id := (result ->> 'batchId')::uuid;

  FOR concept_row IN
    SELECT items.concept_id,
      min(items.image_mode) AS image_mode,
      max(items.image_mode) AS max_image_mode,
      min(items.upload_id::text)::uuid AS upload_id,
      max(items.upload_id::text)::uuid AS max_upload_id
    FROM public.ai_import_items AS items
    WHERE items.batch_id = target_batch_id AND items.owner_user_id = p_actor_user_id
    GROUP BY items.concept_id
    ORDER BY items.concept_id
  LOOP
    IF concept_row.image_mode IS DISTINCT FROM concept_row.max_image_mode OR
       concept_row.upload_id IS DISTINCT FROM concept_row.max_upload_id THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'items.image', 'rule', 'conceptConsistency')
      );
    END IF;
    SELECT jobs.id INTO created_job_id
    FROM public.ai_import_concept_jobs AS jobs
    WHERE jobs.batch_id = target_batch_id AND jobs.concept_id = concept_row.concept_id
    FOR UPDATE;
    IF FOUND THEN CONTINUE; END IF;

    IF concept_row.image_mode <> 'none' THEN
      INSERT INTO public.illustrations (
        owner_user_id, illustration_key, status, storage_path, prompt, model_info
      ) VALUES (
        p_actor_user_id,
        's11:' || target_batch_id::text || ':' || encode(
          extensions.digest(convert_to(concept_row.concept_id, 'UTF8'), 'sha256'), 'hex'
        ),
        'pending', NULL, NULL, NULL
      ) RETURNING id INTO STRICT created_illustration_id;
    ELSE
      created_illustration_id := NULL;
    END IF;

    INSERT INTO public.ai_import_concept_jobs (
      owner_user_id, batch_id, concept_id, illustration_id
    ) VALUES (
      p_actor_user_id, target_batch_id, concept_row.concept_id, created_illustration_id
    ) RETURNING id INTO STRICT created_job_id;

		IF concept_row.upload_id IS NOT NULL THEN
			INSERT INTO public.ai_upload_consumers(upload_id,job_id,owner_user_id)
			SELECT uploads.id,created_job_id,p_actor_user_id
			FROM public.ai_uploads uploads
			WHERE uploads.id=concept_row.upload_id AND uploads.owner_user_id=p_actor_user_id
				AND uploads.status='ready';
			IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
		END IF;

    IF created_illustration_id IS NOT NULL THEN
      INSERT INTO public.ai_illustration_objects (
        owner_user_id, job_id, illustration_id, storage_path, state,
        delete_due_at
      ) VALUES (
        p_actor_user_id, created_job_id, created_illustration_id,
        p_actor_user_id::text || '/s11-managed/' || created_illustration_id::text || '.png',
        'uploading', statement_timestamp() + interval '23 hours 45 minutes'
      );
    END IF;

    SELECT pgmq.send(
      'ai_card_imports',
      jsonb_build_object('version', 1, 'jobId', created_job_id, 'batchId', target_batch_id)
    ) INTO STRICT message_id;
    UPDATE public.ai_import_concept_jobs SET queue_message_id = message_id
    WHERE id = created_job_id;
  END LOOP;

  RETURN jsonb_build_object(
    'batchId', target_batch_id,
    'status', 'queued',
    'statusUrl', '/api/ai/imports/status?batchId=' || target_batch_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_import_status(
  p_actor_user_id uuid,
  p_batch_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target_batch public.ai_import_batches%ROWTYPE;
DECLARE response_status text;
DECLARE item_rows jsonb;
DECLARE succeeded_count integer;
DECLARE failed_count integer;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_actor_user_id IS NULL OR (p_batch_id IS NULL) = (p_idempotency_key IS NULL) THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR', jsonb_build_object('field','status','rule','selector'));
  END IF;
  SELECT batches.* INTO target_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.owner_user_id = p_actor_user_id
    AND ((p_batch_id IS NOT NULL AND batches.id = p_batch_id) OR
         (p_idempotency_key IS NOT NULL AND batches.idempotency_key = p_idempotency_key));
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;

  SELECT count(*) FILTER (WHERE items.status = 'finalized'),
    count(*) FILTER (WHERE items.status = 'failed'),
    coalesce(jsonb_agg(jsonb_build_object(
      'itemId', items.id,
      'conceptId', items.concept_id,
      'status', CASE items.status
        WHEN 'committed' THEN 'queued' WHEN 'finalized' THEN 'succeeded'
        WHEN 'deleted' THEN 'undone' ELSE items.status END,
      'cardId', items.result_card_id,
      'errorCode', items.error_code
    ) ORDER BY items.ordinal), '[]'::jsonb)
  INTO succeeded_count, failed_count, item_rows
  FROM public.ai_import_items AS items WHERE items.batch_id = target_batch.id;

  response_status := CASE
    WHEN target_batch.status = 'undone' THEN 'undone'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND failed_count = 0 THEN 'completed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND succeeded_count = 0 THEN 'failed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count THEN 'partial'
    WHEN EXISTS (SELECT 1 FROM public.ai_import_items i WHERE i.batch_id = target_batch.id AND i.status = 'processing') THEN 'processing'
    ELSE 'queued'
  END;
  RETURN jsonb_build_object(
    'batchId', target_batch.id,
    'status', response_status,
    'counts', jsonb_build_object('total', target_batch.requested_card_count, 'succeeded', succeeded_count, 'failed', failed_count),
    'items', item_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_ai_source_upload(
  p_owner_user_id uuid,
  p_upload_key text,
  p_declared_mime text,
  p_byte_size bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_id uuid := gen_random_uuid();
DECLARE raw_path text;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_owner_user_id IS NULL OR char_length(p_upload_key) NOT BETWEEN 1 AND 128 OR
     p_declared_mime NOT IN ('image/png','image/jpeg','image/webp') OR
     p_byte_size NOT BETWEEN 1 AND 10485760 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR', jsonb_build_object('field','source','rule','metadata'));
  END IF;
  raw_path := p_owner_user_id::text || '/' || upload_id::text || '/raw';
  INSERT INTO public.ai_uploads (
    id, owner_user_id, upload_key, purpose, storage_path, mime_type, byte_size,
		status, raw_storage_path, raw_storage_bucket, delete_due_at
  ) VALUES (
    upload_id, p_owner_user_id, p_upload_key, 'card_illustration', raw_path,
		p_declared_mime, p_byte_size, 'prepared', raw_path, 'ai-card-sources',
    statement_timestamp() + interval '23 hours 45 minutes'
  );
  RETURN jsonb_build_object('uploadId', upload_id, 'path', raw_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_source_ready(
  p_owner_user_id uuid,
  p_upload_id uuid,
  p_detected_mime text,
  p_actual_byte_size bigint,
  p_width integer,
  p_height integer,
  p_digest text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE source_path text;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  source_path := p_owner_user_id::text || '/' || p_upload_id::text || '/source';
  UPDATE public.ai_uploads SET
    status = 'ready', storage_path = source_path, source_storage_path = source_path,
		source_storage_bucket = 'ai-card-sources',
		source_write_intent_path = NULL, source_write_intent_bucket = NULL,
    detected_mime_type = p_detected_mime, byte_size = p_actual_byte_size,
    width = p_width, height = p_height, sha256 = p_digest
  WHERE id = p_upload_id AND owner_user_id = p_owner_user_id AND status = 'prepared'
		AND source_write_intent_path=source_path
		AND source_write_intent_bucket='ai-card-sources'
    AND p_detected_mime = 'image/png'
    AND p_actual_byte_size BETWEEN 1 AND 10485760
    AND p_width > 0 AND p_height > 0 AND p_width::bigint * p_height::bigint <= 16000000
    AND p_digest ~ '^[0-9a-f]{64}$';
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  RETURN jsonb_build_object('uploadId', p_upload_id, 'status', 'ready', 'path', source_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_ai_source_ready(
  p_owner_user_id uuid,
  p_upload_id uuid,
  p_detected_mime text,
  p_actual_byte_size bigint,
  p_width integer,
  p_height integer,
  p_digest text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_row public.ai_uploads%ROWTYPE;
DECLARE source_path text := p_owner_user_id::text || '/' || p_upload_id::text || '/source';
BEGIN
	PERFORM public.ai_s11_require_service_role();
	SELECT * INTO upload_row FROM public.ai_uploads
	WHERE id=p_upload_id AND owner_user_id=p_owner_user_id FOR UPDATE;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','ambiguous'); END IF;
	IF upload_row.status='ready' AND upload_row.storage_path=source_path AND
		upload_row.source_storage_path=source_path AND
		upload_row.source_storage_bucket='ai-card-sources' AND
		upload_row.source_write_intent_path IS NULL AND
		upload_row.source_write_intent_bucket IS NULL AND
		upload_row.detected_mime_type=p_detected_mime AND
		upload_row.byte_size=p_actual_byte_size AND upload_row.width=p_width AND
		upload_row.height=p_height AND upload_row.sha256=p_digest THEN
		RETURN jsonb_build_object('outcome','ready','uploadId',p_upload_id,
			'status','ready','path',source_path);
	END IF;
	IF upload_row.status='prepared' AND upload_row.source_storage_path IS NULL AND
		upload_row.source_storage_bucket IS NULL AND upload_row.sha256 IS NULL AND
		upload_row.source_write_intent_path=source_path AND
		upload_row.source_write_intent_bucket='ai-card-sources' THEN
		RETURN jsonb_build_object('outcome','uncommitted');
	END IF;
	RETURN jsonb_build_object('outcome','ambiguous');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_source_write_intent(
	p_owner_user_id uuid,p_upload_id uuid,p_source_path text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_source_path IS DISTINCT FROM p_owner_user_id::text||'/'||p_upload_id::text||'/source' THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
	UPDATE public.ai_uploads SET
		source_write_intent_path=p_source_path,
		source_write_intent_bucket='ai-card-sources'
	WHERE id=p_upload_id AND owner_user_id=p_owner_user_id AND status='prepared'
		AND source_storage_path IS NULL
		AND (source_write_intent_path IS NULL OR source_write_intent_path=p_source_path);
	IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_source_after_terminal(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_row public.ai_uploads%ROWTYPE;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	SELECT uploads.* INTO upload_row
	FROM public.ai_upload_consumers consumers
	JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
	JOIN public.ai_uploads uploads ON uploads.id=consumers.upload_id
	WHERE consumers.job_id=p_job_id AND jobs.state IN ('succeeded','failed','undone')
	FOR UPDATE OF uploads;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','retain'); END IF;
	IF EXISTS (
		SELECT 1 FROM public.ai_upload_consumers consumers
		JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
		WHERE consumers.upload_id=upload_row.id
			AND jobs.state NOT IN ('succeeded','failed','undone')
	) THEN RETURN jsonb_build_object('outcome','retain'); END IF;
	IF upload_row.source_storage_path IS NULL OR upload_row.source_storage_bucket IS NULL THEN
		RETURN jsonb_build_object('outcome','retain');
	END IF;
	IF upload_row.status IN ('cleanup_pending','cleaning','deleted') THEN
		RETURN jsonb_build_object('outcome','retain');
	END IF;
	UPDATE public.ai_uploads SET status='cleanup_pending',
		consumed_at=COALESCE(consumed_at,statement_timestamp()),
		delete_due_at=LEAST(COALESCE(delete_due_at,statement_timestamp()),statement_timestamp()),
		cleanup_claimed_at=NULL,cleanup_claim_token=NULL
	WHERE id=upload_row.id;
	RETURN jsonb_build_object(
		'outcome','delete','bucket',upload_row.source_storage_bucket,
		'path',upload_row.source_storage_path
	);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_source_cleanup(
	p_job_id uuid,p_bucket text,p_path text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
  UPDATE public.ai_uploads SET status = 'cleanup_pending',
    delete_due_at=LEAST(COALESCE(delete_due_at,statement_timestamp()),statement_timestamp()),
    cleanup_claimed_at=NULL,cleanup_claim_token=NULL
	WHERE id IN (SELECT upload_id FROM public.ai_upload_consumers WHERE job_id=p_job_id)
		AND source_storage_bucket=p_bucket AND source_storage_path=p_path
		AND status IN ('prepared','ready','consumed','cleanup_pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_source_deleted(
	p_job_id uuid,p_bucket text,p_path text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
  UPDATE public.ai_uploads SET
    source_storage_path=NULL,
    status=CASE WHEN raw_storage_path IS NULL THEN 'deleted' ELSE 'cleanup_pending' END,
    deleted_at=CASE WHEN raw_storage_path IS NULL THEN statement_timestamp() ELSE NULL END,
		delete_due_at=CASE WHEN raw_storage_path IS NULL THEN delete_due_at ELSE statement_timestamp() END,
		cleanup_claimed_at=NULL,cleanup_claim_token=NULL,
		source_storage_bucket=NULL
	WHERE id IN (SELECT upload_id FROM public.ai_upload_consumers WHERE job_id=p_job_id)
		AND source_storage_bucket=p_bucket AND source_storage_path=p_path
		AND status IN ('ready','consumed','cleanup_pending','cleaning');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_upload_cleanup(
	p_owner_user_id uuid,p_upload_id uuid,p_source_path text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
	IF p_source_path IS NOT NULL AND
		p_source_path<>p_owner_user_id::text||'/'||p_upload_id::text||'/source' THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
  UPDATE public.ai_uploads SET
		status='cleanup_pending',
    delete_due_at=LEAST(
      COALESCE(delete_due_at,statement_timestamp()),
      statement_timestamp()
    ),
    cleanup_claimed_at=NULL,cleanup_claim_token=NULL
  WHERE id=p_upload_id AND owner_user_id=p_owner_user_id
		AND status='prepared'
		AND (
			(p_source_path IS NULL AND source_write_intent_path IS NULL
				AND source_write_intent_bucket IS NULL) OR
			(p_source_path IS NOT NULL AND source_write_intent_path=p_source_path
				AND source_write_intent_bucket='ai-card-sources')
		);
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_source_raw_deleted(p_owner_user_id uuid,p_upload_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
	UPDATE public.ai_uploads SET raw_storage_path=NULL,raw_storage_bucket=NULL,
		raw_cleanup_claimed_at=NULL,raw_cleanup_claim_token=NULL
  WHERE id=p_upload_id AND owner_user_id=p_owner_user_id;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_ai_import_queue(p_visibility_seconds integer, p_quantity integer)
RETURNS TABLE(message_id bigint, read_count integer, enqueued_at timestamptz, message jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_visibility_seconds <> 300 OR p_quantity <> 1 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR', jsonb_build_object('field','queue','rule','readBoundary'));
  END IF;
	RETURN QUERY SELECT messages.msg_id, messages.read_ct, messages.enqueued_at, messages.message
	FROM pgmq.read('ai_card_imports', p_visibility_seconds, p_quantity, '{}'::jsonb) AS messages;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_ai_import_concept(
  p_job_id uuid, p_message_id bigint, p_claim_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
DECLARE representative public.ai_import_items%ROWTYPE;
DECLARE object_row public.ai_illustration_objects%ROWTYPE;
DECLARE reservation_key text;
DECLARE generation_hash text;
DECLARE db_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ai_s11_require_service_role();
  SELECT jobs.* INTO job FROM public.ai_import_concept_jobs jobs WHERE jobs.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing'); END IF;
  IF job.state IN ('succeeded','failed','undone') THEN RETURN jsonb_build_object('outcome','terminal'); END IF;
  IF job.queue_message_id IS DISTINCT FROM p_message_id THEN RETURN jsonb_build_object('outcome','stale'); END IF;
  IF job.state = 'processing' AND job.claim_expires_at > db_now THEN RETURN jsonb_build_object('outcome','active'); END IF;
  IF job.state NOT IN ('queued','processing') THEN RETURN jsonb_build_object('outcome','terminal'); END IF;

  UPDATE public.ai_import_concept_jobs SET state='processing', claim_token=p_claim_token,
    claim_expires_at=db_now + interval '300 seconds', next_attempt_at=NULL, updated_at=db_now
  WHERE id=p_job_id;
  UPDATE public.ai_import_items SET status='processing', updated_at=db_now
  WHERE batch_id=job.batch_id AND concept_id=job.concept_id AND status='committed';

  SELECT items.* INTO representative FROM public.ai_import_items items
  WHERE items.batch_id=job.batch_id AND items.concept_id=job.concept_id
  ORDER BY CASE items.pattern WHEN 'R1' THEN 0 ELSE 1 END, items.ordinal LIMIT 1 FOR UPDATE;
  IF representative.image_mode <> 'none' AND representative.illustration_reservation_key IS NULL THEN
    reservation_key := 's11:' || job.id::text;
    generation_hash := encode(extensions.digest(convert_to(job.id::text,'UTF8'),'sha256'),'hex');
    PERFORM public.reserve_provider_usage_internal(
      job.owner_user_id, reservation_key, 'illustration_concept',
      (SELECT source FROM public.ai_import_batches WHERE id=job.batch_id), generation_hash,
      CASE representative.image_mode WHEN 'ai' THEN 1 ELSE 0 END,
      job.batch_id, representative.id, job.concept_id, db_now
    );
    UPDATE public.ai_import_items SET illustration_reservation_key=reservation_key, status='processing'
    WHERE batch_id=job.batch_id AND concept_id=job.concept_id;
  END IF;

  SELECT objects.* INTO object_row FROM public.ai_illustration_objects objects WHERE objects.job_id=job.id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'outcome','claimed','jobId',job.id,'batchId',job.batch_id,'claimToken',p_claim_token,
    'attempt',job.attempt,'imageMode',representative.image_mode,
		'backText',CASE WHEN representative.image_mode='ai' THEN representative.back_text ELSE NULL END,
		'skill',CASE WHEN representative.image_mode='ai' THEN representative.skill ELSE NULL END,
		'sourcePath',(SELECT uploads.source_storage_path FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
		'sourceBucket',(SELECT uploads.source_storage_bucket FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'sourceMime',(SELECT uploads.detected_mime_type FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'illustrationId',job.illustration_id,'illustrationPath',object_row.storage_path
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_assert_active_claim(
	p_job_id uuid,p_claim_token uuid,p_message_id bigint DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM 1 FROM public.ai_import_concept_jobs jobs
	WHERE jobs.id=p_job_id AND jobs.state='processing'
		AND jobs.claim_token=p_claim_token
		AND jobs.claim_expires_at>clock_timestamp()
		AND (p_message_id IS NULL OR jobs.queue_message_id=p_message_id)
	FOR UPDATE;
	IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_ai_import_retry(
  p_job_id uuid, p_message_id bigint, p_claim_token uuid,
  p_error_code text, p_delay_seconds integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
DECLARE next_message_id bigint;
DECLARE expected_delay integer;
BEGIN
  PERFORM public.ai_s11_require_service_role();
	PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token,p_message_id);
  SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id FOR UPDATE;
  expected_delay := (ARRAY[5,30,120])[job.attempt + 1];
  IF job.attempt >= 3 OR p_delay_seconds IS DISTINCT FROM expected_delay THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  SELECT pgmq.send('ai_card_imports', jsonb_build_object(
    'version',1,'jobId',job.id,'batchId',job.batch_id
  ), p_delay_seconds) INTO STRICT next_message_id;
  UPDATE public.ai_import_concept_jobs SET state='queued', attempt=attempt+1,
    queue_message_id=next_message_id, claim_token=NULL, claim_expires_at=NULL,
    next_attempt_at=statement_timestamp()+make_interval(secs=>p_delay_seconds),
    error_code=p_error_code, updated_at=statement_timestamp() WHERE id=job.id;
  UPDATE public.ai_import_items SET status='committed' WHERE batch_id=job.batch_id AND concept_id=job.concept_id;
  IF NOT pgmq.archive('ai_card_imports', p_message_id) THEN RAISE EXCEPTION 'queue archive failed'; END IF;
  RETURN jsonb_build_object('status','queued','messageId',next_message_id,'attempt',job.attempt+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_illustration_uploading(
  p_job_id uuid, p_claim_token uuid, p_digest text, p_width integer, p_height integer
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
	PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token);
  UPDATE public.ai_illustration_objects SET state='uploading', digest=p_digest,
    width=p_width,height=p_height,updated_at=statement_timestamp()
  WHERE job_id=p_job_id AND p_digest ~ '^[0-9a-f]{64}$'
    AND p_width BETWEEN 1 AND 1024 AND p_height BETWEEN 1 AND 1024;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_illustration_orphan(
  p_job_id uuid, p_claim_token uuid, p_error_code text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
	PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token);
	UPDATE public.ai_illustration_objects objects SET state='orphan', error_code=p_error_code,
		delete_due_at=LEAST(COALESCE(objects.delete_due_at,statement_timestamp()),
			statement_timestamp()), updated_at=statement_timestamp()
	WHERE objects.job_id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_record_worker_event(
	p_event_type text,p_message_id bigint,p_job_id uuid,p_batch_id uuid,
	p_error_code text,p_reason text,p_attempt smallint
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE recorded_id uuid;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_event_type IS NULL OR p_event_type NOT IN ('worker_failure','worker_poison','worker_duplicate') OR
		p_message_id IS NULL OR
		(p_event_type='worker_failure' AND (p_error_code IS NULL OR p_job_id IS NULL OR p_batch_id IS NULL)) OR
		(p_event_type='worker_duplicate' AND (p_error_code IS DISTINCT FROM 'DUPLICATE_EXISTING' OR p_job_id IS NULL OR p_batch_id IS NULL)) OR
		(p_event_type='worker_poison' AND (p_reason IS NULL OR p_reason NOT IN ('MALFORMED_PAYLOAD','JOB_MISSING'))) THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
	INSERT INTO public.ai_worker_log_outbox(
		event_type,queue_message_id,job_id,batch_id,error_code,reason,attempt
	) VALUES (
		p_event_type,p_message_id,p_job_id,p_batch_id,p_error_code,p_reason,p_attempt
	)
	ON CONFLICT (event_type,queue_message_id) DO UPDATE
		SET queue_message_id=EXCLUDED.queue_message_id
	RETURNING event_id INTO recorded_id;
	RETURN recorded_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_ai_worker_log_outbox(p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE claimed public.ai_worker_log_outbox%ROWTYPE;
DECLARE db_now timestamptz := clock_timestamp();
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_claim_token IS NULL THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	WITH candidate AS (
		SELECT event_id FROM public.ai_worker_log_outbox
		WHERE dispatched_at IS NULL AND (
			dispatch_claim_token IS NULL OR dispatch_claimed_at<=db_now-interval '5 minutes'
		)
		ORDER BY created_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED
	)
	UPDATE public.ai_worker_log_outbox outbox SET
		dispatch_claim_token=p_claim_token,dispatch_claimed_at=db_now
	FROM candidate WHERE outbox.event_id=candidate.event_id
	RETURNING outbox.* INTO claimed;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','empty'); END IF;
	RETURN jsonb_build_object(
		'outcome','claimed','eventId',claimed.event_id,'event',claimed.event_type,
		'queueMessageId',claimed.queue_message_id,'jobId',claimed.job_id,
		'batchId',claimed.batch_id,'errorCode',claimed.error_code,
		'reason',claimed.reason,'attempt',claimed.attempt
	);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_worker_log_outbox(p_event_id uuid,p_claim_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM public.ai_s11_require_service_role();
	UPDATE public.ai_worker_log_outbox SET
		dispatched_at=statement_timestamp(),dispatch_claim_token=NULL,dispatch_claimed_at=NULL
	WHERE event_id=p_event_id AND dispatched_at IS NULL AND dispatch_claim_token=p_claim_token
		AND dispatch_claimed_at>clock_timestamp()-interval '5 minutes';
	IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ai_worker_log_reason(
	p_message_id bigint,p_event_type text,p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_event_type<>'worker_duplicate' OR
		p_reason NOT IN ('COMPENSATION_DELETED','COMPENSATION_PENDING') THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
	UPDATE public.ai_worker_log_outbox SET reason=p_reason
	WHERE queue_message_id=p_message_id AND event_type=p_event_type AND dispatched_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_fail_concept_locked(
  p_job_id uuid,p_message_id bigint,p_claim_token uuid,p_error_code text,
	p_event_type text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
DECLARE batch_summary jsonb;
DECLARE auto_deck_id uuid;
BEGIN
  IF p_error_code <> ALL (ARRAY[
    'INVALID_QUEUE_MESSAGE','CLAIM_LOST','PROVIDER_CONFIG_ERROR',
    'PROVIDER_TRANSIENT_ERROR','PROVIDER_PERMANENT_ERROR','IMAGE_FORMAT_INVALID',
    'IMAGE_TOO_LARGE','IMAGE_DIMENSIONS_INVALID','IMAGE_DECODE_FAILED',
    'OBJECT_CONFLICT','STORAGE_TRANSIENT_ERROR','STORAGE_PERMANENT_ERROR',
    'INTERNAL_ERROR','DUPLICATE_EXISTING'
  ]) THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
	PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token,p_message_id);
  SELECT * INTO job FROM public.ai_import_concept_jobs
  WHERE id=p_job_id FOR UPDATE;
	PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[job.illustration_id]);

  UPDATE public.ai_import_items SET
    status='failed',result_card_id=NULL,error_code=p_error_code,
    error_detail=jsonb_build_object('source','s11','attempt',job.attempt),
    terminal_attempt_key='s11:'||job.id::text||':terminal',
    failed_at=statement_timestamp(),finalized_at=NULL,updated_at=statement_timestamp()
  WHERE batch_id=job.batch_id AND concept_id=job.concept_id
    AND status IN ('committed','processing');
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;

  UPDATE public.illustrations SET status='failed',prompt=NULL,model_info=NULL,
    storage_path=NULL,updated_at=statement_timestamp()
  WHERE id=job.illustration_id;
  UPDATE public.ai_illustration_objects SET state='orphan',error_code=p_error_code,
    delete_due_at=LEAST(
      COALESCE(delete_due_at,statement_timestamp()+interval '23 hours 45 minutes'),
      created_at+interval '23 hours 45 minutes'
    ),updated_at=statement_timestamp()
  WHERE job_id=job.id AND state <> 'deleted';
	UPDATE public.ai_import_concept_jobs SET state='failed',
		terminal_message_id=p_message_id,
		terminal_claim_token_hash=encode(extensions.digest(
			convert_to(p_claim_token::text,'UTF8'),'sha256'),'hex'),
		claim_token=NULL,claim_expires_at=NULL,
    error_code=p_error_code,completed_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE id=job.id;

  batch_summary := public.ai_recount_import_batch(job.owner_user_id,job.batch_id);
  IF batch_summary->>'status' = 'completed' AND (batch_summary->>'finalizedCount')::integer = 0 THEN
    SELECT batches.auto_created_deck_id INTO auto_deck_id
    FROM public.ai_import_batches batches WHERE batches.id=job.batch_id FOR UPDATE;
    IF auto_deck_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.deck_cards WHERE deck_id=auto_deck_id
    ) THEN
      DELETE FROM public.decks WHERE id=auto_deck_id AND owner_user_id=job.owner_user_id;
    END IF;
  END IF;
	IF p_error_code='DUPLICATE_EXISTING' THEN
		IF p_event_type IS DISTINCT FROM 'worker_duplicate' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
		PERFORM public.ai_s11_record_worker_event(
			p_event_type,p_message_id,job.id,job.batch_id,p_error_code,'COMPENSATION_PENDING',job.attempt
		);
	ELSIF p_event_type IS NOT NULL THEN
		IF p_event_type<>'worker_failure' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
		PERFORM public.ai_s11_record_worker_event(
			p_event_type,p_message_id,job.id,job.batch_id,p_error_code,NULL,job.attempt
		);
	END IF;
  IF NOT pgmq.archive('ai_card_imports',p_message_id) THEN
    RAISE EXCEPTION 'queue archive failed';
  END IF;
  RETURN jsonb_build_object('status','failed','errorCode',p_error_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_ai_import_concept(
  p_job_id uuid, p_message_id bigint, p_claim_token uuid,
  p_illustration_id uuid DEFAULT NULL, p_digest text DEFAULT NULL,
  p_width integer DEFAULT NULL, p_height integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
DECLARE item public.ai_import_items%ROWTYPE;
DECLARE batch public.ai_import_batches%ROWTYPE;
DECLARE created_card_id uuid;
DECLARE illustration_key text;
DECLARE item_count integer;
DECLARE processing_count integer;
DECLARE pattern_count integer;
DECLARE duplicate_found boolean;
DECLARE insert_conflict boolean := false;
DECLARE upload_id uuid;
BEGIN
  PERFORM public.ai_s11_require_service_role();
	PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token,p_message_id);
  SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id FOR UPDATE;
  IF job.illustration_id IS DISTINCT FROM p_illustration_id THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[job.illustration_id]);
  SELECT * INTO batch FROM public.ai_import_batches
  WHERE id=job.batch_id AND owner_user_id=job.owner_user_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM 1 FROM public.decks
  WHERE id=batch.target_deck_id AND owner_user_id=job.owner_user_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;

  SELECT count(*),count(*) FILTER (WHERE status='processing'),count(DISTINCT pattern)
    INTO item_count,processing_count,pattern_count FROM public.ai_import_items
  WHERE batch_id=job.batch_id AND concept_id=job.concept_id
    AND owner_user_id=job.owner_user_id;
  IF item_count NOT BETWEEN 1 AND 2 OR processing_count <> item_count OR
     pattern_count <> item_count OR EXISTS (
       SELECT 1 FROM public.ai_import_items
       WHERE batch_id=job.batch_id AND concept_id=job.concept_id
         AND pattern NOT IN ('R1','W1')
     ) THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  FOR item IN SELECT * FROM public.ai_import_items
    WHERE batch_id=job.batch_id AND concept_id=job.concept_id ORDER BY card_key FOR UPDATE
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      job.owner_user_id::text||chr(31)||'card-key'||chr(31)||item.card_key,1011
    ));
  END LOOP;
  SELECT EXISTS (
    SELECT 1 FROM public.cards cards JOIN public.ai_import_items items
      ON items.card_key=cards.card_key
    WHERE items.batch_id=job.batch_id AND items.concept_id=job.concept_id
      AND cards.owner_user_id=job.owner_user_id AND cards.visibility='private'
  ) INTO duplicate_found;
  IF duplicate_found THEN
    RETURN public.ai_s11_fail_concept_locked(
      p_job_id,p_message_id,p_claim_token,'DUPLICATE_EXISTING','worker_duplicate'
    );
  END IF;

  PERFORM 1 FROM public.ai_quota_reservations reservations
  WHERE reservations.owner_user_id=job.owner_user_id
    AND reservations.batch_id=job.batch_id
    AND reservations.reservation_key=batch.card_reservation_key
    AND reservations.kind='card_generation' AND reservations.provider_started_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;

  IF p_illustration_id IS NOT NULL THEN
    IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR
       p_width IS NULL OR p_width NOT BETWEEN 1 AND 1024 OR
       p_height IS NULL OR p_height NOT BETWEEN 1 AND 1024 THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
    PERFORM 1 FROM public.ai_quota_reservations reservations
    WHERE reservations.owner_user_id=job.owner_user_id AND reservations.batch_id=job.batch_id
      AND reservations.reservation_key='s11:'||job.id::text
      AND reservations.kind='illustration_concept' AND reservations.concept_id=job.concept_id
      AND reservations.provider_started_at IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
    UPDATE public.illustrations SET status='ready',
      storage_path=(SELECT storage_path FROM public.ai_illustration_objects WHERE job_id=job.id),
      model_info='s11-managed', prompt=NULL, updated_at=statement_timestamp()
    WHERE id=p_illustration_id AND owner_user_id=job.owner_user_id;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
    SELECT illustrations.illustration_key INTO illustration_key
    FROM public.illustrations illustrations WHERE illustrations.id=p_illustration_id;
    UPDATE public.ai_illustration_objects SET state='ready',digest=p_digest,width=p_width,height=p_height,
      error_code=NULL,updated_at=statement_timestamp() WHERE job_id=job.id;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  ELSE
    illustration_key := NULL;
  END IF;

  SELECT min(items.upload_id::text)::uuid INTO upload_id
  FROM public.ai_import_items items
  WHERE items.batch_id=job.batch_id AND items.concept_id=job.concept_id;
  IF upload_id IS NOT NULL THEN
    PERFORM 1 FROM public.ai_uploads uploads
    WHERE uploads.id=upload_id AND uploads.owner_user_id=job.owner_user_id
      AND uploads.status='ready' FOR UPDATE;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM public.ai_import_items items
      WHERE items.batch_id=job.batch_id AND items.concept_id=job.concept_id
        AND items.upload_id IS DISTINCT FROM upload_id
    ) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  END IF;

  PERFORM public.ai_enable_internal_context();
  BEGIN
    FOR item IN SELECT * FROM public.ai_import_items
      WHERE batch_id=job.batch_id AND concept_id=job.concept_id ORDER BY ordinal FOR UPDATE
    LOOP
      INSERT INTO public.cards (
        owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key
      ) VALUES (
        job.owner_user_id,'private',item.skill,item.pattern,item.front_text,item.back_text,
        illustration_key,item.card_key
      ) RETURNING id INTO STRICT created_card_id;
      INSERT INTO public.deck_cards(deck_id,card_id) VALUES(batch.target_deck_id,created_card_id);
      INSERT INTO public.card_tags(owner_user_id,card_id,tag_id)
      SELECT job.owner_user_id,created_card_id,item_tags.tag_id
      FROM public.ai_import_item_tags item_tags WHERE item_tags.item_id=item.id
      ORDER BY item_tags.tag_id;
      UPDATE public.ai_import_items SET status='finalized',result_card_id=created_card_id,
        finalized_at=statement_timestamp(),error_code=NULL,error_detail='{}'::jsonb,
        terminal_attempt_key=NULL,updated_at=statement_timestamp()
      WHERE id=item.id AND status='processing';
      IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    insert_conflict := true;
  WHEN OTHERS THEN
    PERFORM public.ai_disable_internal_context();
    RAISE;
  END;
  PERFORM public.ai_disable_internal_context();
  IF insert_conflict THEN
    RETURN public.ai_s11_fail_concept_locked(
      p_job_id,p_message_id,p_claim_token,'DUPLICATE_EXISTING','worker_duplicate'
    );
  END IF;
	-- The upload remains ready until every durable consumer association is terminal.
	-- release_ai_source_after_terminal performs the one deterministic transition to cleanup.
  PERFORM public.ai_recount_import_batch(job.owner_user_id,job.batch_id);
  UPDATE public.ai_import_concept_jobs SET state='succeeded',claim_token=NULL,claim_expires_at=NULL,
    error_code=NULL,completed_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=job.id;
  IF NOT pgmq.archive('ai_card_imports',p_message_id) THEN RAISE EXCEPTION 'queue archive failed'; END IF;
  RETURN jsonb_build_object('status','succeeded');
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_ai_import_concept(
  p_job_id uuid,p_message_id bigint,p_claim_token uuid,p_error_code text,
	p_event_type text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
  RETURN public.ai_s11_fail_concept_locked(
    p_job_id,p_message_id,p_claim_token,p_error_code,p_event_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_import_finalize_state(
  p_job_id uuid,p_message_id bigint,p_claim_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','claim_lost'); END IF;
  IF job.state='succeeded' THEN RETURN jsonb_build_object('outcome','terminal_success'); END IF;
	IF job.state='failed' AND job.error_code='DUPLICATE_EXISTING' AND
		job.terminal_message_id=p_message_id AND
		job.terminal_claim_token_hash=encode(extensions.digest(
			convert_to(p_claim_token::text,'UTF8'),'sha256'),'hex') THEN
		RETURN jsonb_build_object('outcome','terminal_duplicate');
	END IF;
  IF job.state='processing' AND job.queue_message_id=p_message_id AND job.claim_token=p_claim_token AND
		job.claim_expires_at>clock_timestamp() THEN
    RETURN jsonb_build_object('outcome','claim_owned_uncommitted');
  END IF;
  RETURN jsonb_build_object('outcome','claim_lost');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_import_failure_state(
  p_job_id uuid,p_message_id bigint,p_claim_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','claim_lost'); END IF;
	IF job.state='failed' AND job.terminal_message_id=p_message_id AND
		job.terminal_claim_token_hash=encode(extensions.digest(
			convert_to(p_claim_token::text,'UTF8'),'sha256'),'hex') THEN
		RETURN jsonb_build_object('outcome','terminal_failed');
	END IF;
  IF job.state='processing' AND job.queue_message_id=p_message_id AND job.claim_token=p_claim_token AND
		job.claim_expires_at>clock_timestamp() THEN
    RETURN jsonb_build_object('outcome','claim_owned_uncommitted');
  END IF;
  RETURN jsonb_build_object('outcome','claim_lost');
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_inert_delivery(
	p_job_id uuid,p_message_id bigint,p_event_type text DEFAULT NULL,p_reason text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE;
DECLARE archived boolean;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id;
  IF FOUND AND job.state NOT IN ('succeeded','failed','undone') AND job.queue_message_id=p_message_id THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
	IF (p_event_type IS NULL AND p_reason IS NOT NULL) OR
		(p_event_type IS NOT NULL AND (p_event_type<>'worker_poison' OR p_reason IS NULL OR
		p_reason NOT IN ('MALFORMED_PAYLOAD','JOB_MISSING'))) THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;
	IF p_event_type='worker_poison' THEN
		PERFORM public.ai_s11_record_worker_event(
			p_event_type,p_message_id,
			CASE WHEN p_reason='JOB_MISSING' THEN p_job_id ELSE NULL END,
			job.batch_id,
			'INVALID_QUEUE_MESSAGE',p_reason,NULL
		);
	END IF;
	archived := pgmq.archive('ai_card_imports',p_message_id);
	IF NOT archived THEN RAISE EXCEPTION 'queue archive failed'; END IF;
	RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_s11_track_card_reference_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE object_row public.ai_illustration_objects%ROWTYPE;
BEGIN
  IF OLD.illustration_key IS NOT NULL AND (TG_OP='DELETE' OR OLD.illustration_key IS DISTINCT FROM NEW.illustration_key) THEN
		SELECT objects.* INTO object_row
		FROM public.ai_illustration_objects objects
		JOIN public.illustrations illustrations ON illustrations.id=objects.illustration_id
		WHERE illustrations.illustration_key=OLD.illustration_key
			AND illustrations.owner_user_id=OLD.owner_user_id
		FOR UPDATE OF objects;
		IF FOUND THEN
			IF object_row.reference_count<=0 THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
			UPDATE public.ai_illustration_objects SET
				reference_count=object_row.reference_count-1,
				state=CASE WHEN object_row.reference_count=1 AND object_row.state='ready'
					THEN 'delete_pending' ELSE object_row.state END,
				delete_due_at=CASE WHEN object_row.reference_count=1 AND object_row.state='ready'
					THEN clock_timestamp() ELSE delete_due_at END,
				updated_at=clock_timestamp()
			WHERE id=object_row.id;
		END IF;
  END IF;
	IF NEW.illustration_key IS NOT NULL AND (TG_OP='INSERT' OR OLD.illustration_key IS DISTINCT FROM NEW.illustration_key) THEN
		SELECT objects.* INTO object_row
		FROM public.ai_illustration_objects objects
		JOIN public.illustrations illustrations ON illustrations.id=objects.illustration_id
		WHERE illustrations.illustration_key=NEW.illustration_key
			AND illustrations.owner_user_id=NEW.owner_user_id
		FOR UPDATE OF objects;
		IF FOUND THEN
			IF object_row.state<>'ready' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
			UPDATE public.ai_illustration_objects
			SET reference_count=object_row.reference_count+1,updated_at=clock_timestamp()
			WHERE id=object_row.id;
		END IF;
	END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS ai_s11_track_card_reference_removal ON public.cards;
CREATE TRIGGER ai_s11_track_card_reference_removal
AFTER INSERT OR UPDATE OF illustration_key OR DELETE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.ai_s11_track_card_reference_removal();

CREATE OR REPLACE FUNCTION public.ai_s11_guard_illustration_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[OLD.id]);
	IF EXISTS (
		SELECT 1 FROM public.ai_illustration_objects objects
		WHERE objects.illustration_id=OLD.id AND objects.state='deleted'
	) AND current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
		AND (NEW.status<>'failed' OR NEW.storage_path IS NOT NULL) THEN
		RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CONFLICT';
	END IF;
	RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ai_s11_guard_illustration_lifecycle ON public.illustrations;
CREATE TRIGGER ai_s11_guard_illustration_lifecycle
BEFORE UPDATE ON public.illustrations
FOR EACH ROW EXECUTE FUNCTION public.ai_s11_guard_illustration_lifecycle();

CREATE OR REPLACE FUNCTION public.ai_s11_guard_illustration_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE object_row record;
DECLARE illustration_ids uuid[];
BEGIN
	-- The mutating statement already owns its existing card row. Acquire every
	-- involved illustration before lifecycle tracking, and never lock siblings.
	SELECT COALESCE(array_agg(DISTINCT illustrations.id ORDER BY illustrations.id),'{}'::uuid[])
	INTO illustration_ids FROM public.illustrations illustrations
	WHERE (TG_OP<>'INSERT' AND OLD.illustration_key IS NOT NULL
		AND illustrations.owner_user_id=OLD.owner_user_id
		AND illustrations.illustration_key=OLD.illustration_key)
		OR (TG_OP<>'DELETE' AND NEW.illustration_key IS NOT NULL
			AND illustrations.owner_user_id=NEW.owner_user_id
			AND illustrations.illustration_key=NEW.illustration_key);
	PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);
	FOR object_row IN
		SELECT objects.*,illustrations.status AS illustration_status,
			illustrations.storage_path AS illustration_storage_path,
			illustrations.illustration_key AS tracked_key,
			illustrations.owner_user_id AS tracked_owner
		FROM public.illustrations illustrations
		JOIN public.ai_illustration_objects objects ON objects.illustration_id=illustrations.id
		WHERE (TG_OP<>'INSERT' AND OLD.illustration_key IS NOT NULL
			AND illustrations.owner_user_id=OLD.owner_user_id
			AND illustrations.illustration_key=OLD.illustration_key)
			OR (TG_OP<>'DELETE' AND NEW.illustration_key IS NOT NULL
				AND illustrations.owner_user_id=NEW.owner_user_id
				AND illustrations.illustration_key=NEW.illustration_key)
		ORDER BY objects.id
	LOOP
		IF TG_OP<>'DELETE' AND object_row.tracked_owner=NEW.owner_user_id
			AND object_row.tracked_key=NEW.illustration_key THEN
			IF object_row.illustration_status<>'ready' OR object_row.illustration_storage_path IS NULL THEN
				PERFORM public.ai_raise_import_error('CONFLICT');
			END IF;
			IF object_row.state='delete_pending' AND object_row.cleanup_claim_token IS NULL
				AND object_row.cleanup_claimed_at IS NULL AND object_row.cleanup_previous_state IS NULL
				AND object_row.reference_count=0 THEN
				-- The lifecycle lock makes this mutually exclusive with cleanup claiming.
				UPDATE public.ai_illustration_objects
				SET state='ready',delete_due_at=NULL,updated_at=clock_timestamp()
				WHERE id=object_row.id AND state='delete_pending'
					AND cleanup_claim_token IS NULL AND cleanup_claimed_at IS NULL
					AND cleanup_previous_state IS NULL AND reference_count=0;
				IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
			ELSIF object_row.state<>'ready' THEN
				PERFORM public.ai_raise_import_error('CONFLICT');
			END IF;
		END IF;
	END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS ai_s11_guard_illustration_reference ON public.cards;
CREATE TRIGGER ai_s11_guard_illustration_reference
BEFORE INSERT OR UPDATE OF illustration_key OR DELETE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.ai_s11_guard_illustration_reference();

CREATE OR REPLACE FUNCTION public.claim_ai_import_cleanup(p_limit integer)
RETURNS TABLE("trackingId" uuid,bucket text,path text,"claimToken" uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE db_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_limit NOT BETWEEN 1 AND 100 THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  RETURN QUERY
  WITH illustration_candidates AS MATERIALIZED (
		SELECT objects.id,
      COALESCE(objects.delete_due_at,objects.cleanup_claimed_at) AS due_at
    FROM public.ai_illustration_objects objects
    JOIN public.illustrations illustrations ON illustrations.id=objects.illustration_id
    WHERE (
		(objects.state='orphan' AND objects.delete_due_at <= db_now AND
		 objects.created_at + interval '24 hours' <= db_now) OR
		(objects.state='delete_pending' AND objects.delete_due_at <= db_now) OR
		(objects.state='cleaning' AND objects.cleanup_claimed_at <= db_now-interval '5 minutes' AND (
		 objects.cleanup_previous_state='delete_pending' OR
		 (objects.cleanup_previous_state='orphan' AND objects.created_at+interval '24 hours'<=db_now)
		))
    )
      AND objects.storage_path LIKE objects.owner_user_id::text || '/%'
      AND objects.reference_count=0
    ORDER BY COALESCE(objects.delete_due_at,objects.cleanup_claimed_at),objects.id
    LIMIT p_limit FOR UPDATE OF objects SKIP LOCKED
  ), upload_entity_candidates AS MATERIALIZED (
		SELECT uploads.id,
			LEAST(
				CASE WHEN
					COALESCE(uploads.source_storage_path,uploads.source_write_intent_path) IS NOT NULL AND
					((uploads.status IN ('prepared','ready','consumed','cleanup_pending') AND uploads.delete_due_at<=db_now) OR
					 (uploads.status='cleaning' AND uploads.cleanup_claimed_at<=db_now-interval '5 minutes')) AND
					uploads.created_at+interval '24 hours'<=db_now AND
					COALESCE(uploads.source_storage_path,uploads.source_write_intent_path)
						LIKE uploads.owner_user_id::text||'/%' AND
					NOT EXISTS (
						SELECT 1 FROM public.ai_upload_consumers consumers
						JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
						WHERE consumers.upload_id=uploads.id AND jobs.state IN ('queued','processing')
					)
				THEN COALESCE(uploads.delete_due_at,uploads.cleanup_claimed_at) END,
				CASE WHEN uploads.raw_storage_path IS NOT NULL AND uploads.delete_due_at<=db_now AND
					uploads.created_at+interval '24 hours'<=db_now AND
					(uploads.raw_cleanup_claimed_at IS NULL OR
					 uploads.raw_cleanup_claimed_at<=db_now-interval '5 minutes') AND
					uploads.raw_storage_path LIKE uploads.owner_user_id::text||'/%'
				THEN COALESCE(uploads.delete_due_at,uploads.raw_cleanup_claimed_at) END
			) AS due_at,
			COALESCE(uploads.source_storage_path,uploads.source_write_intent_path) IS NOT NULL AND
				((uploads.status IN ('prepared','ready','consumed','cleanup_pending') AND uploads.delete_due_at<=db_now) OR
				 (uploads.status='cleaning' AND uploads.cleanup_claimed_at<=db_now-interval '5 minutes')) AND
				uploads.created_at+interval '24 hours'<=db_now AND
				COALESCE(uploads.source_storage_path,uploads.source_write_intent_path)
					LIKE uploads.owner_user_id::text||'/%' AND
				NOT EXISTS (
					SELECT 1 FROM public.ai_upload_consumers consumers
					JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
					WHERE consumers.upload_id=uploads.id AND jobs.state IN ('queued','processing')
				) AS claim_source,
			uploads.raw_storage_path IS NOT NULL AND uploads.delete_due_at<=db_now AND
				uploads.created_at+interval '24 hours'<=db_now AND
				(uploads.raw_cleanup_claimed_at IS NULL OR
				 uploads.raw_cleanup_claimed_at<=db_now-interval '5 minutes') AND
				uploads.raw_storage_path LIKE uploads.owner_user_id::text||'/%' AS claim_raw
    FROM public.ai_uploads uploads
		WHERE (
			COALESCE(uploads.source_storage_path,uploads.source_write_intent_path) IS NOT NULL AND
			((uploads.status IN ('prepared','ready','consumed','cleanup_pending') AND uploads.delete_due_at<=db_now) OR
			 (uploads.status='cleaning' AND uploads.cleanup_claimed_at<=db_now-interval '5 minutes')) AND
			uploads.created_at+interval '24 hours'<=db_now AND
			COALESCE(uploads.source_storage_path,uploads.source_write_intent_path)
				LIKE uploads.owner_user_id::text||'/%' AND
			NOT EXISTS (
				SELECT 1 FROM public.ai_upload_consumers consumers
				JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
				WHERE consumers.upload_id=uploads.id AND jobs.state IN ('queued','processing')
			)
		) OR (
			uploads.raw_storage_path IS NOT NULL AND uploads.delete_due_at<=db_now AND
			uploads.created_at+interval '24 hours'<=db_now AND
			(uploads.raw_cleanup_claimed_at IS NULL OR
			 uploads.raw_cleanup_claimed_at<=db_now-interval '5 minutes') AND
			uploads.raw_storage_path LIKE uploads.owner_user_id::text||'/%'
		)
		ORDER BY uploads.delete_due_at,uploads.id
		LIMIT p_limit FOR UPDATE OF uploads SKIP LOCKED
  ), entity_pool AS (
		SELECT id,'illustration'::text AS entity_type,due_at FROM illustration_candidates
		UNION ALL
		SELECT id,'upload'::text,due_at FROM upload_entity_candidates
		WHERE claim_source OR claim_raw
	), selected_entities AS (
		SELECT * FROM entity_pool ORDER BY due_at,id,entity_type LIMIT p_limit
  ), claimed_objects AS (
    UPDATE public.ai_illustration_objects objects SET cleanup_previous_state=CASE
		WHEN objects.state='cleaning' THEN objects.cleanup_previous_state
		ELSE objects.state
	END,
		state='cleaning',cleanup_claimed_at=db_now,cleanup_claim_token=gen_random_uuid(),updated_at=db_now
		FROM selected_entities WHERE selected_entities.entity_type='illustration'
			AND objects.id=selected_entities.id
      AND (
        objects.state IN ('orphan','delete_pending') OR
        (objects.state='cleaning' AND objects.cleanup_claimed_at<=db_now-interval '5 minutes')
      )
		RETURNING objects.id,objects.storage_bucket AS bucket,objects.storage_path,objects.cleanup_claim_token
	), selected_uploads AS (
		SELECT upload_entity_candidates.* FROM upload_entity_candidates
		JOIN selected_entities ON selected_entities.id=upload_entity_candidates.id
			AND selected_entities.entity_type='upload'
	), claimed_uploads AS (
		UPDATE public.ai_uploads uploads SET
			cleanup_previous_status=CASE WHEN selected_uploads.claim_source THEN
				CASE WHEN uploads.status='cleaning' THEN uploads.cleanup_previous_status ELSE uploads.status END
				ELSE uploads.cleanup_previous_status END,
			status=CASE WHEN selected_uploads.claim_source THEN 'cleaning' ELSE uploads.status END,
			cleanup_claimed_at=CASE WHEN selected_uploads.claim_source THEN db_now ELSE uploads.cleanup_claimed_at END,
			cleanup_claim_token=CASE WHEN selected_uploads.claim_source THEN gen_random_uuid() ELSE uploads.cleanup_claim_token END,
			raw_cleanup_claimed_at=CASE WHEN selected_uploads.claim_raw THEN db_now ELSE uploads.raw_cleanup_claimed_at END,
			raw_cleanup_claim_token=CASE WHEN selected_uploads.claim_raw THEN gen_random_uuid() ELSE uploads.raw_cleanup_claim_token END
		FROM selected_uploads WHERE uploads.id=selected_uploads.id
		RETURNING uploads.id,
			COALESCE(uploads.source_storage_bucket,uploads.source_write_intent_bucket) AS source_bucket,
			COALESCE(uploads.source_storage_path,uploads.source_write_intent_path) AS source_path,
			uploads.cleanup_claim_token,uploads.raw_storage_bucket,uploads.raw_storage_path,
			uploads.raw_cleanup_claim_token,selected_uploads.claim_source,selected_uploads.claim_raw
	), claimed_sources AS (
		SELECT id,source_bucket AS bucket,source_path AS storage_path,
			cleanup_claim_token
		FROM claimed_uploads WHERE claim_source
	), claimed_raw AS (
		SELECT id,raw_storage_bucket AS bucket,raw_storage_path AS storage_path,
			raw_cleanup_claim_token AS cleanup_claim_token
		FROM claimed_uploads WHERE claim_raw
  )
  SELECT claimed.id,claimed.bucket,claimed.storage_path,claimed.cleanup_claim_token FROM (
    SELECT * FROM claimed_objects UNION ALL
    SELECT * FROM claimed_sources UNION ALL
    SELECT * FROM claimed_raw
  ) AS claimed ORDER BY claimed.id,claimed.storage_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_ai_import_cleanup(
  p_tracking_id uuid,p_bucket text,p_path text,p_claim_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE object_row public.ai_illustration_objects%ROWTYPE;
DECLARE upload_row public.ai_uploads%ROWTYPE;
DECLARE object_illustration_id uuid;
DECLARE db_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ai_s11_require_service_role();
	IF p_claim_token IS NULL THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	SELECT objects.illustration_id INTO object_illustration_id
	FROM public.ai_illustration_objects objects WHERE objects.id=p_tracking_id;
	PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[object_illustration_id]);
	SELECT * INTO object_row FROM public.ai_illustration_objects
	WHERE id=p_tracking_id FOR UPDATE;
	IF FOUND THEN
		IF object_row.storage_bucket<>p_bucket OR object_row.storage_path<>p_path OR
			object_row.state<>'cleaning' OR object_row.cleanup_claim_token IS DISTINCT FROM p_claim_token OR
			object_row.cleanup_claimed_at IS NULL OR object_row.cleanup_claimed_at<db_now-interval '5 minutes' THEN
			RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST';
		END IF;
		IF object_row.cleanup_previous_state NOT IN ('orphan','delete_pending') OR
			(object_row.cleanup_previous_state='orphan' AND object_row.created_at+interval '24 hours'>db_now) OR
			object_row.delete_due_at>db_now OR
			object_row.storage_path NOT LIKE object_row.owner_user_id::text||'/%' OR
			object_row.reference_count<>0 THEN RETURN jsonb_build_object('outcome','skip'); END IF;
		RETURN jsonb_build_object('outcome','delete');
	END IF;

	SELECT * INTO upload_row FROM public.ai_uploads WHERE id=p_tracking_id FOR UPDATE;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','skip'); END IF;
	IF p_bucket NOT IN ('ai-card-sources','illustrations') OR
		p_path NOT LIKE upload_row.owner_user_id::text||'/%' OR upload_row.delete_due_at>db_now OR
		upload_row.created_at+interval '24 hours'>db_now THEN
		RETURN jsonb_build_object('outcome','skip');
	END IF;
	IF upload_row.raw_storage_bucket=p_bucket AND upload_row.raw_storage_path=p_path THEN
		IF upload_row.raw_cleanup_claim_token IS DISTINCT FROM p_claim_token OR
			upload_row.raw_cleanup_claimed_at IS NULL OR
			upload_row.raw_cleanup_claimed_at<db_now-interval '5 minutes' THEN
			RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST';
		END IF;
		RETURN jsonb_build_object('outcome','delete');
	END IF;
	IF COALESCE(upload_row.source_storage_bucket,upload_row.source_write_intent_bucket)=p_bucket AND
		COALESCE(upload_row.source_storage_path,upload_row.source_write_intent_path)=p_path THEN
		IF upload_row.status<>'cleaning' OR upload_row.cleanup_claim_token IS DISTINCT FROM p_claim_token OR
			upload_row.cleanup_claimed_at IS NULL OR
			upload_row.cleanup_claimed_at<db_now-interval '5 minutes' THEN
			RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST';
		END IF;
		IF EXISTS (
			SELECT 1 FROM public.ai_upload_consumers consumers
			JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
			WHERE consumers.upload_id=upload_row.id AND jobs.state IN ('queued','processing')
		) THEN RETURN jsonb_build_object('outcome','skip'); END IF;
		RETURN jsonb_build_object('outcome','delete');
	END IF;
	RETURN jsonb_build_object('outcome','skip');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_import_cleanup(
  p_tracking_id uuid,p_bucket text,p_path text,p_claim_token uuid,p_outcome text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE deleted_illustration_id uuid;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  IF p_outcome NOT IN ('deleted','retry') OR
     p_bucket NOT IN ('illustrations','ai-card-sources') OR p_path IS NULL OR p_claim_token IS NULL THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
	SELECT objects.illustration_id INTO deleted_illustration_id
	FROM public.ai_illustration_objects objects WHERE objects.id=p_tracking_id;
	IF FOUND THEN
	PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[deleted_illustration_id]);
	UPDATE public.ai_illustration_objects SET
    state=CASE p_outcome
		WHEN 'deleted' THEN 'deleted'
		ELSE COALESCE(cleanup_previous_state,'orphan') END,
    deleted_at=CASE p_outcome WHEN 'deleted' THEN statement_timestamp() ELSE NULL END,
    cleanup_claimed_at=NULL,cleanup_claim_token=NULL,cleanup_previous_state=NULL,
		updated_at=statement_timestamp()
	WHERE id=p_tracking_id AND state='cleaning' AND storage_bucket=p_bucket
		AND storage_path=p_path AND cleanup_claim_token=p_claim_token
		AND cleanup_claimed_at>clock_timestamp()-interval '5 minutes'
	RETURNING illustration_id INTO deleted_illustration_id;
	IF FOUND THEN
		IF p_outcome='deleted' THEN
			UPDATE public.illustrations SET status='failed',storage_path=NULL,
				prompt=NULL,model_info=NULL,updated_at=statement_timestamp()
			WHERE id=deleted_illustration_id;
		END IF;
		RETURN;
	END IF;
		RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST';
	END IF;

	UPDATE public.ai_uploads SET
		raw_storage_path=CASE p_outcome WHEN 'deleted' THEN NULL ELSE raw_storage_path END,
		raw_storage_bucket=CASE p_outcome WHEN 'deleted' THEN NULL ELSE raw_storage_bucket END,
    raw_cleanup_claimed_at=NULL,raw_cleanup_claim_token=NULL,
    status=CASE
			WHEN p_outcome='deleted' AND
				COALESCE(source_storage_path,source_write_intent_path) IS NULL THEN 'deleted'
      ELSE status
    END,
    deleted_at=CASE
			WHEN p_outcome='deleted' AND
				COALESCE(source_storage_path,source_write_intent_path) IS NULL THEN statement_timestamp()
      ELSE deleted_at
    END
	WHERE id=p_tracking_id AND raw_storage_bucket=p_bucket AND raw_storage_path=p_path
		AND raw_cleanup_claim_token=p_claim_token
		AND raw_cleanup_claimed_at>clock_timestamp()-interval '5 minutes';
  IF FOUND THEN RETURN; END IF;

	UPDATE public.ai_uploads SET
		source_storage_path=CASE p_outcome WHEN 'deleted' THEN NULL ELSE source_storage_path END,
		source_storage_bucket=CASE p_outcome WHEN 'deleted' THEN NULL ELSE source_storage_bucket END,
		source_write_intent_path=CASE p_outcome WHEN 'deleted' THEN NULL ELSE source_write_intent_path END,
		source_write_intent_bucket=CASE p_outcome WHEN 'deleted' THEN NULL ELSE source_write_intent_bucket END,
    status=CASE
      WHEN p_outcome='retry' THEN COALESCE(cleanup_previous_status,'cleanup_pending')
		WHEN raw_storage_path IS NULL THEN 'deleted'
      ELSE 'cleanup_pending'
    END,
    deleted_at=CASE
      WHEN p_outcome='deleted' AND raw_storage_path IS NULL THEN statement_timestamp()
      ELSE NULL
    END,
		cleanup_claimed_at=NULL,cleanup_claim_token=NULL,cleanup_previous_status=NULL
	WHERE id=p_tracking_id
		AND COALESCE(source_storage_bucket,source_write_intent_bucket)=p_bucket
		AND COALESCE(source_storage_path,source_write_intent_path)=p_path AND status='cleaning'
		AND cleanup_claim_token=p_claim_token
		AND cleanup_claimed_at>clock_timestamp()-interval '5 minutes';
	IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1008', MESSAGE='CLAIM_LOST'; END IF;
END;
$$;

DO $$
BEGIN
	IF current_setting('app.s11_failpoint',true)='after_runtime_functions' THEN
		RAISE EXCEPTION 'S-11 injected autocommit failure after runtime functions';
	END IF;
END;
$$;

ALTER FUNCTION public.ai_s11_require_service_role() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_validate_schedule_config(text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_sync_upload_compat() OWNER TO s10_migration_owner;
ALTER FUNCTION public.backfill_ai_uploads_s11(integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_lock_illustration_lifecycle(uuid[]) OWNER TO s10_migration_owner;
ALTER FUNCTION public.commit_import_async(uuid,text,text,text,jsonb,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.get_ai_import_status(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.prepare_ai_source_upload(uuid,text,text,bigint) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_source_write_intent(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.reconcile_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.release_ai_source_after_terminal(uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_source_cleanup(uuid,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_source_deleted(uuid,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_upload_cleanup(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_source_raw_deleted(uuid,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.read_ai_import_queue(integer,integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_assert_active_claim(uuid,uuid,bigint) OWNER TO s10_migration_owner;
ALTER FUNCTION public.schedule_ai_import_retry(uuid,bigint,uuid,text,integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.mark_ai_illustration_orphan(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_record_worker_event(text,bigint,uuid,uuid,text,text,smallint) OWNER TO s10_migration_owner;
ALTER FUNCTION public.claim_ai_worker_log_outbox(uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.complete_ai_worker_log_outbox(uuid,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.update_ai_worker_log_reason(bigint,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_fail_concept_locked(uuid,bigint,uuid,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.fail_ai_import_concept(uuid,bigint,uuid,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.get_ai_import_finalize_state(uuid,bigint,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.get_ai_import_failure_state(uuid,bigint,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ack_inert_delivery(uuid,bigint,text,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_track_card_reference_removal() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_guard_illustration_lifecycle() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s11_guard_illustration_reference() OWNER TO s10_migration_owner;
ALTER FUNCTION public.claim_ai_import_cleanup(integer) OWNER TO s10_migration_owner;
ALTER FUNCTION public.verify_ai_import_cleanup(uuid,text,text,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.complete_ai_import_cleanup(uuid,text,text,uuid,text) OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.ai_s11_require_service_role(),
	public.ai_s11_validate_schedule_config(text,text),
	public.ai_s11_sync_upload_compat(),
	public.backfill_ai_uploads_s11(integer),
	public.ai_s11_lock_illustration_lifecycle(uuid[]),
  public.commit_import_async(uuid,text,text,text,jsonb,text),
  public.get_ai_import_status(uuid,uuid,text),
	public.prepare_ai_source_upload(uuid,text,text,bigint),
	public.mark_ai_source_write_intent(uuid,uuid,text),
	public.mark_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text),
	public.reconcile_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text),
	public.release_ai_source_after_terminal(uuid),
	public.mark_ai_source_cleanup(uuid,text,text),
	public.mark_ai_source_deleted(uuid,text,text),
  public.mark_ai_upload_cleanup(uuid,uuid,text),
  public.mark_ai_source_raw_deleted(uuid,uuid),
  public.read_ai_import_queue(integer,integer),
  public.claim_ai_import_concept(uuid,bigint,uuid),
	public.ai_s11_assert_active_claim(uuid,uuid,bigint),
  public.schedule_ai_import_retry(uuid,bigint,uuid,text,integer),
  public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer),
  public.mark_ai_illustration_orphan(uuid,uuid,text),
	public.ai_s11_record_worker_event(text,bigint,uuid,uuid,text,text,smallint),
	public.claim_ai_worker_log_outbox(uuid),
	public.complete_ai_worker_log_outbox(uuid,uuid),
	public.update_ai_worker_log_reason(bigint,text,text),
  public.ai_s11_fail_concept_locked(uuid,bigint,uuid,text,text),
  public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer),
  public.fail_ai_import_concept(uuid,bigint,uuid,text,text),
  public.get_ai_import_finalize_state(uuid,bigint,uuid),
  public.get_ai_import_failure_state(uuid,bigint,uuid),
  public.ack_inert_delivery(uuid,bigint,text,text),
  public.ai_s11_track_card_reference_removal(),
  public.ai_s11_guard_illustration_lifecycle(),
  public.ai_s11_guard_illustration_reference(),
  public.claim_ai_import_cleanup(integer),
  public.verify_ai_import_cleanup(uuid,text,text,uuid),
  public.complete_ai_import_cleanup(uuid,text,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_import_async(uuid,text,text,text,jsonb,text),
	public.prepare_ai_source_upload(uuid,text,text,bigint),
	public.mark_ai_source_write_intent(uuid,uuid,text),
	public.mark_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text),
	public.reconcile_ai_source_ready(uuid,uuid,text,bigint,integer,integer,text),
	public.release_ai_source_after_terminal(uuid),
	public.mark_ai_source_cleanup(uuid,text,text),
	public.mark_ai_source_deleted(uuid,text,text),
  public.mark_ai_upload_cleanup(uuid,uuid,text),
  public.mark_ai_source_raw_deleted(uuid,uuid),
  public.read_ai_import_queue(integer,integer),
  public.claim_ai_import_concept(uuid,bigint,uuid),
  public.schedule_ai_import_retry(uuid,bigint,uuid,text,integer),
  public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer),
  public.mark_ai_illustration_orphan(uuid,uuid,text),
  public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer),
  public.fail_ai_import_concept(uuid,bigint,uuid,text,text),
  public.get_ai_import_finalize_state(uuid,bigint,uuid),
  public.get_ai_import_failure_state(uuid,bigint,uuid),
	public.ack_inert_delivery(uuid,bigint,text,text),
	public.claim_ai_worker_log_outbox(uuid),
	public.complete_ai_worker_log_outbox(uuid,uuid),
	public.update_ai_worker_log_reason(bigint,text,text),
  public.claim_ai_import_cleanup(integer),
  public.verify_ai_import_cleanup(uuid,text,text,uuid),
  public.complete_ai_import_cleanup(uuid,text,text,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_import_status(uuid,uuid,text) TO service_role;

REVOKE ALL ON SCHEMA pgmq FROM PUBLIC,anon,authenticated;

DO $$
BEGIN
  IF current_setting('app.s11_failpoint',true)='before_core_commit' THEN
    RAISE EXCEPTION 'S-11 injected migration failure before core commit';
  END IF;
END;
$$;
