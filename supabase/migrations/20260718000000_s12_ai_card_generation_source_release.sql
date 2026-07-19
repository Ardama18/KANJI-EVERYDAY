-- S-12 forward-only extension. S-10/S-11 queue, worker and age cleanup remain authoritative.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

ALTER TABLE public.ai_uploads
	ADD COLUMN IF NOT EXISTS usage_scope text;
ALTER TABLE public.ai_uploads ALTER COLUMN usage_scope SET DEFAULT 'card_illustration';
UPDATE public.ai_uploads SET usage_scope = 'card_illustration' WHERE usage_scope IS NULL;
ALTER TABLE public.ai_uploads ALTER COLUMN usage_scope SET NOT NULL;

ALTER TABLE public.ai_uploads
	DROP CONSTRAINT IF EXISTS ai_uploads_s12_usage_scope_check,
	ADD CONSTRAINT ai_uploads_s12_usage_scope_check
		CHECK (usage_scope IN ('generation_source','card_illustration')) NOT VALID;

ALTER TABLE public.ai_uploads VALIDATE CONSTRAINT ai_uploads_s12_usage_scope_check;

REVOKE SELECT ON public.ai_uploads FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,owner_user_id,upload_key,purpose,usage_scope,mime_type,byte_size,status,
	created_at,consumed_at) ON public.ai_uploads TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_ai_source_upload_scoped(
	p_owner_user_id uuid,
	p_upload_key text,
	p_declared_mime text,
	p_byte_size bigint,
	p_usage_scope text DEFAULT 'card_illustration'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_id uuid := gen_random_uuid();
DECLARE raw_path text;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_owner_user_id IS NULL OR char_length(p_upload_key) NOT BETWEEN 1 AND 128 OR
		p_declared_mime NOT IN ('image/png','image/jpeg','image/webp') OR
		p_byte_size NOT BETWEEN 1 AND 10485760 OR
		p_usage_scope NOT IN ('generation_source','card_illustration') THEN
		PERFORM public.ai_raise_import_error('VALIDATION_ERROR',jsonb_build_object('field','source','rule','metadata'));
	END IF;
	raw_path := p_owner_user_id::text || '/' || upload_id::text || '/raw';
	INSERT INTO public.ai_uploads (
		id,owner_user_id,upload_key,purpose,usage_scope,storage_path,mime_type,byte_size,
		status,raw_storage_path,raw_storage_bucket,delete_due_at
	) VALUES (
		upload_id,p_owner_user_id,p_upload_key,'card_illustration',p_usage_scope,raw_path,
		p_declared_mime,p_byte_size,'prepared',raw_path,'ai-card-sources',
		statement_timestamp()+interval '23 hours 45 minutes'
	);
	RETURN jsonb_build_object('uploadId',upload_id,'path',raw_path,'usageScope',p_usage_scope);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_generation_sources(
	p_owner_user_id uuid,
	p_upload_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_owner_user_id IS NULL OR p_upload_ids IS NULL OR
		cardinality(p_upload_ids) NOT BETWEEN 1 AND 5 OR
		cardinality(p_upload_ids) <> cardinality(ARRAY(SELECT DISTINCT id FROM unnest(p_upload_ids) id)) THEN
		PERFORM public.ai_raise_import_error('VALIDATION_ERROR',jsonb_build_object('field','sourceUploadIds','rule','count'));
	END IF;
	SELECT jsonb_agg(jsonb_build_object(
		'uploadId',uploads.id,'bucket',uploads.source_storage_bucket,
		'path',uploads.source_storage_path,'mime',uploads.detected_mime_type,
		'byteSize',uploads.byte_size,'digest',uploads.sha256
	) ORDER BY uploads.id) INTO result
	FROM public.ai_uploads uploads
	WHERE uploads.owner_user_id=p_owner_user_id
		AND uploads.id=ANY(p_upload_ids)
		AND uploads.usage_scope='generation_source'
		AND uploads.status='ready'
		AND uploads.source_storage_bucket='ai-card-sources'
		AND uploads.source_storage_path IS NOT NULL
		AND uploads.detected_mime_type='image/png'
		AND uploads.sha256 ~ '^[0-9a-f]{64}$';
	IF jsonb_array_length(COALESCE(result,'[]'::jsonb))<>cardinality(p_upload_ids) THEN
		PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
	END IF;
	RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_generation_source(
	p_owner_user_id uuid,
	p_upload_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_row public.ai_uploads%ROWTYPE;
DECLARE objects jsonb := '[]'::jsonb;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	SELECT * INTO upload_row FROM public.ai_uploads
	WHERE id=p_upload_id AND owner_user_id=p_owner_user_id
		AND usage_scope='generation_source' FOR UPDATE;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','retain'); END IF;
	IF EXISTS (
		SELECT 1 FROM public.ai_upload_consumers consumers
		JOIN public.ai_import_concept_jobs jobs ON jobs.id=consumers.job_id
		WHERE consumers.upload_id=p_upload_id AND jobs.state NOT IN ('succeeded','failed','undone')
	) THEN RETURN jsonb_build_object('outcome','retain'); END IF;
	IF upload_row.status='deleted' OR
		(upload_row.raw_storage_path IS NULL AND upload_row.source_storage_path IS NULL AND upload_row.source_write_intent_path IS NULL) THEN
		RETURN jsonb_build_object('outcome','deleted','objects','[]'::jsonb);
	END IF;
	IF upload_row.status NOT IN ('prepared','ready','cleanup_pending') THEN
		RETURN jsonb_build_object('outcome','retain');
	END IF;
	IF upload_row.raw_storage_path IS NOT NULL THEN
		objects:=objects||jsonb_build_array(jsonb_build_object('kind','raw','bucket',upload_row.raw_storage_bucket,'path',upload_row.raw_storage_path));
	END IF;
	IF upload_row.source_storage_path IS NOT NULL THEN
		objects:=objects||jsonb_build_array(jsonb_build_object('kind','source','bucket',upload_row.source_storage_bucket,'path',upload_row.source_storage_path));
	END IF;
	IF upload_row.source_write_intent_path IS NOT NULL AND upload_row.source_storage_path IS NULL THEN
		objects:=objects||jsonb_build_array(jsonb_build_object('kind','intent','bucket',upload_row.source_write_intent_bucket,'path',upload_row.source_write_intent_path));
	END IF;
	UPDATE public.ai_uploads SET status='cleanup_pending',
		delete_due_at=LEAST(COALESCE(delete_due_at,statement_timestamp()),statement_timestamp()),
		cleanup_claimed_at=NULL,cleanup_claim_token=NULL
	WHERE id=p_upload_id;
	RETURN jsonb_build_object('outcome','delete','objects',objects);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_generation_source_release(
	p_owner_user_id uuid,
	p_upload_id uuid,
	p_kind text,
	p_bucket text,
	p_path text,
	p_deleted boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE upload_row public.ai_uploads%ROWTYPE;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	SELECT * INTO upload_row FROM public.ai_uploads
	WHERE id=p_upload_id AND owner_user_id=p_owner_user_id
		AND usage_scope='generation_source' FOR UPDATE;
	IF NOT FOUND THEN RETURN jsonb_build_object('outcome','retain'); END IF;
	IF p_deleted THEN
		IF p_kind='raw' AND upload_row.raw_storage_bucket=p_bucket AND upload_row.raw_storage_path=p_path THEN
			UPDATE public.ai_uploads SET raw_storage_path=NULL,raw_storage_bucket=NULL,
				raw_cleanup_claimed_at=NULL,raw_cleanup_claim_token=NULL WHERE id=p_upload_id;
		ELSIF p_kind='source' AND upload_row.source_storage_bucket=p_bucket AND upload_row.source_storage_path=p_path THEN
			UPDATE public.ai_uploads SET source_storage_path=NULL,source_storage_bucket=NULL,
				cleanup_claimed_at=NULL,cleanup_claim_token=NULL WHERE id=p_upload_id;
		ELSIF p_kind='intent' AND upload_row.source_write_intent_bucket=p_bucket AND upload_row.source_write_intent_path=p_path THEN
			UPDATE public.ai_uploads SET source_write_intent_path=NULL,source_write_intent_bucket=NULL WHERE id=p_upload_id;
		ELSE
			RETURN jsonb_build_object('outcome','retain');
		END IF;
	END IF;
	UPDATE public.ai_uploads SET
		status=CASE WHEN raw_storage_path IS NULL AND source_storage_path IS NULL AND source_write_intent_path IS NULL THEN 'deleted' ELSE 'cleanup_pending' END,
		deleted_at=CASE WHEN raw_storage_path IS NULL AND source_storage_path IS NULL AND source_write_intent_path IS NULL THEN statement_timestamp() ELSE NULL END,
		delete_due_at=CASE WHEN raw_storage_path IS NULL AND source_storage_path IS NULL AND source_write_intent_path IS NULL THEN delete_due_at ELSE statement_timestamp() END
	WHERE id=p_upload_id;
	RETURN jsonb_build_object('outcome',CASE WHEN p_deleted THEN 'released' ELSE 'cleanupPending' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_ai_import_preview(
	p_owner_user_id uuid,
	p_deck_id uuid,
	p_reservation_key text,
	p_import_request_hash text,
	p_upload_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF NOT EXISTS (SELECT 1 FROM public.decks WHERE id=p_deck_id AND owner_user_id=p_owner_user_id) THEN
		PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.ai_quota_reservations
		WHERE owner_user_id=p_owner_user_id AND reservation_key=p_reservation_key
			AND kind='card_generation' AND source='app_ai' AND status='reserved'
			AND provider_started_at IS NOT NULL
	) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	IF p_import_request_hash !~ '^[0-9a-f]{64}$' THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
	IF EXISTS (
		SELECT 1 FROM unnest(p_upload_ids) upload_id
		WHERE NOT EXISTS (
			SELECT 1 FROM public.ai_uploads uploads WHERE uploads.id=upload_id
				AND uploads.owner_user_id=p_owner_user_id AND uploads.usage_scope='card_illustration'
				AND uploads.status='ready'
		)
	) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
	RETURN jsonb_build_object('valid',true);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_ai_source_upload_scoped(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_ai_generation_sources(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_ai_generation_source(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_ai_generation_source_release(uuid,uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ai_source_upload_scoped(uuid,text,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_generation_sources(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_generation_source(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_generation_source_release(uuid,uuid,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[]) TO service_role;
