-- Issue #97: preserve per-concept failures; no data deletion or regeneration.
ALTER TABLE public.ai_import_concept_jobs
 ADD COLUMN mnemonic_required boolean NOT NULL DEFAULT false,
 ADD COLUMN mnemonic_state text NOT NULL DEFAULT 'not_required'
  CHECK (mnemonic_state IN ('not_required','approved','blocked')),
 ADD COLUMN mnemonic_error_code text,
 ADD COLUMN mnemonic_attempt integer NOT NULL DEFAULT 0 CHECK (mnemonic_attempt >= 0),
 ADD COLUMN mnemonic_claim_token uuid,
 ADD COLUMN mnemonic_claim_expires_at timestamptz;
ALTER TABLE public.ai_import_concept_jobs DROP CONSTRAINT ai_import_concept_jobs_state_check;
ALTER TABLE public.ai_import_concept_jobs ADD CONSTRAINT ai_import_concept_jobs_state_check
 CHECK (state IN ('queued','processing','succeeded','failed','undone','blocked_mnemonic'));
ALTER TABLE public.ai_import_concept_jobs ADD CONSTRAINT ai97_mnemonic_code_check CHECK
 (mnemonic_error_code IS NULL OR mnemonic_error_code IN ('MNEMONIC_HTTP_TRANSIENT','MNEMONIC_HTTP_PERMANENT','MNEMONIC_TIMEOUT','MNEMONIC_NETWORK','MNEMONIC_RESPONSE_INVALID','MNEMONIC_VALIDATION_FAILED','MNEMONIC_REFUSED','MNEMONIC_MODERATION_BLOCKED','MNEMONIC_MODERATION_UNAVAILABLE','MNEMONIC_LIMIT_EXCEEDED','MNEMONIC_BUDGET_EXCEEDED','MNEMONIC_DISABLED','MNEMONIC_CONFIG_MISSING','MNEMONIC_TARGET_UNSUPPORTED','MNEMONIC_INTERNAL_ERROR'));
ALTER TABLE public.ai_import_concept_jobs ADD CONSTRAINT ai97_mnemonic_lease_check CHECK
 ((mnemonic_claim_token IS NULL) = (mnemonic_claim_expires_at IS NULL));
ALTER TABLE public.ai_illustration_objects
 ADD COLUMN mnemonic_slots_snapshot jsonb,
 ADD COLUMN mnemonic_slots_hash text CHECK (mnemonic_slots_hash IS NULL OR mnemonic_slots_hash ~ '^[0-9a-f]{64}$'),
 ADD COLUMN prompt_version text,
 ADD COLUMN prompt_hash text CHECK (prompt_hash IS NULL OR prompt_hash ~ '^[0-9a-f]{64}$');

