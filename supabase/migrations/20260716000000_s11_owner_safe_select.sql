-- Forward-safe owner read projection for S-11 lifecycle tables.
-- Existing installations may already have inherited table-wide SELECT from S-10.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

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

COMMIT;
