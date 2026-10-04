-- Issue #97: replacement images have their own objects; existing cards are never recreated.
CREATE TABLE public.ai_illustration_repair_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 original_job_id uuid NOT NULL REFERENCES public.ai_import_concept_jobs(id) ON DELETE RESTRICT,
 old_illustration_id uuid NOT NULL REFERENCES public.illustrations(id) ON DELETE RESTRICT,
 new_illustration_id uuid NOT NULL UNIQUE REFERENCES public.illustrations(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
 card_snapshot jsonb NOT NULL CHECK (jsonb_typeof(card_snapshot)='array'),
 old_mnemonic_updated_at timestamptz,
 state text NOT NULL DEFAULT 'needs_mnemonic' CHECK (state IN ('needs_mnemonic','blocked_mnemonic','queued','processing','generated','succeeded','failed','conflict')),
 slots jsonb, explanation jsonb,
 claim_token uuid, claim_expires_at timestamptz,
 error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
 attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
 image_reserved boolean NOT NULL DEFAULT false,
 next_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_user_id,idempotency_key),
 CHECK ((claim_token IS NULL)=(claim_expires_at IS NULL))
);
CREATE UNIQUE INDEX ai97_one_active_repair ON public.ai_illustration_repair_jobs(owner_user_id,old_illustration_id)
 WHERE state NOT IN ('succeeded','failed','conflict');
CREATE INDEX ai97_repair_claim ON public.ai_illustration_repair_jobs(state,created_at)
 WHERE state IN ('queued','processing','generated');
ALTER TABLE public.ai_illustration_repair_jobs OWNER TO s10_migration_owner;
ALTER TABLE public.ai_illustration_repair_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai97_repair_select_owner ON public.ai_illustration_repair_jobs FOR SELECT TO authenticated
 USING (owner_user_id=(SELECT auth.uid()));
REVOKE ALL ON public.ai_illustration_repair_jobs FROM anon,authenticated;
GRANT SELECT(id,owner_user_id,original_job_id,old_illustration_id,new_illustration_id,idempotency_key,
 state,error_code,attempt,created_at,updated_at) ON public.ai_illustration_repair_jobs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_illustration_repair_jobs TO s10_migration_owner;