CREATE FUNCTION public.ai97_target_kanji(p_pattern text,p_front text,p_back text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_normalize_display_text(CASE p_pattern WHEN 'R1' THEN p_front ELSE p_back END)
$$;
CREATE FUNCTION public.ai97_requires_mnemonic(p_mode text,p_kanji text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(p_mode='ai' AND p_kanji ~ '[㐀-䶿一-鿿々〆〇𠀀-𯿿𰀀-𳑿]',false)
$$;
CREATE FUNCTION public.ai97_valid_slots(p_slots jsonb,p_kanji text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(p_slots)='object' AND
  jsonb_typeof(p_slots->'kanji')='string' AND p_slots->>'kanji'=p_kanji AND char_length(p_kanji) BETWEEN 1 AND 16 AND
  jsonb_typeof(p_slots->'isSingleKanji')='boolean' AND p_slots->'isSingleKanji'=to_jsonb(char_length(p_kanji)=1) AND
  jsonb_typeof(p_slots->'shapeHint')='object' AND
  NOT EXISTS (SELECT 1 FROM (VALUES (p_slots->'shapeHint'->'part'),(p_slots->'shapeHint'->'picture'),
   (p_slots->'meaningHint'),(p_slots->'story')) AS fields(value)
   WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR char_length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 100
    OR (value#>>'{}') IS DISTINCT FROM public.ai_normalize_display_text(value#>>'{}')),false)
$$;
CREATE FUNCTION public.ai97_valid_explanation(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR jsonb_typeof(p_value->'summary') IS DISTINCT FROM 'string'
  OR char_length(btrim(p_value->>'summary')) NOT BETWEEN 1 AND 120
  OR jsonb_typeof(p_value->'mappings') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p_value->'mappings') NOT BETWEEN 2 AND 4 THEN RETURN false; END IF;
 RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_value->'mappings') m(value)
  WHERE jsonb_typeof(value->'part') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'meaning') IS DISTINCT FROM 'string'
   OR char_length(btrim(value->>'part')) NOT BETWEEN 1 AND 100 OR char_length(btrim(value->>'meaning')) NOT BETWEEN 1 AND 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.s14_remote_commit_import(
  p_client_id text,
  p_session_id text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_generation_request_hash text,
  p_preview_token text,
  p_request jsonb,
  p_card_reservation_key text,
  p_mnemonics jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  expected_generation_hash text;
  preview_secret text;
  preview_parts text[];
  preview_payload_text text;
  preview_payload jsonb;
  preview_payload_part text;
  preview_signature_part text;
  preview_signature_expected text;
  preview_payload_base64 text;
  preview_payload_padding integer;
  preview_expires_at bigint;
  result jsonb;
  target_batch_id uuid;
  mnemonic_row record;
  resolved_key text;
  target_job public.ai_import_concept_jobs%ROWTYPE;
  target_item public.ai_import_items%ROWTYPE;
  target_kanji text;
  outcome jsonb;
  failure_code text;
  required boolean;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128
    OR p_import_request_hash IS NULL OR p_import_request_hash !~ '^[0-9a-f]{64}$'
    OR p_generation_request_hash IS NULL OR p_generation_request_hash !~ '^[0-9a-f]{64}$'
    OR p_preview_token IS NULL OR char_length(p_preview_token) NOT BETWEEN 1 AND 4096
    OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR p_card_reservation_key IS NULL OR char_length(p_card_reservation_key) NOT BETWEEN 1 AND 128 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;

  preview_secret := public.s14_remote_preview_hmac_secret();
  IF preview_secret IS NULL THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_parts := regexp_split_to_array(p_preview_token, '\.');
  IF array_length(preview_parts, 1) IS DISTINCT FROM 2
    OR preview_parts[1] !~ '^[A-Za-z0-9_-]+$'
    OR preview_parts[2] !~ '^[A-Za-z0-9_-]+$' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_payload_part := preview_parts[1];
  preview_signature_part := preview_parts[2];
  preview_signature_expected := rtrim(translate(encode(extensions.hmac(
    convert_to(preview_payload_part, 'UTF8'),
    convert_to(preview_secret, 'UTF8'),
    'sha256'
  ), 'base64'), '+/', '-_'), '=');
  IF preview_signature_part IS DISTINCT FROM preview_signature_expected THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  IF length(preview_payload_part) % 4 = 1 THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_payload_padding := (4 - length(preview_payload_part) % 4) % 4;
  preview_payload_base64 := translate(preview_payload_part, '-_', '+/') || repeat('=', preview_payload_padding);
  BEGIN
    preview_payload_text := convert_from(decode(preview_payload_base64, 'base64'), 'UTF8');
    preview_payload := preview_payload_text::jsonb;
  EXCEPTION WHEN others THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END;
  IF preview_payload IS NULL OR jsonb_typeof(preview_payload) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(preview_payload)) <> 7
    OR preview_payload ->> 'v' IS DISTINCT FROM '2'
    OR preview_payload ->> 'domain' IS DISTINCT FROM 'kanji-everyday:remote-mcp:preview:v2'
    OR lower(preview_payload ->> 'userId') IS DISTINCT FROM lower(actor_id::text)
    OR preview_payload ->> 'reservationKey' IS DISTINCT FROM p_card_reservation_key
    OR preview_payload ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash
    OR jsonb_typeof(preview_payload -> 'expiresAt') <> 'number'
    OR (preview_payload ->> 'expiresAt') !~ '^[0-9]+$' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_expires_at := (preview_payload ->> 'expiresAt')::bigint;
  IF floor(extract(epoch FROM statement_timestamp()))::bigint > preview_expires_at THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;

  expected_generation_hash := encode(extensions.digest(
    int4send(octet_length(convert_to('kanji-everyday:remote-mcp:generation:v1', 'UTF8')))
      || convert_to('kanji-everyday:remote-mcp:generation:v1', 'UTF8')
      || int4send(octet_length(convert_to(p_import_request_hash, 'UTF8')))
      || convert_to(p_import_request_hash, 'UTF8')
      || int4send(octet_length(convert_to(lower(p_client_id), 'UTF8')))
      || convert_to(lower(p_client_id), 'UTF8'),
    'sha256'
  ), 'hex');
  IF p_generation_request_hash IS DISTINCT FROM expected_generation_hash THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_import_batches AS batches
    WHERE batches.owner_user_id = actor_id AND batches.idempotency_key = p_idempotency_key
  ) THEN
    -- Idempotent re-commit: keep the result and fall through so the mnemonic upsert
    -- below also runs for retries (ON CONFLICT keeps that idempotent).
    RETURN public.ai_s14_enqueue_import_internal(
      actor_id, 'remote_mcp', p_idempotency_key, p_import_request_hash, p_request, p_card_reservation_key
    );
  ELSE
    PERFORM public.reserve_provider_usage_internal(
      actor_id, p_card_reservation_key, 'card_generation', 'remote_mcp',
      p_generation_request_hash, 0, NULL, NULL, NULL, statement_timestamp()
    );
    result := public.ai_s14_enqueue_import_internal(
      actor_id, 'remote_mcp', p_idempotency_key, p_import_request_hash, p_request, p_card_reservation_key
    );
  END IF;

  target_batch_id := (result ->> 'batchId')::uuid;
  IF p_mnemonics IS NOT NULL AND jsonb_typeof(p_mnemonics) <> 'array' THEN
   PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  FOR target_job IN SELECT * FROM public.ai_import_concept_jobs WHERE batch_id=target_batch_id AND owner_user_id=actor_id ORDER BY id FOR UPDATE LOOP
   SELECT * INTO target_item FROM public.ai_import_items WHERE batch_id=target_batch_id AND concept_id=target_job.concept_id
    ORDER BY CASE pattern WHEN 'R1' THEN 0 ELSE 1 END,ordinal LIMIT 1;
   target_kanji:=public.ai97_target_kanji(target_item.pattern,target_item.front_text,target_item.back_text);
   required:=public.ai97_requires_mnemonic(target_item.image_mode,target_kanji);
   IF NOT required THEN CONTINUE; END IF;
   SELECT entry INTO outcome FROM jsonb_array_elements(coalesce(p_mnemonics,'[]'::jsonb)) entry
    WHERE entry->>'conceptId'=target_job.concept_id LIMIT 1;
   SELECT illustration_key INTO resolved_key FROM public.illustrations WHERE id=target_job.illustration_id AND owner_user_id=actor_id;
   IF (outcome->>'status' IS NULL OR outcome->>'status'='approved') AND public.ai97_valid_slots(outcome->'slots',target_kanji) AND public.ai97_valid_explanation(outcome->'explanation') THEN
    INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
     VALUES(actor_id,resolved_key,outcome->'slots',outcome->'explanation','approved')
     ON CONFLICT(owner_user_id,illustration_key) DO NOTHING;
    UPDATE public.ai_import_concept_jobs SET mnemonic_required=true,mnemonic_state='approved',mnemonic_attempt=1 WHERE id=target_job.id;
   ELSE
    failure_code:=CASE WHEN outcome->>'status'='blocked' AND outcome->>'code' IN ('MNEMONIC_HTTP_TRANSIENT','MNEMONIC_HTTP_PERMANENT','MNEMONIC_TIMEOUT','MNEMONIC_NETWORK','MNEMONIC_RESPONSE_INVALID','MNEMONIC_VALIDATION_FAILED','MNEMONIC_REFUSED','MNEMONIC_MODERATION_BLOCKED','MNEMONIC_MODERATION_UNAVAILABLE','MNEMONIC_LIMIT_EXCEEDED','MNEMONIC_BUDGET_EXCEEDED','MNEMONIC_DISABLED','MNEMONIC_CONFIG_MISSING','MNEMONIC_TARGET_UNSUPPORTED','MNEMONIC_INTERNAL_ERROR') THEN outcome->>'code'
      WHEN outcome IS NULL THEN 'MNEMONIC_CONFIG_MISSING' ELSE 'MNEMONIC_VALIDATION_FAILED' END;
    UPDATE public.ai_import_concept_jobs SET mnemonic_required=true,mnemonic_state='blocked',mnemonic_error_code=failure_code,
      mnemonic_attempt=1,state='blocked_mnemonic',updated_at=clock_timestamp() WHERE id=target_job.id;
    PERFORM pgmq.archive('ai_card_imports',target_job.queue_message_id);
   END IF;
  END LOOP;
  RETURN result;
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
DECLARE mnemonic_slots jsonb;
DECLARE target_kanji text;
DECLARE required boolean;
BEGIN
  PERFORM public.ai_s11_require_service_role();
  SELECT jobs.* INTO job FROM public.ai_import_concept_jobs jobs WHERE jobs.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing'); END IF;
  IF job.state='blocked_mnemonic' THEN
   PERFORM pgmq.archive('ai_card_imports',p_message_id); RETURN jsonb_build_object('outcome','blocked'); END IF;
  IF job.state IN ('succeeded','failed','undone') THEN RETURN jsonb_build_object('outcome','terminal'); END IF;
  IF job.queue_message_id IS DISTINCT FROM p_message_id THEN RETURN jsonb_build_object('outcome','stale'); END IF;
  IF job.state = 'processing' AND job.claim_expires_at > db_now THEN RETURN jsonb_build_object('outcome','active'); END IF;
  IF job.state NOT IN ('queued','processing') THEN RETURN jsonb_build_object('outcome','terminal'); END IF;

  SELECT * INTO representative FROM public.ai_import_items WHERE batch_id=job.batch_id AND concept_id=job.concept_id
   ORDER BY CASE pattern WHEN 'R1' THEN 0 ELSE 1 END,ordinal LIMIT 1;
  target_kanji:=public.ai97_target_kanji(representative.pattern,representative.front_text,representative.back_text);
  required:=job.mnemonic_required OR (public.ai97_requires_mnemonic(representative.image_mode,target_kanji) AND
   (SELECT source='remote_mcp' FROM public.ai_import_batches WHERE id=job.batch_id));
  IF required THEN
   SELECT m.slots INTO mnemonic_slots FROM public.card_mnemonics m JOIN public.illustrations i ON i.illustration_key=m.illustration_key AND i.owner_user_id=m.owner_user_id
    WHERE i.id=job.illustration_id AND m.owner_user_id=job.owner_user_id AND m.status='approved';
   IF NOT public.ai97_valid_slots(mnemonic_slots,target_kanji) THEN
    UPDATE public.ai_import_concept_jobs SET state='blocked_mnemonic',mnemonic_required=true,mnemonic_state='blocked',
     mnemonic_error_code='MNEMONIC_VALIDATION_FAILED',claim_token=NULL,claim_expires_at=NULL,updated_at=db_now WHERE id=job.id;
    PERFORM pgmq.archive('ai_card_imports',p_message_id);
    RETURN jsonb_build_object('outcome','blocked');
   END IF;
   UPDATE public.ai_illustration_objects SET mnemonic_slots_snapshot=mnemonic_slots,
    mnemonic_slots_hash=encode(extensions.digest(convert_to(mnemonic_slots::text,'UTF8'),'sha256'),'hex'),
    prompt_version='mnemonic-v2' WHERE job_id=job.id;
   UPDATE public.ai_import_concept_jobs SET mnemonic_required=true,mnemonic_state='approved',mnemonic_error_code=NULL WHERE id=job.id;
  END IF;
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

  -- S-16H: 承認済みニーモニック slots を claim と同一 TX で owner-scope join して取得する。
  IF representative.image_mode = 'ai' THEN
    SELECT mnemonics.slots INTO mnemonic_slots
    FROM public.card_mnemonics AS mnemonics
    JOIN public.illustrations AS ill
      ON ill.illustration_key = mnemonics.illustration_key
     AND ill.owner_user_id   = mnemonics.owner_user_id
    WHERE ill.id = job.illustration_id
      AND mnemonics.owner_user_id = job.owner_user_id
      AND mnemonics.status = 'approved';
  END IF;

  SELECT objects.* INTO object_row FROM public.ai_illustration_objects objects WHERE objects.job_id=job.id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'outcome','claimed','jobId',job.id,'batchId',job.batch_id,'claimToken',p_claim_token,
    'attempt',job.attempt,'imageMode',representative.image_mode,
		'backText',CASE WHEN representative.image_mode='ai' THEN representative.back_text ELSE NULL END,
		'skill',CASE WHEN representative.image_mode='ai' THEN representative.skill ELSE NULL END,
		'mnemonicSlots',mnemonic_slots,'mnemonicRequired',required,
		'sourcePath',(SELECT uploads.source_storage_path FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
		'sourceBucket',(SELECT uploads.source_storage_bucket FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'sourceMime',(SELECT uploads.detected_mime_type FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'illustrationId',job.illustration_id,'illustrationPath',object_row.storage_path
  ));
END;
$$;


ALTER FUNCTION public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer) RENAME TO ai97_mark_uploading_legacy;
REVOKE ALL ON FUNCTION public.ai97_mark_uploading_legacy(uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.mark_ai_illustration_uploading(p_job_id uuid,p_claim_token uuid,p_digest text,p_width integer,p_height integer,p_prompt_hash text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.ai_s11_require_service_role();
 PERFORM public.ai97_mark_uploading_legacy(p_job_id,p_claim_token,p_digest,p_width,p_height);
 IF p_prompt_hash IS NOT NULL AND p_prompt_hash !~ '^[0-9a-f]{64}$' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_illustration_objects SET prompt_hash=p_prompt_hash WHERE job_id=p_job_id;
END;
$$;
ALTER FUNCTION public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer) RENAME TO ai97_finalize_import_legacy;
REVOKE ALL ON FUNCTION public.ai97_finalize_import_legacy(uuid,bigint,uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finalize_ai_import_concept(p_job_id uuid,p_message_id bigint,p_claim_token uuid,
 p_illustration_id uuid DEFAULT NULL,p_digest text DEFAULT NULL,p_width integer DEFAULT NULL,p_height integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job public.ai_import_concept_jobs%ROWTYPE; DECLARE slots jsonb; DECLARE object_row public.ai_illustration_objects%ROWTYPE;
BEGIN
 PERFORM public.ai_s11_require_service_role();
 PERFORM public.ai_s11_assert_active_claim(p_job_id,p_claim_token,p_message_id);
 SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id FOR UPDATE;
 IF job.mnemonic_required THEN
  SELECT * INTO object_row FROM public.ai_illustration_objects WHERE job_id=job.id;
  SELECT m.slots INTO slots FROM public.card_mnemonics m JOIN public.illustrations i ON i.illustration_key=m.illustration_key AND i.owner_user_id=m.owner_user_id
   WHERE i.id=job.illustration_id AND m.owner_user_id=job.owner_user_id AND m.status='approved';
  IF slots IS NULL OR object_row.mnemonic_slots_hash IS DISTINCT FROM encode(extensions.digest(convert_to(slots::text,'UTF8'),'sha256'),'hex')
   OR object_row.prompt_version IS DISTINCT FROM 'mnemonic-v2' OR object_row.prompt_hash IS NULL THEN
   PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
 END IF;
 RETURN public.ai97_finalize_import_legacy(p_job_id,p_message_id,p_claim_token,p_illustration_id,p_digest,p_width,p_height);
END;
$$;
CREATE OR REPLACE FUNCTION public.ai_s14_import_status_internal(
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
      'status', CASE WHEN jobs.state='blocked_mnemonic' THEN 'blocked_mnemonic' ELSE CASE items.status
        WHEN 'committed' THEN 'queued' WHEN 'finalized' THEN 'succeeded'
        WHEN 'deleted' THEN 'undone' ELSE items.status END END,
      'cardId', items.result_card_id,
      'errorCode', CASE WHEN jobs.state='blocked_mnemonic' THEN jobs.mnemonic_error_code ELSE items.error_code END
    ) ORDER BY items.ordinal), '[]'::jsonb)
  INTO succeeded_count, failed_count, item_rows
  FROM public.ai_import_items AS items JOIN public.ai_import_concept_jobs jobs ON jobs.batch_id=items.batch_id AND jobs.concept_id=items.concept_id WHERE items.batch_id = target_batch.id;

  response_status := CASE
    WHEN target_batch.status = 'undone' THEN 'undone'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND failed_count = 0 THEN 'completed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND succeeded_count = 0 THEN 'failed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count THEN 'partial'
    WHEN EXISTS (SELECT 1 FROM public.ai_import_items i WHERE i.batch_id = target_batch.id AND i.status = 'processing') THEN 'processing'
    WHEN EXISTS (SELECT 1 FROM public.ai_import_concept_jobs WHERE batch_id=target_batch.id AND state='queued') THEN 'queued'
    WHEN EXISTS (SELECT 1 FROM public.ai_import_concept_jobs WHERE batch_id=target_batch.id AND state='blocked_mnemonic') THEN 'blocked_mnemonic'
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


CREATE FUNCTION public.s14_remote_prepare_mnemonic_retry(p_client_id text,p_session_id text,p_batch_id uuid,p_concept_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; DECLARE job public.ai_import_concept_jobs%ROWTYPE; DECLARE token uuid:=gen_random_uuid(); DECLARE rows jsonb;
BEGIN
 actor:=public.ai_s14_remote_mcp_actor(p_client_id,p_session_id);
 SELECT * INTO job FROM public.ai_import_concept_jobs WHERE owner_user_id=actor AND batch_id=p_batch_id AND concept_id=p_concept_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 IF job.state<>'blocked_mnemonic' OR job.mnemonic_claim_expires_at>clock_timestamp() THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_import_concept_jobs SET mnemonic_claim_token=token,mnemonic_claim_expires_at=clock_timestamp()+interval '90 seconds',
  mnemonic_attempt=mnemonic_attempt+1 WHERE id=job.id;
 SELECT jsonb_agg(jsonb_build_object('conceptId',concept_id,'pattern',pattern,'front',front_text,'back',back_text)) INTO rows
  FROM public.ai_import_items WHERE batch_id=job.batch_id AND concept_id=job.concept_id;
 RETURN jsonb_build_object('jobId',job.id,'token',token,'items',rows);
END;
$$;
CREATE FUNCTION public.s14_remote_complete_mnemonic_retry(p_client_id text,p_session_id text,p_job_id uuid,p_token uuid,p_outcome jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; DECLARE job public.ai_import_concept_jobs%ROWTYPE; DECLARE representative public.ai_import_items%ROWTYPE;
DECLARE key text; DECLARE kanji text; DECLARE code text; DECLARE message_id bigint;
BEGIN
 actor:=public.ai_s14_remote_mcp_actor(p_client_id,p_session_id);
 SELECT * INTO job FROM public.ai_import_concept_jobs WHERE id=p_job_id AND owner_user_id=actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 IF p_token IS NULL OR job.mnemonic_claim_token IS DISTINCT FROM p_token OR job.mnemonic_claim_expires_at<=clock_timestamp()
  OR job.state<>'blocked_mnemonic' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 SELECT * INTO representative FROM public.ai_import_items WHERE batch_id=job.batch_id AND concept_id=job.concept_id
  ORDER BY CASE pattern WHEN 'R1' THEN 0 ELSE 1 END,ordinal LIMIT 1;
 kanji:=public.ai97_target_kanji(representative.pattern,representative.front_text,representative.back_text);
 IF p_outcome->>'conceptId' IS DISTINCT FROM job.concept_id THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
 IF p_outcome->>'status'='approved' AND public.ai97_valid_slots(p_outcome->'mnemonic'->'slots',kanji)
  AND public.ai97_valid_explanation(p_outcome->'mnemonic'->'explanation') THEN
  SELECT illustration_key INTO key FROM public.illustrations WHERE id=job.illustration_id AND owner_user_id=actor;
  INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
   VALUES(actor,key,p_outcome->'mnemonic'->'slots',p_outcome->'mnemonic'->'explanation','approved')
   ON CONFLICT(owner_user_id,illustration_key) DO UPDATE SET slots=excluded.slots,explanation=excluded.explanation,status='approved';
  SELECT pgmq.send('ai_card_imports',jsonb_build_object('version',1,'jobId',job.id,'batchId',job.batch_id)) INTO message_id;
  UPDATE public.ai_import_concept_jobs SET state='queued',queue_message_id=message_id,mnemonic_state='approved',mnemonic_error_code=NULL,
   mnemonic_claim_token=NULL,mnemonic_claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=job.id;
  RETURN jsonb_build_object('status','queued');
 END IF;
 code:=coalesce(p_outcome->>'code','MNEMONIC_VALIDATION_FAILED');
 UPDATE public.ai_import_concept_jobs SET mnemonic_error_code=code,mnemonic_claim_token=NULL,mnemonic_claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=job.id;
 RETURN jsonb_build_object('status','blocked_mnemonic','errorCode',code);
END;
$$;

ALTER FUNCTION public.ai97_target_kanji(text,text,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_target_kanji(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.ai97_requires_mnemonic(text,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_requires_mnemonic(text,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.ai97_valid_slots(jsonb,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_valid_slots(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.ai97_valid_explanation(jsonb) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_valid_explanation(jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb) TO authenticated;

ALTER FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) TO service_role;

ALTER FUNCTION public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_ai_illustration_uploading(uuid,uuid,text,integer,integer,text) TO service_role;

ALTER FUNCTION public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer) TO service_role;

ALTER FUNCTION public.ai_s14_import_status_internal(uuid,uuid,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai_s14_import_status_internal(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;


ALTER FUNCTION public.s14_remote_prepare_mnemonic_retry(text,text,uuid,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_prepare_mnemonic_retry(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_prepare_mnemonic_retry(text,text,uuid,text) TO authenticated;

ALTER FUNCTION public.s14_remote_complete_mnemonic_retry(text,text,uuid,uuid,jsonb) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_complete_mnemonic_retry(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_complete_mnemonic_retry(text,text,uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_import_internal(p_owner_user_id uuid,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE initial_batch public.ai_import_batches%ROWTYPE;
DECLARE locked_batch public.ai_import_batches%ROWTYPE;
DECLARE candidate_card_ids uuid[] := '{}'::uuid[];
DECLARE locked_card_ids uuid[] := '{}'::uuid[];
DECLARE illustration_ids uuid[] := '{}'::uuid[];
DECLARE candidate_tag_ids uuid[] := '{}'::uuid[];
DECLARE target_id uuid;
DECLARE modified_card_id uuid;
DECLARE auto_deck_owner uuid;
DECLARE deleted_card_count integer := 0;
DECLARE deleted_skip_count integer := 0;
DECLARE auto_deck_status text := 'not_applicable';
DECLARE original_auto_deck_id uuid;
DECLARE result jsonb;
BEGIN
  SELECT batches.* INTO initial_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.id=p_batch_id;
  IF NOT FOUND OR initial_batch.owner_user_id IS DISTINCT FROM p_owner_user_id
    OR initial_batch.source NOT IN ('app_ai','remote_mcp') THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;

  -- S-11 workers acquire the concept job before any batch/item side effect.
  -- Lock every job first, then reject active delivery state without cancelling a
  -- claim or rewriting Queue messages. Terminal succeeded/failed jobs can be
  -- converted to undone after their cards/items are removed.
  PERFORM 1
  FROM public.ai_import_concept_jobs AS jobs
  WHERE jobs.batch_id=p_batch_id AND jobs.owner_user_id=p_owner_user_id
  ORDER BY jobs.id
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.ai_import_concept_jobs AS jobs
    WHERE jobs.batch_id=p_batch_id AND jobs.owner_user_id=p_owner_user_id
      AND (jobs.state IN ('queued','processing') OR jobs.mnemonic_claim_expires_at>clock_timestamp())
  ) THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  SELECT COALESCE(array_agg(items.result_card_id ORDER BY items.result_card_id),'{}'::uuid[])
  INTO candidate_card_ids
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status='finalized' AND items.result_card_id IS NOT NULL;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM 1
    FROM public.cards AS cards
    WHERE cards.id=target_id AND cards.owner_user_id=p_owner_user_id
      AND cards.visibility='private'
    FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  END LOOP;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(target_id::text,1010));
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT illustrations.id ORDER BY illustrations.id),'{}'::uuid[])
  INTO illustration_ids
  FROM public.cards AS cards
  JOIN public.illustrations AS illustrations
    ON illustrations.owner_user_id=p_owner_user_id
   AND illustrations.illustration_key=cards.illustration_key
  WHERE cards.id=ANY(candidate_card_ids);
  PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids);

  SELECT batches.* INTO locked_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.id=p_batch_id AND batches.owner_user_id=p_owner_user_id
    AND batches.source IN ('app_ai','remote_mcp')
  FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  IF locked_batch.status='undone' THEN RETURN locked_batch.undo_result; END IF;

  PERFORM 1
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
  ORDER BY items.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(i.result_card_id ORDER BY i.result_card_id),'{}'::uuid[])
  INTO locked_card_ids
  FROM (
    SELECT i.result_card_id
    FROM public.ai_import_items i
    WHERE i.batch_id=p_batch_id AND i.owner_user_id=p_owner_user_id
      AND i.status='finalized' AND i.result_card_id IS NOT NULL
    ORDER BY i.id FOR UPDATE
  ) AS i;
  IF locked_card_ids IS DISTINCT FROM candidate_card_ids THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;

  SELECT i.result_card_id INTO modified_card_id
  FROM public.ai_import_items i
  WHERE i.batch_id=p_batch_id AND i.owner_user_id=p_owner_user_id
    AND i.status='finalized' AND i.user_edited_at IS NOT NULL
  ORDER BY i.result_card_id
  LIMIT 1;
  IF modified_card_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error('CARD_MODIFIED',jsonb_build_object('cardId',modified_card_id));
  END IF;

  FOREACH target_id IN ARRAY candidate_card_ids LOOP
    PERFORM public.ai_assert_card_inactive(target_id,p_owner_user_id);
  END LOOP;

  original_auto_deck_id:=locked_batch.auto_created_deck_id;
  IF original_auto_deck_id IS NOT NULL THEN
    SELECT auto_decks.owner_user_id INTO auto_deck_owner
    FROM public.decks AS auto_decks
    WHERE auto_decks.id=original_auto_deck_id
    FOR UPDATE;
    IF NOT FOUND OR auto_deck_owner IS DISTINCT FROM p_owner_user_id THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
  END IF;

  PERFORM 1
  FROM public.deck_cards AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
  ORDER BY relations.card_id,relations.deck_id FOR UPDATE;
  PERFORM 1 FROM public.card_tags AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
  ORDER BY relations.card_id,relations.tag_id FOR UPDATE;
  PERFORM 1 FROM public.ai_import_item_tags AS relations
  JOIN public.ai_import_items AS items ON items.id=relations.item_id
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
  ORDER BY relations.item_id,relations.tag_id FOR UPDATE OF relations;

  SELECT COALESCE(array_agg(DISTINCT relations.tag_id ORDER BY relations.tag_id),'{}'::uuid[])
  INTO candidate_tag_ids
  FROM public.ai_import_item_tags AS relations
  JOIN public.ai_import_items AS items ON items.id=relations.item_id
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id;
  PERFORM 1 FROM public.tags AS tags
  WHERE tags.id=ANY(candidate_tag_ids) AND tags.owner_user_id=p_owner_user_id
  ORDER BY tags.id FOR UPDATE;

  SELECT count(*) INTO deleted_skip_count
  FROM public.ai_import_items AS items
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status='deleted';

  PERFORM public.ai_enable_internal_context();

  DELETE FROM public.deck_cards AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
    AND relations.deck_id=locked_batch.target_deck_id;
  DELETE FROM public.card_tags AS relations
  WHERE relations.card_id=ANY(candidate_card_ids)
    AND relations.tag_id=ANY(candidate_tag_ids);
  IF current_setting('app.s10_failpoint',true)='undo_after_relations' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  UPDATE public.ai_import_items AS items
  SET status='undone',result_card_id=NULL,deleted_card_id=NULL,
    undone_at=statement_timestamp()
  WHERE items.batch_id=p_batch_id AND items.owner_user_id=p_owner_user_id
    AND items.status<>'deleted';
  UPDATE public.ai_import_concept_jobs AS jobs
  SET state='undone',claim_token=NULL,claim_expires_at=NULL,
    terminal_message_id=NULL,terminal_claim_token_hash=NULL,
    next_attempt_at=NULL,error_code=NULL,mnemonic_claim_token=NULL,mnemonic_claim_expires_at=NULL,
    completed_at=COALESCE(jobs.completed_at,statement_timestamp()),
    updated_at=statement_timestamp()
  WHERE jobs.batch_id=p_batch_id AND jobs.owner_user_id=p_owner_user_id
    AND jobs.state IN ('succeeded','failed','blocked_mnemonic');
  IF current_setting('app.s10_failpoint',true)='undo_after_items' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  DELETE FROM public.cards AS cards
  WHERE cards.id=ANY(candidate_card_ids) AND cards.owner_user_id=p_owner_user_id
    AND cards.visibility='private';
  GET DIAGNOSTICS deleted_card_count=ROW_COUNT;
  IF current_setting('app.s10_failpoint',true)='undo_after_cards' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  DELETE FROM public.ai_import_item_tags AS relations
  USING public.ai_import_items AS items
  WHERE items.id=relations.item_id AND items.batch_id=p_batch_id
    AND items.owner_user_id=p_owner_user_id;
  DELETE FROM public.tags AS tags
  WHERE tags.id=ANY(candidate_tag_ids) AND tags.owner_user_id=p_owner_user_id
    AND NOT EXISTS(SELECT 1 FROM public.ai_import_item_tags AS links WHERE links.tag_id=tags.id)
    AND NOT EXISTS(SELECT 1 FROM public.card_tags AS links WHERE links.tag_id=tags.id);
  IF current_setting('app.s10_failpoint',true)='undo_after_tags' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  IF original_auto_deck_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.deck_cards WHERE deck_id=original_auto_deck_id) THEN
      auto_deck_status:='retained';
    ELSE
      UPDATE public.ai_import_batches
      SET target_deck_id=NULL,auto_created_deck_id=NULL
      WHERE id=p_batch_id AND owner_user_id=p_owner_user_id;
      DELETE FROM public.decks
      WHERE id=original_auto_deck_id AND owner_user_id=p_owner_user_id;
      auto_deck_status:='deleted';
    END IF;
  END IF;
  IF current_setting('app.s10_failpoint',true)='undo_after_auto_deck' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  result:=jsonb_build_object(
    'batchId',p_batch_id,'status','undone',
    'deletedCardCount',deleted_card_count,'deletedSkipCount',deleted_skip_count,
    'autoDeckStatus',auto_deck_status,'autoDeckId',original_auto_deck_id
  );
  UPDATE public.ai_import_batches
  SET status='undone',undone_at=statement_timestamp(),undo_result=result
  WHERE id=p_batch_id AND owner_user_id=p_owner_user_id;

  PERFORM public.ai_disable_internal_context();
  RETURN result;
END;
$$;
ALTER FUNCTION public.undo_import_internal(uuid,uuid) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.undo_import_internal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
