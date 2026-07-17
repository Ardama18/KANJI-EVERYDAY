-- S-11 contract stage. Apply only after backfill_ai_uploads_s11() returns 0.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM public.ai_uploads
		WHERE
			(status IN ('ready','consumed') AND
				(source_storage_path IS NULL OR source_storage_bucket IS NULL OR
				 detected_mime_type IS NULL OR delete_due_at IS NULL)) OR
			(status='deleted' AND (deleted_at IS NULL OR delete_due_at IS NULL))
	) THEN
		RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='S11_BACKFILL_INCOMPLETE';
	END IF;
END;
$$;

ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s11_status_check;
ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s11_dimensions_check;
ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s11_digest_check;
ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s11_bucket_check;
ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s11_status_time_check;