ALTER TABLE public.ai_illustration_objects ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.ai_illustration_objects ADD COLUMN repair_job_id uuid UNIQUE
 REFERENCES public.ai_illustration_repair_jobs(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_illustration_objects ADD CONSTRAINT ai97_object_job_xor CHECK ((job_id IS NULL)<>(repair_job_id IS NULL));

CREATE FUNCTION public.ai97_prepare_repair(p_actor uuid,p_card_id uuid,p_expected_updated_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE card public.cards%ROWTYPE; DECLARE original public.ai_import_concept_jobs%ROWTYPE;
DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE; DECLARE new_id uuid:=gen_random_uuid(); DECLARE repair_id uuid:=gen_random_uuid();
DECLARE old_id uuid; DECLARE token uuid:=gen_random_uuid(); DECLARE snapshot jsonb; DECLARE mnemonic public.card_mnemonics%ROWTYPE;
DECLARE kanji text; DECLARE rows jsonb; DECLARE old_key text;
BEGIN
 IF p_actor IS NULL OR p_card_id IS NULL OR p_expected_updated_at IS NULL OR p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
  PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
 SELECT * INTO card FROM public.cards WHERE id=p_card_id AND owner_user_id=p_actor AND visibility='private';
 IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 -- Resolve idempotency before updated_at: a successful swap updates that timestamp.
 SELECT * INTO repair FROM public.ai_illustration_repair_jobs WHERE owner_user_id=p_actor AND idempotency_key=p_idempotency_key;
 IF FOUND AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(repair.card_snapshot) c WHERE c->>'id'=p_card_id::text) THEN
  PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 IF FOUND AND repair.state NOT IN ('needs_mnemonic','blocked_mnemonic') THEN
  RETURN jsonb_strip_nulls(jsonb_build_object('repairId',repair.id,'status',repair.state,'errorCode',repair.error_code)); END IF;
 IF card.updated_at IS DISTINCT FROM p_expected_updated_at THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 SELECT j.* INTO original FROM public.ai_import_concept_jobs j JOIN public.ai_import_items i ON i.batch_id=j.batch_id AND i.concept_id=j.concept_id
  JOIN public.illustrations ill ON ill.id=j.illustration_id
  WHERE i.result_card_id=p_card_id AND j.owner_user_id=p_actor AND j.state='succeeded' AND i.image_mode='ai'
    AND ill.illustration_key=card.illustration_key AND ill.owner_user_id=p_actor FOR UPDATE OF j;
 -- Repaired cards still refer to their original item/job, with a newer image key.
 IF NOT FOUND THEN
  SELECT j.* INTO original FROM public.ai_import_concept_jobs j JOIN public.ai_import_items i ON i.batch_id=j.batch_id AND i.concept_id=j.concept_id
   WHERE i.result_card_id=p_card_id AND j.owner_user_id=p_actor AND j.state='succeeded' AND i.image_mode='ai' FOR UPDATE OF j;
 END IF;
 IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':repair:'||card.illustration_key,1097));
 SELECT id INTO old_id FROM public.illustrations WHERE owner_user_id=p_actor AND illustration_key=card.illustration_key
  ORDER BY updated_at DESC,id DESC LIMIT 1;
 IF old_id IS NULL THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 SELECT jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at,'cardKey',card_key) ORDER BY id) INTO snapshot
  FROM public.cards WHERE owner_user_id=p_actor AND visibility='private' AND illustration_key=card.illustration_key;
 IF jsonb_array_length(snapshot)>100 THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 kanji:=public.ai97_target_kanji(card.pattern,card.front_text,card.back_text);
 IF EXISTS(SELECT 1 FROM public.cards WHERE owner_user_id=p_actor AND illustration_key=card.illustration_key
  AND public.ai97_target_kanji(pattern,front_text,back_text) IS DISTINCT FROM kanji) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 SELECT * INTO mnemonic FROM public.card_mnemonics WHERE owner_user_id=p_actor AND illustration_key=card.illustration_key;
 SELECT * INTO repair FROM public.ai_illustration_repair_jobs WHERE owner_user_id=p_actor AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.ai_illustration_repair_jobs WHERE owner_user_id=p_actor AND old_illustration_id=old_id
    AND state NOT IN ('succeeded','failed','conflict')) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
  INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status) VALUES(new_id,p_actor,'repair:'||repair_id::text,'pending');
  INSERT INTO public.ai_illustration_repair_jobs(id,owner_user_id,original_job_id,old_illustration_id,new_illustration_id,idempotency_key,
   card_snapshot,old_mnemonic_updated_at) VALUES(repair_id,p_actor,original.id,old_id,new_id,p_idempotency_key,snapshot,mnemonic.updated_at)
   RETURNING * INTO repair;
  INSERT INTO public.ai_illustration_objects(owner_user_id,repair_job_id,illustration_id,storage_path)
   VALUES(p_actor,repair.id,new_id,p_actor::text||'/s11-managed/'||new_id::text||'.png');
 END IF;
 IF repair.claim_expires_at>clock_timestamp() THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_illustration_repair_jobs SET claim_token=token,claim_expires_at=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=repair.id;
 rows:=jsonb_build_array(jsonb_build_object('conceptId',original.concept_id,'pattern',card.pattern,'front',card.front_text,'back',card.back_text));
 RETURN jsonb_build_object('repairId',repair.id,'status','needs_mnemonic','token',token,'items',rows,
  'mnemonic',CASE WHEN mnemonic.status='approved' AND public.ai97_valid_slots(mnemonic.slots,kanji) AND public.ai97_valid_explanation(mnemonic.explanation)
   THEN jsonb_build_object('slots',mnemonic.slots,'explanation',mnemonic.explanation) ELSE NULL END);
