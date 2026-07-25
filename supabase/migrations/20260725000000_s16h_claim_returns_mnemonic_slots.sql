-- S-16H claim_ai_import_concept が承認済み card_mnemonics.slots を返す（issue #59 / design.md D1）
--
-- 目的: ai-card-import-worker が S-16B ニーモニックテンプレでプロンプトを組めるよう、claim と
--       同一トランザクションで承認済み slots を返す。
-- 前提: #55（20260724000000_s16_card_mnemonics_owner_fix.sql）で card_mnemonics の owner が
--       s10_migration_owner。claim RPC も同 owner の SECURITY DEFINER なのでテーブル owner として
--       RLS をバイパスして読める。owner 分離は SQL 側の owner-scope 条件で明示する。
-- DROP しない理由: DROP FUNCTION は service_role への EXECUTE GRANT を落とす。
--       CREATE OR REPLACE は owner と権限を保持するため、GRANT / REVOKE は再宣言しない。
-- 差分: (a) DECLARE mnemonic_slots jsonb; (b) image_mode='ai' 時の owner-scope join;
--       (c) 返り値 jsonb への 'mnemonicSlots' 追加。S-11 の状態機械・冪等性は変更しない。

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
		'mnemonicSlots',mnemonic_slots,
		'sourcePath',(SELECT uploads.source_storage_path FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
		'sourceBucket',(SELECT uploads.source_storage_bucket FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'sourceMime',(SELECT uploads.detected_mime_type FROM public.ai_uploads uploads WHERE uploads.id=representative.upload_id),
    'illustrationId',job.illustration_id,'illustrationPath',object_row.storage_path
  ));
END;
$$;

-- SECURITY DEFINER の実行 identity を明示的に固定する（冪等な再宣言）。
ALTER FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) OWNER TO s10_migration_owner;