END;
$$;
CREATE FUNCTION public.s14_remote_prepare_illustration_repair(p_client_id text,p_session_id text,p_card_id uuid,p_expected_updated_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RETURN public.ai97_prepare_repair(public.ai_s14_remote_mcp_actor(p_client_id,p_session_id),p_card_id,p_expected_updated_at,p_idempotency_key); END;
$$;
CREATE FUNCTION public.s14_remote_complete_illustration_repair(p_client_id text,p_session_id text,p_repair_id uuid,p_token uuid,p_outcome jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE; DECLARE original_id uuid;
DECLARE kanji text; DECLARE new_key text; DECLARE code text;
BEGIN
 actor:=public.ai_s14_remote_mcp_actor(p_client_id,p_session_id);
 SELECT original_job_id INTO original_id FROM public.ai_illustration_repair_jobs WHERE id=p_repair_id AND owner_user_id=actor;
 PERFORM 1 FROM public.ai_import_concept_jobs WHERE id=original_id FOR UPDATE;
 SELECT * INTO repair FROM public.ai_illustration_repair_jobs WHERE id=p_repair_id AND owner_user_id=actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
 IF p_token IS NULL OR repair.claim_token IS DISTINCT FROM p_token OR repair.claim_expires_at<=clock_timestamp()
  OR repair.state NOT IN ('needs_mnemonic','blocked_mnemonic') THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 SELECT public.ai97_target_kanji(c.pattern,c.front_text,c.back_text) INTO kanji FROM public.cards c
  WHERE c.id=(repair.card_snapshot->0->>'id')::uuid AND c.owner_user_id=actor;
 IF p_outcome->>'conceptId' IS DISTINCT FROM (SELECT concept_id FROM public.ai_import_concept_jobs WHERE id=repair.original_job_id) THEN
  PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
 IF p_outcome->>'status'='approved' AND public.ai97_valid_slots(p_outcome->'mnemonic'->'slots',kanji)
  AND public.ai97_valid_explanation(p_outcome->'mnemonic'->'explanation') THEN
  SELECT illustration_key INTO new_key FROM public.illustrations WHERE id=repair.new_illustration_id;
  INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
   VALUES(actor,new_key,p_outcome->'mnemonic'->'slots',p_outcome->'mnemonic'->'explanation','approved');
  UPDATE public.ai_illustration_repair_jobs SET slots=p_outcome->'mnemonic'->'slots',explanation=p_outcome->'mnemonic'->'explanation',
   state='queued',claim_token=NULL,claim_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
  UPDATE public.ai_illustration_objects SET mnemonic_slots_snapshot=p_outcome->'mnemonic'->'slots',
   mnemonic_slots_hash=encode(extensions.digest(convert_to((p_outcome->'mnemonic'->'slots')::text,'UTF8'),'sha256'),'hex'),
   prompt_version='mnemonic-v2' WHERE repair_job_id=repair.id;
  RETURN jsonb_build_object('repairId',repair.id,'status','queued');
 END IF;
 code:=coalesce(p_outcome->>'code','MNEMONIC_VALIDATION_FAILED');
 IF code NOT LIKE 'MNEMONIC_%' OR code !~ '^[A-Z0-9_]{1,64}$' THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
 UPDATE public.ai_illustration_repair_jobs SET state='blocked_mnemonic',error_code=code,claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
 RETURN jsonb_build_object('repairId',repair.id,'status','blocked_mnemonic','errorCode',code);
END;
$$;

CREATE FUNCTION public.claim_ai_illustration_repair(p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE; DECLARE candidate uuid; DECLARE original public.ai_import_concept_jobs%ROWTYPE;
DECLARE object_row public.ai_illustration_objects%ROWTYPE; DECLARE day date:=(clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
 PERFORM public.ai_s11_require_service_role();
 IF p_claim_token IS NULL THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 SELECT id INTO candidate FROM public.ai_illustration_repair_jobs WHERE state IN ('queued','processing','generated')
  AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp()) ORDER BY created_at,id LIMIT 1;
 IF candidate IS NULL THEN RETURN jsonb_build_object('outcome','empty'); END IF;
 SELECT j.* INTO original FROM public.ai_import_concept_jobs j JOIN public.ai_illustration_repair_jobs r ON r.original_job_id=j.id WHERE r.id=candidate FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','empty'); END IF;
 SELECT * INTO repair FROM public.ai_illustration_repair_jobs WHERE id=candidate AND state IN ('queued','processing','generated')
  AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp()) FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','empty'); END IF;
 SELECT * INTO object_row FROM public.ai_illustration_objects WHERE repair_job_id=repair.id;
 IF original.state<>'succeeded' OR repair.card_snapshot IS DISTINCT FROM (
  SELECT jsonb_agg(jsonb_build_object('id',c.id,'updatedAt',c.updated_at,'cardKey',c.card_key) ORDER BY c.id)
  FROM public.cards c JOIN public.illustrations ill ON ill.illustration_key=c.illustration_key AND ill.owner_user_id=c.owner_user_id
  WHERE c.owner_user_id=repair.owner_user_id AND c.visibility='private' AND ill.id=repair.old_illustration_id) THEN
  UPDATE public.ai_illustration_repair_jobs SET state='conflict',error_code='REPAIR_CONFLICT',claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
  UPDATE public.ai_illustration_objects SET state='orphan',delete_due_at=clock_timestamp(),error_code='REPAIR_CONFLICT' WHERE repair_job_id=repair.id;
  RETURN jsonb_build_object('outcome','empty'); END IF;
 -- Bound ambiguous provider/upload retries, but do not discard an image waiting on active study.
 IF object_row.digest IS NULL AND repair.attempt>=3 THEN
  UPDATE public.ai_illustration_repair_jobs SET state='failed',error_code='REPAIR_RETRY_EXHAUSTED',
   claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
  UPDATE public.ai_illustration_objects SET state='orphan',delete_due_at=clock_timestamp(),error_code='REPAIR_RETRY_EXHAUSTED' WHERE repair_job_id=repair.id;
  RETURN jsonb_build_object('outcome','empty'); END IF;
 IF NOT repair.image_reserved THEN
  -- Completed import items cannot use reserve_provider_usage_internal (it requires processing items).
  -- Reserve the same existing illustration_concept quota kind once, without mutating original items.
  INSERT INTO public.ai_usage_daily(owner_user_id,usage_date) VALUES(repair.owner_user_id,day) ON CONFLICT DO NOTHING;
  UPDATE public.ai_usage_daily SET generated_image_count=generated_image_count+1 WHERE owner_user_id=repair.owner_user_id AND usage_date=day AND generated_image_count<50;
  IF NOT FOUND THEN
   UPDATE public.ai_illustration_repair_jobs SET state='failed',error_code='QUOTA_EXCEEDED',claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
   UPDATE public.ai_illustration_objects SET state='orphan',delete_due_at=clock_timestamp(),error_code='QUOTA_EXCEEDED' WHERE repair_job_id=repair.id;
   RETURN jsonb_build_object('outcome','empty'); END IF;
  INSERT INTO public.ai_quota_reservations(owner_user_id,reservation_key,kind,source,generation_request_hash,status,units,usage_date,batch_id,item_id,concept_id,provider_started_at)
   SELECT repair.owner_user_id,'repair:'||repair.id::text,'illustration_concept',b.source,
    encode(extensions.digest(convert_to(repair.id::text,'UTF8'),'sha256'),'hex'),'reserved',1,day,original.batch_id,i.id,original.concept_id,clock_timestamp()
   FROM public.ai_import_items i JOIN public.ai_import_batches b ON b.id=i.batch_id
   WHERE i.batch_id=original.batch_id AND i.concept_id=original.concept_id ORDER BY i.ordinal LIMIT 1;
 END IF;
 UPDATE public.ai_illustration_repair_jobs SET state=CASE WHEN object_row.digest IS NULL THEN 'processing' ELSE 'generated' END,
  image_reserved=true,next_attempt_at=NULL,attempt=attempt+1,claim_token=p_claim_token,claim_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE id=repair.id;
 RETURN jsonb_build_object('outcome','claimed','repairId',repair.id,'token',p_claim_token,'slots',repair.slots,
  'illustrationId',repair.new_illustration_id,'path',object_row.storage_path,'digest',object_row.digest,'width',object_row.width,'height',object_row.height);
END;
$$;
CREATE FUNCTION public.ai97_assert_repair_claim(p_repair_id uuid,p_token uuid)
RETURNS public.ai_illustration_repair_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original_id uuid; DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE;
BEGIN
 SELECT original_job_id INTO original_id FROM public.ai_illustration_repair_jobs WHERE id=p_repair_id;
 PERFORM 1 FROM public.ai_import_concept_jobs WHERE id=original_id FOR UPDATE;
 SELECT * INTO repair FROM public.ai_illustration_repair_jobs WHERE id=p_repair_id FOR UPDATE;
 IF NOT FOUND OR p_token IS NULL OR repair.claim_token IS DISTINCT FROM p_token OR repair.claim_expires_at<=clock_timestamp()
  OR repair.state NOT IN ('processing','generated') THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 RETURN repair;
END;
$$;
CREATE FUNCTION public.mark_ai_repair_generated(p_repair_id uuid,p_token uuid,p_digest text,p_width integer,p_height integer,p_prompt_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE;
BEGIN
 PERFORM public.ai_s11_require_service_role(); repair:=public.ai97_assert_repair_claim(p_repair_id,p_token);
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_prompt_hash IS NULL OR p_prompt_hash !~ '^[0-9a-f]{64}$'
  OR p_width IS NULL OR p_height IS NULL OR p_width NOT BETWEEN 1 AND 1024 OR p_height NOT BETWEEN 1 AND 1024 THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_illustration_objects SET digest=p_digest,width=p_width,height=p_height,prompt_hash=p_prompt_hash,updated_at=clock_timestamp() WHERE repair_job_id=repair.id;
 UPDATE public.ai_illustration_repair_jobs SET state='generated',updated_at=clock_timestamp() WHERE id=repair.id;
END;
$$;
CREATE FUNCTION public.fail_ai_illustration_repair(p_repair_id uuid,p_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE;
BEGIN
 PERFORM public.ai_s11_require_service_role(); repair:=public.ai97_assert_repair_claim(p_repair_id,p_token);
 IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$' THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_illustration_repair_jobs SET state='failed',error_code=p_error_code,claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
 UPDATE public.ai_illustration_objects SET state='orphan',delete_due_at=clock_timestamp(),error_code=p_error_code WHERE repair_job_id=repair.id;
END;
$$;
CREATE FUNCTION public.finalize_ai_illustration_repair(p_repair_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE repair public.ai_illustration_repair_jobs%ROWTYPE; DECLARE snapshot jsonb; DECLARE old_key text; DECLARE new_key text;
DECLARE current_mnemonic_at timestamptz; DECLARE object_row public.ai_illustration_objects%ROWTYPE; DECLARE card_id uuid;
BEGIN
 PERFORM public.ai_s11_require_service_role(); repair:=public.ai97_assert_repair_claim(p_repair_id,p_token);
 SELECT illustration_key INTO old_key FROM public.illustrations WHERE id=repair.old_illustration_id AND owner_user_id=repair.owner_user_id;
 -- Match card mutation lock order: cards before illustration lifecycle; no sibling locks from triggers.
 FOR card_id IN SELECT (c->>'id')::uuid FROM jsonb_array_elements(repair.card_snapshot) c ORDER BY (c->>'id')::uuid LOOP
  PERFORM 1 FROM public.cards WHERE id=card_id AND owner_user_id=repair.owner_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(card_id::text,1010));
 END LOOP;
 PERFORM public.ai_s11_lock_illustration_lifecycle(ARRAY[repair.old_illustration_id,repair.new_illustration_id]);
 SELECT jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at,'cardKey',card_key) ORDER BY id) INTO snapshot
  FROM public.cards WHERE owner_user_id=repair.owner_user_id AND visibility='private' AND illustration_key=old_key;
 SELECT updated_at INTO current_mnemonic_at FROM public.card_mnemonics WHERE owner_user_id=repair.owner_user_id AND illustration_key=old_key;
 IF snapshot IS DISTINCT FROM repair.card_snapshot OR current_mnemonic_at IS DISTINCT FROM repair.old_mnemonic_updated_at THEN
  UPDATE public.ai_illustration_repair_jobs SET state='conflict',error_code='REPAIR_CONFLICT',claim_token=NULL,claim_expires_at=NULL WHERE id=repair.id;
  UPDATE public.ai_illustration_objects SET state='orphan',delete_due_at=clock_timestamp() WHERE repair_job_id=repair.id;
  RETURN jsonb_build_object('status','conflict','errorCode','REPAIR_CONFLICT'); END IF;
 -- A savepoint catches only the known active-session guard; old image stays attached.
 BEGIN
  FOR card_id IN SELECT (c->>'id')::uuid FROM jsonb_array_elements(repair.card_snapshot) c LOOP
   PERFORM public.ai_assert_card_inactive(card_id,repair.owner_user_id);
  END LOOP;
 EXCEPTION WHEN SQLSTATE 'P1006' THEN
  UPDATE public.ai_illustration_repair_jobs SET state='generated',error_code='ACTIVE_SESSION',next_attempt_at=clock_timestamp()+interval '60 seconds',claim_token=NULL,
   claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
  RETURN jsonb_build_object('status','generated','errorCode','ACTIVE_SESSION');
 END;
 SELECT * INTO object_row FROM public.ai_illustration_objects WHERE repair_job_id=repair.id FOR UPDATE;
 IF object_row.digest IS NULL OR object_row.prompt_hash IS NULL OR object_row.prompt_version IS DISTINCT FROM 'mnemonic-v2'
  OR object_row.mnemonic_slots_hash IS DISTINCT FROM encode(extensions.digest(convert_to(repair.slots::text,'UTF8'),'sha256'),'hex')
  OR NOT EXISTS(SELECT 1 FROM public.card_mnemonics m JOIN public.illustrations i ON i.illustration_key=m.illustration_key AND i.owner_user_id=m.owner_user_id
   WHERE i.id=repair.new_illustration_id AND m.status='approved' AND m.slots=repair.slots) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
 UPDATE public.ai_illustration_objects SET state='ready',updated_at=clock_timestamp() WHERE id=object_row.id;
 UPDATE public.illustrations SET status='ready',storage_path=object_row.storage_path,model_info='s30-repair',prompt=NULL WHERE id=repair.new_illustration_id
  RETURNING illustration_key INTO new_key;
 INSERT INTO s10_private.management_mutation_context(backend_pid,transaction_id) VALUES(pg_backend_pid(),txid_current());
 UPDATE public.cards SET illustration_key=new_key WHERE owner_user_id=repair.owner_user_id AND illustration_key=old_key;
 DELETE FROM s10_private.management_mutation_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 UPDATE public.ai_import_items SET user_edited_at=coalesce(user_edited_at,clock_timestamp())
  WHERE owner_user_id=repair.owner_user_id AND result_card_id IN (SELECT (c->>'id')::uuid FROM jsonb_array_elements(repair.card_snapshot) c);
 UPDATE public.ai_illustration_repair_jobs SET state='succeeded',error_code=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=clock_timestamp() WHERE id=repair.id;
 RETURN jsonb_build_object('status','succeeded','repairId',repair.id);
END;
$$;

ALTER FUNCTION public.ai97_prepare_repair(uuid,uuid,timestamptz,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_prepare_repair(uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.s14_remote_prepare_illustration_repair(text,text,uuid,timestamptz,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_prepare_illustration_repair(text,text,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_prepare_illustration_repair(text,text,uuid,timestamptz,text) TO authenticated;

ALTER FUNCTION public.s14_remote_complete_illustration_repair(text,text,uuid,uuid,jsonb) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_complete_illustration_repair(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_complete_illustration_repair(text,text,uuid,uuid,jsonb) TO authenticated;

ALTER FUNCTION public.claim_ai_illustration_repair(uuid) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.claim_ai_illustration_repair(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_illustration_repair(uuid) TO service_role;

ALTER FUNCTION public.ai97_assert_repair_claim(uuid,uuid) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.ai97_assert_repair_claim(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.mark_ai_repair_generated(uuid,uuid,text,integer,integer,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.mark_ai_repair_generated(uuid,uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_ai_repair_generated(uuid,uuid,text,integer,integer,text) TO service_role;

ALTER FUNCTION public.fail_ai_illustration_repair(uuid,uuid,text) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.fail_ai_illustration_repair(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_illustration_repair(uuid,uuid,text) TO service_role;

ALTER FUNCTION public.finalize_ai_illustration_repair(uuid,uuid) OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.finalize_ai_illustration_repair(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_illustration_repair(uuid,uuid) TO service_role;
