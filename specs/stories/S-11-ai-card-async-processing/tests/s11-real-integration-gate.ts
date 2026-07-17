import { createS11DbClient } from "./helpers/s11-db-testkit";

const databaseUrl = process.env.S11_REAL_DATABASE_URL?.trim();
if (!databaseUrl) {
	process.stderr.write(`${JSON.stringify({ gate: "s11-real-integration", status: "not_run", reason: "S11_REAL_DATABASE_URL is required; mock fallback is forbidden" })}\n`);
	process.exit(2);
}
const db = createS11DbClient(databaseUrl);
const rows = await db.query<{ queue_exists: boolean; contract_ok: boolean; acl_ok: boolean; pgmq_delegate_acl_ok: boolean; vault_decrypt_ok: boolean; bucket_ok: boolean }>(`
	SELECT
		to_regclass('pgmq.q_ai_card_imports') IS NOT NULL AS queue_exists,
		to_regprocedure('public.claim_ai_import_concept(uuid,bigint,uuid)') IS NOT NULL
		AND to_regprocedure('public.finalize_ai_import_concept(uuid,bigint,uuid,uuid,text,integer,integer)') IS NOT NULL
		AND to_regprocedure('public.fail_ai_import_concept(uuid,bigint,uuid,text,text)') IS NOT NULL
		AND to_regprocedure('public.release_ai_source_after_terminal(uuid)') IS NOT NULL
		AND to_regprocedure('public.verify_ai_import_cleanup(uuid,text,text,uuid)') IS NOT NULL
		AND to_regprocedure('public.complete_ai_import_cleanup(uuid,text,text,uuid,text)') IS NOT NULL
		AND to_regprocedure('public.claim_ai_worker_log_outbox(uuid)') IS NOT NULL AS contract_ok,
		NOT has_function_privilege('authenticated','public.claim_ai_import_concept(uuid,bigint,uuid)','EXECUTE')
		AND has_function_privilege('service_role','public.claim_ai_import_concept(uuid,bigint,uuid)','EXECUTE') AS acl_ok,
		to_regprocedure('pgmq.format_table_name(text,text)') IS NOT NULL
		AND to_regprocedure('pgmq.send(text,jsonb,jsonb,timestamp with time zone)') IS NOT NULL
		AND has_function_privilege('s10_migration_owner','pgmq.format_table_name(text,text)','EXECUTE')
		AND has_function_privilege('s10_migration_owner','pgmq.send(text,jsonb,jsonb,timestamp with time zone)','EXECUTE') AS pgmq_delegate_acl_ok,
		to_regprocedure('vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea)') IS NOT NULL
		AND has_function_privilege('s10_migration_owner','vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea)','EXECUTE') AS vault_decrypt_ok,
		EXISTS (SELECT 1 FROM storage.buckets WHERE id='ai-card-sources' AND public=false AND file_size_limit=10485760) AS bucket_ok
`);
const contract = rows[0];
if (!contract || Object.values(contract).some((value) => value !== true)) throw new Error("real database contract gate failed");
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE source_claims integer; source_token uuid; raw_token uuid;
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('15000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-intent@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,raw_storage_path,raw_storage_bucket,delete_due_at,created_at)
		VALUES('15000000-0000-4000-8000-000000000010','15000000-0000-4000-8000-00000000000a','intent','card_illustration','15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/raw','image/png',64,'prepared','15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/raw','ai-card-sources',clock_timestamp(),clock_timestamp()-interval '24 hours');
		-- source-write-intent-ambiguous-cleanup: intent commits before the attempted write.
		PERFORM public.mark_ai_source_write_intent(
			'15000000-0000-4000-8000-00000000000a','15000000-0000-4000-8000-000000000010',
			'15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/source'
		);
		PERFORM public.mark_ai_upload_cleanup(
			'15000000-0000-4000-8000-00000000000a','15000000-0000-4000-8000-000000000010',
			'15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/source'
		);
		-- cleanup-entity-limit-pair-expansion: limit one entity expands both due paths.
		CREATE TEMP TABLE s11_entity_claims ON COMMIT DROP AS
		SELECT * FROM public.claim_ai_import_cleanup(1);
		SELECT count(*),
			min("claimToken"::text) FILTER (WHERE path LIKE '%/source')::uuid,
			min("claimToken"::text) FILTER (WHERE path LIKE '%/raw')::uuid
		INTO source_claims,source_token,raw_token FROM s11_entity_claims
		WHERE "trackingId"='15000000-0000-4000-8000-000000000010';
		IF source_claims<>2 OR source_token IS NULL OR raw_token IS NULL THEN
			RAISE EXCEPTION 'entity cleanup limit split source/raw pair';
		END IF;
		IF public.verify_ai_import_cleanup(
			'15000000-0000-4000-8000-000000000010','ai-card-sources',
			'15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/source',
			source_token)->>'outcome'<>'delete' THEN RAISE EXCEPTION 'source intent cleanup verify failed'; END IF;
		PERFORM public.complete_ai_import_cleanup(
			'15000000-0000-4000-8000-000000000010','ai-card-sources',
			'15000000-0000-4000-8000-00000000000a/15000000-0000-4000-8000-000000000010/source',
			source_token,'deleted'
		);
		IF EXISTS (SELECT 1 FROM public.ai_uploads WHERE id='15000000-0000-4000-8000-000000000010' AND source_write_intent_path IS NOT NULL) THEN
			RAISE EXCEPTION '404-safe source intent completion did not clear intent';
		END IF;
	END $gate$;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE cleanup_token uuid; verified jsonb;
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('16000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-complete@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('16000000-0000-4000-8000-000000000010','16000000-0000-4000-8000-00000000000a','s11-complete');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('16000000-0000-4000-8000-000000000020','16000000-0000-4000-8000-00000000000a','app_ai','16000000-0000-4000-8000-000000000010','processing','s11-complete',repeat('a',64),'s11-complete-card',1,1);
		INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
		VALUES('16000000-0000-4000-8000-000000000030','16000000-0000-4000-8000-00000000000a','s11-deleted-attach','ready','16000000-0000-4000-8000-00000000000a/s11-managed/16000000-0000-4000-8000-000000000030.png');
		INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path,prompt)
		VALUES('16000000-0000-4000-8000-000000000031','16000000-0000-4000-8000-00000000000a','legacy-owner-update','ready','16000000-0000-4000-8000-00000000000a/legacy-owner-update.png','before');
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id)
		VALUES('16000000-0000-4000-8000-000000000040','16000000-0000-4000-8000-00000000000a','16000000-0000-4000-8000-000000000020','complete','succeeded','16000000-0000-4000-8000-000000000030');
		INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state,delete_due_at,created_at)
		VALUES('16000000-0000-4000-8000-000000000050','16000000-0000-4000-8000-00000000000a','16000000-0000-4000-8000-000000000040','16000000-0000-4000-8000-000000000030','16000000-0000-4000-8000-00000000000a/s11-managed/16000000-0000-4000-8000-000000000030.png','delete_pending',clock_timestamp()-interval '1 second',clock_timestamp()-interval '25 hours');
		INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key)
		VALUES('16000000-0000-4000-8000-000000000060','16000000-0000-4000-8000-00000000000a','private','reading','R1','complete-front','complete-back',repeat('b',64));
		SELECT "claimToken" INTO cleanup_token FROM public.claim_ai_import_cleanup(1)
		WHERE "trackingId"='16000000-0000-4000-8000-000000000050';
		UPDATE public.ai_illustration_objects SET cleanup_claimed_at=clock_timestamp()-interval '4 minutes 59 seconds'
		WHERE id='16000000-0000-4000-8000-000000000050';
		verified := public.verify_ai_import_cleanup(
			'16000000-0000-4000-8000-000000000050','illustrations',
			'16000000-0000-4000-8000-00000000000a/s11-managed/16000000-0000-4000-8000-000000000030.png',
			cleanup_token);
		IF verified->>'outcome'<>'delete' THEN RAISE EXCEPTION '4:59 cleanup verification failed'; END IF;
		-- cleanup-complete-expiry-fence: completion rechecks the DB-clock lease.
		UPDATE public.ai_illustration_objects SET cleanup_claimed_at=clock_timestamp()-interval '6 minutes'
		WHERE id='16000000-0000-4000-8000-000000000050';
		BEGIN
			PERFORM public.complete_ai_import_cleanup(
				'16000000-0000-4000-8000-000000000050','illustrations',
				'16000000-0000-4000-8000-00000000000a/s11-managed/16000000-0000-4000-8000-000000000030.png',
				cleanup_token,'deleted'
			);
			RAISE EXCEPTION 'expired cleanup completion accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		UPDATE public.ai_illustration_objects SET cleanup_claimed_at=clock_timestamp()
		WHERE id='16000000-0000-4000-8000-000000000050';
		-- service-cleanup-lifecycle: service-role completion atomically updates tracking and illustration.
		PERFORM public.complete_ai_import_cleanup(
			'16000000-0000-4000-8000-000000000050','illustrations',
			'16000000-0000-4000-8000-00000000000a/s11-managed/16000000-0000-4000-8000-000000000030.png',
			cleanup_token,'deleted'
		);
		IF NOT EXISTS (SELECT 1 FROM public.illustrations WHERE id='16000000-0000-4000-8000-000000000030' AND status='failed' AND storage_path IS NULL) THEN
			RAISE EXCEPTION 'deleted illustration remained attachable';
		END IF;
		-- deleted-illustration-reattach-rejected through the authenticated public RPC.
		PERFORM set_config('request.jwt.claim.role','authenticated',true);
		PERFORM set_config('request.jwt.claim.sub','16000000-0000-4000-8000-00000000000a',true);
		BEGIN
			PERFORM public.set_card_illustration('16000000-0000-4000-8000-000000000060','16000000-0000-4000-8000-000000000030');
			RAISE EXCEPTION 'deleted illustration reattached';
		EXCEPTION WHEN SQLSTATE 'P1003' THEN NULL; END;
		PERFORM set_config('request.jwt.claim.role','service_role',true);
	END $gate$;
	SET LOCAL ROLE authenticated;
	SET LOCAL request.jwt.claim.role='authenticated';
	SET LOCAL request.jwt.claim.sub='16000000-0000-4000-8000-00000000000a';
	DO $owner$
	BEGIN
		-- nondeleted-owner-update-allowed: legacy/pre-cleanup owner workflow remains writable through RLS.
		UPDATE public.illustrations SET prompt='after'
		WHERE id='16000000-0000-4000-8000-000000000031';
		IF NOT FOUND THEN RAISE EXCEPTION 'legitimate owner update was blocked'; END IF;
		-- owner-rest-resurrection-rejected: direct PostgREST-equivalent authenticated UPDATE is fenced.
		BEGIN
			UPDATE public.illustrations SET status='ready',
				storage_path='16000000-0000-4000-8000-00000000000a/resurrected.png'
			WHERE id='16000000-0000-4000-8000-000000000030';
			RAISE EXCEPTION 'owner resurrected cleanup-deleted illustration';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		-- deleted-attach-rejected: direct card illustration-key mutation is also DB-fenced.
		BEGIN
			UPDATE public.cards SET illustration_key='s11-deleted-attach'
			WHERE id='16000000-0000-4000-8000-000000000060';
			RAISE EXCEPTION 'owner attached cleanup-deleted illustration';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
	END $owner$;
	RESET ROLE;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE message_id bigint; pair_message bigint; read_id bigint; claim jsonb; cleanup jsonb; finalized jsonb; released jsonb;
	DECLARE cleanup_path text; raw_cleanup_path text; cleanup_token uuid; raw_cleanup_token uuid;
	DECLARE stale_cleanup_token uuid;
	BEGIN
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"00000000-0000-4000-8000-000000000001","batchId":"00000000-0000-4000-8000-000000000002"}'::jsonb) INTO message_id;
		SELECT msg_id INTO read_id FROM pgmq.read('ai_card_imports',300,100,'{}'::jsonb) WHERE msg_id=message_id;
		IF read_id IS DISTINCT FROM message_id THEN RAISE EXCEPTION 'pgmq delivery boundary failed'; END IF;
		IF NOT pgmq.archive('ai_card_imports',message_id) THEN RAISE EXCEPTION 'pgmq archive failed'; END IF;
		claim := public.claim_ai_import_concept(
			'00000000-0000-4000-8000-000000000001',message_id,
			'00000000-0000-4000-8000-000000000003');
		IF claim->>'outcome'<>'missing' THEN RAISE EXCEPTION 'claim missing boundary failed'; END IF;
		BEGIN
			PERFORM public.finalize_ai_import_concept(
				'00000000-0000-4000-8000-000000000001',message_id,
				'00000000-0000-4000-8000-000000000003',NULL,NULL,NULL,NULL
			);
			RAISE EXCEPTION 'finalize old-token boundary accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.fail_ai_import_concept(
				'00000000-0000-4000-8000-000000000001',message_id,
				'00000000-0000-4000-8000-000000000003','IMAGE_DECODE_FAILED'
			);
			RAISE EXCEPTION 'fail old-token boundary accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		cleanup := public.verify_ai_import_cleanup(
			'00000000-0000-4000-8000-000000000001','ai-card-sources',
			'00000000-0000-4000-8000-000000000001/source',
			'00000000-0000-4000-8000-000000000004');
		IF cleanup->>'outcome'<>'skip' THEN RAISE EXCEPTION 'cleanup missing fence failed'; END IF;

		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('10000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-real-gate@example.local','not-for-login',now(),'{}','{}',now(),now())
		ON CONFLICT(id) DO NOTHING;
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('11000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-00000000000a','s11-real-gate');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('11000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-00000000000a','app_ai','11000000-0000-4000-8000-000000000010','processing','s11-real-gate',repeat('a',64),'s11-real-card',1,0);
		INSERT INTO public.ai_import_items(id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,front_text,back_text,card_key,image_mode,status)
		VALUES('11000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-00000000000a','11000000-0000-4000-8000-000000000020','single-r1','single',0,'R1','reading','fixture-front','fixture-back',repeat('c',64),'none','processing');
		INSERT INTO public.ai_quota_reservations(owner_user_id,reservation_key,kind,source,generation_request_hash,import_request_hash,usage_date,batch_id,units,status,provider_started_at)
		VALUES('10000000-0000-4000-8000-00000000000a','s11-real-card','card_generation','app_ai',repeat('b',64),repeat('a',64),current_date,'11000000-0000-4000-8000-000000000020',1,'reserved',now());
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"11000000-0000-4000-8000-000000000040","batchId":"11000000-0000-4000-8000-000000000020"}'::jsonb) INTO pair_message;
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,queue_message_id,claim_token,claim_expires_at)
		VALUES('11000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-00000000000a','11000000-0000-4000-8000-000000000020','single','processing',pair_message,'11000000-0000-4000-8000-000000000041',now()+interval '5 minutes');
		finalized := public.finalize_ai_import_concept('11000000-0000-4000-8000-000000000040',pair_message,'11000000-0000-4000-8000-000000000041',NULL,NULL,NULL,NULL);
		IF finalized->>'status'<>'succeeded' OR
		   (SELECT count(*) FROM public.ai_import_items WHERE batch_id='11000000-0000-4000-8000-000000000020' AND status='finalized')<>1 THEN
			RAISE EXCEPTION 'single-pattern finalize boundary failed';
		END IF;

		INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,source_storage_path,source_storage_bucket,detected_mime_type,width,height,sha256,delete_due_at)
		VALUES('11000000-0000-4000-8000-000000000060','10000000-0000-4000-8000-00000000000a','s11-shared-legacy','card_illustration','10000000-0000-4000-8000-00000000000a/shared-legacy','image/png',64,'ready','10000000-0000-4000-8000-00000000000a/shared-legacy','illustrations','image/png',64,64,repeat('e',64),now()+interval '1 day');
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state)
		VALUES
			('11000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-00000000000a','11000000-0000-4000-8000-000000000020','shared-a','queued'),
			('11000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-00000000000a','11000000-0000-4000-8000-000000000020','shared-b','queued');
		INSERT INTO public.ai_upload_consumers(upload_id,job_id,owner_user_id) VALUES
			('11000000-0000-4000-8000-000000000060','11000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-00000000000a'),
			('11000000-0000-4000-8000-000000000060','11000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-00000000000a');
		UPDATE public.ai_import_concept_jobs SET state='failed',terminal_message_id=62,
			terminal_claim_token_hash=encode(extensions.digest(
				convert_to('11000000-0000-4000-8000-000000000063','UTF8'),'sha256'),'hex')
		WHERE id='11000000-0000-4000-8000-000000000062';
		released := public.release_ai_source_after_terminal('11000000-0000-4000-8000-000000000062');
		IF released->>'outcome'<>'retain' THEN RAISE EXCEPTION 'shared source deleted before all consumers terminal'; END IF;
		UPDATE public.ai_import_concept_jobs SET state='succeeded' WHERE id='11000000-0000-4000-8000-000000000061';
		released := public.release_ai_source_after_terminal('11000000-0000-4000-8000-000000000061');
		IF released->>'outcome'<>'delete' OR released->>'bucket'<>'illustrations' THEN
			RAISE EXCEPTION 'shared legacy source release contract failed';
		END IF;

		INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,raw_storage_path,raw_storage_bucket,source_storage_path,source_storage_bucket,detected_mime_type,width,height,sha256,delete_due_at,created_at)
		VALUES('11000000-0000-4000-8000-000000000050','10000000-0000-4000-8000-00000000000a','s11-real-cleanup','card_illustration','10000000-0000-4000-8000-00000000000a/original','image/png',64,'ready','10000000-0000-4000-8000-00000000000a/raw','ai-card-sources','10000000-0000-4000-8000-00000000000a/source','ai-card-sources','image/png',64,64,repeat('d',64),now()-interval '1 minute',now()-interval '24 hours');
		CREATE TEMP TABLE s11_first_cleanup_claims ON COMMIT DROP AS
		SELECT * FROM public.claim_ai_import_cleanup(100);
		IF (SELECT count(*) FROM s11_first_cleanup_claims
			WHERE "trackingId"='11000000-0000-4000-8000-000000000050')<>2 THEN
			RAISE EXCEPTION 'source-and-raw-first-run claim failed';
		END IF;
		SELECT path,"claimToken" INTO cleanup_path,stale_cleanup_token
		FROM s11_first_cleanup_claims
		WHERE "trackingId"='11000000-0000-4000-8000-000000000050' AND path LIKE '%/source';
		-- Simulate a cleanup worker dying after claim. Both independent claims must receive new identities.
		UPDATE public.ai_uploads SET cleanup_claimed_at=clock_timestamp()-interval '6 minutes',
			raw_cleanup_claimed_at=clock_timestamp()-interval '6 minutes'
		WHERE id='11000000-0000-4000-8000-000000000050';
		CREATE TEMP TABLE s11_reclaimed_cleanup_claims ON COMMIT DROP AS
		SELECT * FROM public.claim_ai_import_cleanup(100);
		SELECT path,"claimToken" INTO cleanup_path,cleanup_token
		FROM s11_reclaimed_cleanup_claims
		WHERE "trackingId"='11000000-0000-4000-8000-000000000050' AND path LIKE '%/source';
		SELECT path,"claimToken" INTO raw_cleanup_path,raw_cleanup_token
		FROM s11_reclaimed_cleanup_claims
		WHERE "trackingId"='11000000-0000-4000-8000-000000000050' AND path LIKE '%/raw';
		BEGIN
			PERFORM public.verify_ai_import_cleanup(
				'11000000-0000-4000-8000-000000000050','ai-card-sources',cleanup_path,
				stale_cleanup_token
			);
			RAISE EXCEPTION 'stale cleanup identity accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		IF cleanup_path IS NULL OR raw_cleanup_path IS NULL OR cleanup_token=stale_cleanup_token OR
			public.verify_ai_import_cleanup('11000000-0000-4000-8000-000000000050','ai-card-sources',cleanup_path,cleanup_token)->>'outcome'<>'delete' THEN
			RAISE EXCEPTION 'stale source cleanup reclaim failed';
		END IF;
		PERFORM public.complete_ai_import_cleanup('11000000-0000-4000-8000-000000000050','ai-card-sources',cleanup_path,cleanup_token,'deleted');
		IF public.verify_ai_import_cleanup('11000000-0000-4000-8000-000000000050','ai-card-sources',raw_cleanup_path,raw_cleanup_token)->>'outcome'<>'delete' THEN
			RAISE EXCEPTION 'raw cleanup fence failed';
		END IF;
		PERFORM public.complete_ai_import_cleanup('11000000-0000-4000-8000-000000000050','ai-card-sources',raw_cleanup_path,raw_cleanup_token,'deleted');
		IF (SELECT status FROM public.ai_uploads WHERE id='11000000-0000-4000-8000-000000000050')<>'deleted' THEN
			RAISE EXCEPTION 'ready source cleanup completion failed';
		END IF;
	END $gate$;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE message_id bigint; claim_a jsonb; claim_b jsonb; failed_result jsonb; outbox_event jsonb;
	DECLARE state_a jsonb; state_b jsonb;
	DECLARE dispatch_token uuid := '12500000-0000-4000-8000-0000000000d1';
	DECLARE reclaim_token uuid := '12500000-0000-4000-8000-0000000000d2';
	DECLARE original_event_id uuid;
	DECLARE gate_now timestamptz := clock_timestamp();
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('12500000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-f2@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-00000000000a','s11-f2');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('12500000-0000-4000-8000-000000000020','12500000-0000-4000-8000-00000000000a','app_ai','12500000-0000-4000-8000-000000000010','processing','s11-f2',repeat('b',64),'s11-f2-card',1,0);
		INSERT INTO public.ai_import_items(id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,front_text,back_text,card_key,image_mode,status)
		VALUES('12500000-0000-4000-8000-000000000030','12500000-0000-4000-8000-00000000000a','12500000-0000-4000-8000-000000000020','f2-r1','f2',0,'R1','reading','f2-front','f2-back',repeat('c',64),'none','committed');
		INSERT INTO public.ai_quota_reservations(owner_user_id,reservation_key,kind,source,generation_request_hash,import_request_hash,usage_date,batch_id,units,status,provider_started_at)
		VALUES('12500000-0000-4000-8000-00000000000a','s11-f2-card','card_generation','app_ai',repeat('d',64),repeat('b',64),current_date,'12500000-0000-4000-8000-000000000020',1,'reserved',now());
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"12500000-0000-4000-8000-000000000040","batchId":"12500000-0000-4000-8000-000000000020"}'::jsonb) INTO message_id;
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,queue_message_id)
		VALUES('12500000-0000-4000-8000-000000000040','12500000-0000-4000-8000-00000000000a','12500000-0000-4000-8000-000000000020','f2','queued',message_id);

		claim_a := public.claim_ai_import_concept('12500000-0000-4000-8000-000000000040',message_id,'12500000-0000-4000-8000-0000000000a1');
		UPDATE public.ai_import_concept_jobs SET claim_expires_at=clock_timestamp()-interval '1 second'
		WHERE id='12500000-0000-4000-8000-000000000040';
		claim_b := public.claim_ai_import_concept('12500000-0000-4000-8000-000000000040',message_id,'12500000-0000-4000-8000-0000000000b1');
		failed_result := public.fail_ai_import_concept('12500000-0000-4000-8000-000000000040',message_id,'12500000-0000-4000-8000-0000000000b1','PROVIDER_PERMANENT_ERROR','worker_failure');
		state_a := public.get_ai_import_failure_state('12500000-0000-4000-8000-000000000040',message_id,'12500000-0000-4000-8000-0000000000a1');
		state_b := public.get_ai_import_failure_state('12500000-0000-4000-8000-000000000040',message_id,'12500000-0000-4000-8000-0000000000b1');
		IF claim_a->>'outcome'<>'claimed' OR claim_b->>'outcome'<>'claimed' OR
			failed_result->>'status'<>'failed' OR state_a->>'outcome'<>'claim_lost' OR
			state_b->>'outcome'<>'terminal_failed' OR
			(SELECT terminal_claim_token_hash FROM public.ai_import_concept_jobs WHERE id='12500000-0000-4000-8000-000000000040')<>
			encode(extensions.digest(convert_to('12500000-0000-4000-8000-0000000000b1','UTF8'),'sha256'),'hex') THEN
			RAISE EXCEPTION 'F2 terminal failure reconciliation was not bound to claim B';
		END IF;
		IF (SELECT count(*) FROM public.ai_worker_log_outbox
			WHERE event_type='worker_failure' AND queue_message_id=message_id)<>1 THEN
			RAISE EXCEPTION 'terminal transaction did not persist exactly one outbox event';
		END IF;
		-- db-clock-outbox-malicious-time-ignored: no caller timestamp exists; fixture state controls reclaim.
		outbox_event := public.claim_ai_worker_log_outbox(dispatch_token);
		IF outbox_event->>'outcome'<>'claimed' OR outbox_event->>'event'<>'worker_failure' OR
			(outbox_event->>'queueMessageId')::bigint<>message_id OR outbox_event->>'eventId' IS NULL THEN
			RAISE EXCEPTION 'durable worker event claim contract failed';
		END IF;
		original_event_id := (outbox_event->>'eventId')::uuid;
		UPDATE public.ai_worker_log_outbox SET dispatch_claimed_at=clock_timestamp()-interval '6 minutes'
		WHERE event_id=original_event_id;
		BEGIN
			PERFORM public.complete_ai_worker_log_outbox(original_event_id,dispatch_token);
			RAISE EXCEPTION 'expired outbox completion accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		outbox_event := public.claim_ai_worker_log_outbox(reclaim_token);
		IF (outbox_event->>'eventId')::uuid IS DISTINCT FROM original_event_id THEN
			RAISE EXCEPTION 'outbox crash retry changed stable event ID';
		END IF;
		PERFORM public.complete_ai_worker_log_outbox(original_event_id,reclaim_token);
	END $gate$;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE message_id bigint; claim_a jsonb; claim_active jsonb; claim_b jsonb; result jsonb;
	DECLARE gate_now timestamptz := clock_timestamp();
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('12000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-f06@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('12000000-0000-4000-8000-000000000010','12000000-0000-4000-8000-00000000000a','s11-f06');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('12000000-0000-4000-8000-000000000020','12000000-0000-4000-8000-00000000000a','app_ai','12000000-0000-4000-8000-000000000010','processing','s11-f06',repeat('1',64),'s11-f06-card',1,0);
		INSERT INTO public.ai_import_items(id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,front_text,back_text,card_key,image_mode,status)
		VALUES('12000000-0000-4000-8000-000000000030','12000000-0000-4000-8000-00000000000a','12000000-0000-4000-8000-000000000020','f06-r1','f06',0,'R1','reading','f06-front','f06-back',repeat('2',64),'none','committed');
		INSERT INTO public.ai_quota_reservations(owner_user_id,reservation_key,kind,source,generation_request_hash,import_request_hash,usage_date,batch_id,units,status,provider_started_at)
		VALUES('12000000-0000-4000-8000-00000000000a','s11-f06-card','card_generation','app_ai',repeat('3',64),repeat('1',64),current_date,'12000000-0000-4000-8000-000000000020',1,'reserved',now());
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"12000000-0000-4000-8000-000000000040","batchId":"12000000-0000-4000-8000-000000000020"}'::jsonb) INTO message_id;
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,queue_message_id)
		VALUES('12000000-0000-4000-8000-000000000040','12000000-0000-4000-8000-00000000000a','12000000-0000-4000-8000-000000000020','f06','queued',message_id);

		claim_a := public.claim_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1');
		UPDATE public.ai_import_concept_jobs SET claim_expires_at=clock_timestamp()+interval '1 minute'
		WHERE id='12000000-0000-4000-8000-000000000040';
		claim_active := public.claim_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000b1');
		-- db-clock-concept-malicious-time-ignored / claim-expiry-side-effect-boundary:
		-- only DB-controlled expiry fixture state can cross the boundary.
		UPDATE public.ai_import_concept_jobs SET claim_expires_at=clock_timestamp()-interval '1 second'
		WHERE id='12000000-0000-4000-8000-000000000040';
		BEGIN
			PERFORM public.mark_ai_illustration_uploading('12000000-0000-4000-8000-000000000040','12000000-0000-4000-8000-0000000000a1',repeat('f',64),1,1);
			RAISE EXCEPTION 'expired upload side effect accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.mark_ai_illustration_orphan('12000000-0000-4000-8000-000000000040','12000000-0000-4000-8000-0000000000a1','STORAGE_TRANSIENT_ERROR');
			RAISE EXCEPTION 'expired orphan side effect accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.schedule_ai_import_retry('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1','PROVIDER_TRANSIENT_ERROR',5);
			RAISE EXCEPTION 'expired retry side effect accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.finalize_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1',NULL,NULL,NULL,NULL);
			RAISE EXCEPTION 'expired finalize side effect accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.fail_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1','IMAGE_DECODE_FAILED');
			RAISE EXCEPTION 'expired failure side effect accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		IF public.get_ai_import_finalize_state('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1')->>'outcome'<>'claim_lost' OR
			public.get_ai_import_failure_state('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1')->>'outcome'<>'claim_lost' THEN
			RAISE EXCEPTION 'expired reconcile still reported owned';
		END IF;
		claim_b := public.claim_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000b1');
		IF claim_a->>'outcome'<>'claimed' OR claim_active->>'outcome'<>'active' OR claim_b->>'outcome'<>'claimed' THEN
			RAISE EXCEPTION 'F-06 claim expiry/reclaim boundary failed';
		END IF;
		BEGIN
			PERFORM public.finalize_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1',NULL,NULL,NULL,NULL);
			RAISE EXCEPTION 'F-06 stale A finalize accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.fail_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1','IMAGE_DECODE_FAILED');
			RAISE EXCEPTION 'F-06 stale A fail accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		BEGIN
			PERFORM public.schedule_ai_import_retry('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000a1','PROVIDER_TRANSIENT_ERROR',5);
			RAISE EXCEPTION 'F-06 stale A retry accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		result := public.finalize_ai_import_concept('12000000-0000-4000-8000-000000000040',message_id,'12000000-0000-4000-8000-0000000000b1',NULL,NULL,NULL,NULL);
		IF result->>'status'<>'succeeded' OR
			(SELECT count(*) FROM public.cards finalized_card
				JOIN public.deck_cards finalized_deck_card ON finalized_deck_card.card_id=finalized_card.id
				WHERE finalized_card.owner_user_id='12000000-0000-4000-8000-00000000000a'
					AND finalized_deck_card.deck_id='12000000-0000-4000-8000-000000000010'
					AND finalized_card.front_text='f06-front' AND finalized_card.back_text='f06-back')<>1 OR
			(SELECT count(*) FROM public.deck_cards WHERE deck_id='12000000-0000-4000-8000-000000000010')<>1 OR
			(SELECT count(*) FROM public.ai_quota_reservations WHERE owner_user_id='12000000-0000-4000-8000-00000000000a' AND reservation_key='s11-f06-card')<>1 OR
			(SELECT count(*) FROM pgmq.q_ai_card_imports WHERE message->>'jobId'='12000000-0000-4000-8000-000000000040')<>0 THEN
			RAISE EXCEPTION 'F-06 reclaimed B side-effect fence failed';
		END IF;
	END $gate$;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE fail_message bigint; sibling_message bigint; failed_result jsonb; sibling_result jsonb; status_result jsonb;
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('13000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-f08@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name) VALUES('13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-00000000000a','s11-f08');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('13000000-0000-4000-8000-000000000020','13000000-0000-4000-8000-00000000000a','app_ai','13000000-0000-4000-8000-000000000010','processing','s11-f08',repeat('4',64),'s11-f08-card',3,0);
		INSERT INTO public.ai_import_items(id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,front_text,back_text,card_key,image_mode,status) VALUES
			('13000000-0000-4000-8000-000000000031','13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020','f08-f-r','failed-pair',0,'R1','reading','f-r','f-b',repeat('5',64),'none','committed'),
			('13000000-0000-4000-8000-000000000032','13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020','f08-f-w','failed-pair',1,'W1','writing','f-w','f-wb',repeat('6',64),'none','committed'),
			('13000000-0000-4000-8000-000000000033','13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020','f08-s-r','sibling',2,'R1','reading','s-r','s-b',repeat('7',64),'none','committed');
		INSERT INTO public.ai_quota_reservations(owner_user_id,reservation_key,kind,source,generation_request_hash,import_request_hash,usage_date,batch_id,units,status,provider_started_at)
		VALUES('13000000-0000-4000-8000-00000000000a','s11-f08-card','card_generation','app_ai',repeat('8',64),repeat('4',64),current_date,'13000000-0000-4000-8000-000000000020',3,'reserved',now());
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"13000000-0000-4000-8000-000000000041","batchId":"13000000-0000-4000-8000-000000000020"}'::jsonb) INTO fail_message;
		SELECT pgmq.send('ai_card_imports','{"version":1,"jobId":"13000000-0000-4000-8000-000000000042","batchId":"13000000-0000-4000-8000-000000000020"}'::jsonb) INTO sibling_message;
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,queue_message_id) VALUES
			('13000000-0000-4000-8000-000000000041','13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020','failed-pair','queued',fail_message),
			('13000000-0000-4000-8000-000000000042','13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020','sibling','queued',sibling_message);
		PERFORM public.claim_ai_import_concept('13000000-0000-4000-8000-000000000041',fail_message,'13000000-0000-4000-8000-000000000051');
		failed_result := public.fail_ai_import_concept('13000000-0000-4000-8000-000000000041',fail_message,'13000000-0000-4000-8000-000000000051','IMAGE_DECODE_FAILED');
		PERFORM public.claim_ai_import_concept('13000000-0000-4000-8000-000000000042',sibling_message,'13000000-0000-4000-8000-000000000052');
		sibling_result := public.finalize_ai_import_concept('13000000-0000-4000-8000-000000000042',sibling_message,'13000000-0000-4000-8000-000000000052',NULL,NULL,NULL,NULL);
		status_result := public.get_ai_import_status('13000000-0000-4000-8000-00000000000a','13000000-0000-4000-8000-000000000020',NULL);
		IF failed_result->>'status'<>'failed' OR sibling_result->>'status'<>'succeeded' OR
			(SELECT count(*) FROM public.ai_import_items WHERE batch_id='13000000-0000-4000-8000-000000000020' AND concept_id='failed-pair' AND status='failed')<>2 OR
			(SELECT count(*) FROM public.ai_import_items WHERE batch_id='13000000-0000-4000-8000-000000000020' AND concept_id='failed-pair' AND result_card_id IS NOT NULL)<>0 OR
			(SELECT count(*) FROM public.ai_import_items WHERE batch_id='13000000-0000-4000-8000-000000000020' AND concept_id='sibling' AND status='finalized')<>1 OR
			(SELECT count(*) FROM public.cards WHERE owner_user_id='13000000-0000-4000-8000-00000000000a')<>1 OR
			status_result->>'status'<>'partial' OR status_result#>>'{counts,total}'<>'3' OR status_result#>>'{counts,succeeded}'<>'1' OR status_result#>>'{counts,failed}'<>'2' THEN
			RAISE EXCEPTION 'F-08 atomic pair failure/sibling success boundary failed';
		END IF;
	END $gate$;
	ROLLBACK;
`);
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	DO $gate$
	DECLARE gate_now timestamptz := clock_timestamp();
	DECLARE claimed_exact integer; claimed_young integer; claimed_mismatch integer; claimed_referenced integer; claimed_after integer;
	DECLARE claimed_delete_pending integer; verified_delete_pending jsonb;
	DECLARE delete_pending_token uuid; previous_delete_pending_token uuid;
	BEGIN
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('14000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-f12@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name) VALUES('14000000-0000-4000-8000-000000000010','14000000-0000-4000-8000-00000000000a','s11-f12');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('14000000-0000-4000-8000-000000000020','14000000-0000-4000-8000-00000000000a','app_ai','14000000-0000-4000-8000-000000000010','processing','s11-f12',repeat('9',64),'s11-f12-card',1,1);
		INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,source_storage_path,source_storage_bucket,delete_due_at,created_at) VALUES
			('14000000-0000-4000-8000-000000000031','14000000-0000-4000-8000-00000000000a','f12-young','card_illustration','14000000-0000-4000-8000-00000000000a/f12-young','image/png',64,'cleanup_pending','14000000-0000-4000-8000-00000000000a/f12-young/source','ai-card-sources',gate_now-interval '1 second',gate_now-interval '23 hours 59 minutes 59 seconds'),
			('14000000-0000-4000-8000-000000000032','14000000-0000-4000-8000-00000000000a','f12-exact','card_illustration','14000000-0000-4000-8000-00000000000a/f12-exact','image/png',64,'cleanup_pending','14000000-0000-4000-8000-00000000000a/f12-exact/source','ai-card-sources',gate_now-interval '1 second',gate_now-interval '24 hours'),
			('14000000-0000-4000-8000-000000000033','14000000-0000-4000-8000-00000000000a','f12-mismatch','card_illustration','14000000-0000-4000-8000-00000000000a/f12-mismatch','image/png',64,'cleanup_pending','ffffffff-0000-4000-8000-00000000000f/f12-mismatch/source','ai-card-sources',gate_now-interval '1 second',gate_now-interval '25 hours');
		INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
		VALUES('14000000-0000-4000-8000-000000000041','14000000-0000-4000-8000-00000000000a','f12-referenced','ready','14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png');
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id)
		VALUES('14000000-0000-4000-8000-000000000042','14000000-0000-4000-8000-00000000000a','14000000-0000-4000-8000-000000000020','f12-reference','succeeded','14000000-0000-4000-8000-000000000041');
		INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state,delete_due_at,created_at)
		VALUES('14000000-0000-4000-8000-000000000043','14000000-0000-4000-8000-00000000000a','14000000-0000-4000-8000-000000000042','14000000-0000-4000-8000-000000000041','14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png','delete_pending',gate_now-interval '1 second',gate_now-interval '25 hours');
		INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key)
		VALUES('14000000-0000-4000-8000-000000000044','14000000-0000-4000-8000-00000000000a','private','reading','R1','f12-front','f12-back','f12-referenced',repeat('a',64));
		WITH claims AS (SELECT * FROM public.claim_ai_import_cleanup(100))
		SELECT count(*) FILTER (WHERE "trackingId"='14000000-0000-4000-8000-000000000032'),
			count(*) FILTER (WHERE "trackingId"='14000000-0000-4000-8000-000000000031'),
			count(*) FILTER (WHERE "trackingId"='14000000-0000-4000-8000-000000000033'),
			count(*) FILTER (WHERE "trackingId"='14000000-0000-4000-8000-000000000043')
		INTO claimed_exact,claimed_young,claimed_mismatch,claimed_referenced FROM claims;
		IF claimed_exact<>1 OR claimed_young<>0 OR claimed_mismatch<>0 OR claimed_referenced<>0 THEN
			RAISE EXCEPTION 'F-12 pre-24h/reference/owner-path cleanup protection failed';
		END IF;
		-- db-clock-cleanup-malicious-time-ignored: move fixture state, never caller time.
		UPDATE public.ai_uploads SET created_at=clock_timestamp()-interval '24 hours'
		WHERE id='14000000-0000-4000-8000-000000000031';
		SELECT count(*) INTO claimed_after FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='14000000-0000-4000-8000-000000000031';
		IF claimed_after<>1 THEN RAISE EXCEPTION 'F-12 exact 24-hour eligibility failed'; END IF;

		DELETE FROM public.cards WHERE id='14000000-0000-4000-8000-000000000044';
		SELECT count(*),min("claimToken"::text)::uuid INTO claimed_delete_pending,delete_pending_token
		FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='14000000-0000-4000-8000-000000000043';
		IF claimed_delete_pending<>1 THEN RAISE EXCEPTION 'delete_pending immediate claim failed'; END IF;
		verified_delete_pending := public.verify_ai_import_cleanup(
			'14000000-0000-4000-8000-000000000043','illustrations',
			'14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png',
			delete_pending_token);
		IF verified_delete_pending->>'outcome'<>'delete' THEN RAISE EXCEPTION 'delete_pending verify failed'; END IF;
		PERFORM public.complete_ai_import_cleanup(
			'14000000-0000-4000-8000-000000000043','illustrations',
			'14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png',
			delete_pending_token,'retry'
		);
		IF NOT EXISTS (
			SELECT 1 FROM public.ai_illustration_objects
			WHERE id='14000000-0000-4000-8000-000000000043'
				AND state='delete_pending' AND cleanup_previous_state IS NULL
		) THEN RAISE EXCEPTION 'delete_pending retry intent was not preserved'; END IF;
		previous_delete_pending_token := delete_pending_token;
		SELECT count(*),min("claimToken"::text)::uuid INTO claimed_delete_pending,delete_pending_token
		FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='14000000-0000-4000-8000-000000000043';
		IF claimed_delete_pending<>1 THEN RAISE EXCEPTION 'delete_pending immediate retry failed'; END IF;
		BEGIN
			PERFORM public.complete_ai_import_cleanup(
				'14000000-0000-4000-8000-000000000043','illustrations',
				'14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png',
				previous_delete_pending_token,'retry'
			);
			RAISE EXCEPTION 'stale cleanup completion accepted';
		EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END;
		PERFORM public.complete_ai_import_cleanup(
			'14000000-0000-4000-8000-000000000043','illustrations',
			'14000000-0000-4000-8000-00000000000a/s11-managed/14000000-0000-4000-8000-000000000041.png',
			delete_pending_token,'retry'
		);
		INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key)
		VALUES('14000000-0000-4000-8000-000000000044','14000000-0000-4000-8000-00000000000a','private','reading','R1','f12-front','f12-back','f12-referenced',repeat('a',64));
		SELECT count(*) INTO claimed_delete_pending
		FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='14000000-0000-4000-8000-000000000043';
		IF claimed_delete_pending<>0 THEN RAISE EXCEPTION 're-referenced delete_pending object was claimed'; END IF;
	END $gate$;
	ROLLBACK;
`);

// AC-06/S-10 compatibility: exercise the production card RPC and both lock winners.
await db.execute(`
	BEGIN;
	SET LOCAL request.jwt.claim.role='service_role';
	INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
	VALUES('17000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-shared@example.local','not-for-login',now(),'{}','{}',now(),now());
	INSERT INTO public.decks(id,owner_user_id,name)
	VALUES('17000000-0000-4000-8000-000000000010','17000000-0000-4000-8000-00000000000a','s11-shared');
	INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
	VALUES('17000000-0000-4000-8000-000000000020','17000000-0000-4000-8000-00000000000a','app_ai','17000000-0000-4000-8000-000000000010','processing','s11-shared',repeat('7',64),'s11-shared-card',3,1);
	INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
	VALUES('17000000-0000-4000-8000-000000000030','17000000-0000-4000-8000-00000000000a','s11-shared-key','ready','17000000-0000-4000-8000-00000000000a/s11-managed/17000000-0000-4000-8000-000000000030.png');
	INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id)
	VALUES('17000000-0000-4000-8000-000000000040','17000000-0000-4000-8000-00000000000a','17000000-0000-4000-8000-000000000020','shared','succeeded','17000000-0000-4000-8000-000000000030');
	INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state,created_at)
	VALUES('17000000-0000-4000-8000-000000000050','17000000-0000-4000-8000-00000000000a','17000000-0000-4000-8000-000000000040','17000000-0000-4000-8000-000000000030','17000000-0000-4000-8000-00000000000a/s11-managed/17000000-0000-4000-8000-000000000030.png','ready',clock_timestamp());
	INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key) VALUES
		('17000000-0000-4000-8000-000000000061','17000000-0000-4000-8000-00000000000a','private','reading','R1','shared-1','shared-1','s11-shared-key',repeat('1',64)),
		('17000000-0000-4000-8000-000000000062','17000000-0000-4000-8000-00000000000a','private','reading','R1','shared-2','shared-2','s11-shared-key',repeat('2',64)),
		('17000000-0000-4000-8000-000000000063','17000000-0000-4000-8000-00000000000a','private','reading','R1','shared-3','shared-3',NULL,repeat('3',64));
	-- shared-reference-two-to-one-ready
	DELETE FROM public.cards WHERE id='17000000-0000-4000-8000-000000000061';
	DO $gate$ BEGIN
		IF NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects WHERE id='17000000-0000-4000-8000-000000000050' AND state='ready') THEN
			RAISE EXCEPTION 'shared first reference removal changed lifecycle';
		END IF;
	END $gate$;
	-- shared-reference-third-s10-attach
	SET LOCAL ROLE authenticated;
	SET LOCAL request.jwt.claim.role='authenticated';
	SET LOCAL request.jwt.claim.sub='17000000-0000-4000-8000-00000000000a';
	SELECT public.set_card_illustration('17000000-0000-4000-8000-000000000063','17000000-0000-4000-8000-000000000030');
	RESET ROLE;
	SET LOCAL request.jwt.claim.role='service_role';
	DELETE FROM public.cards WHERE id='17000000-0000-4000-8000-000000000062';
	SET LOCAL ROLE authenticated;
	SET LOCAL request.jwt.claim.role='authenticated';
	SET LOCAL request.jwt.claim.sub='17000000-0000-4000-8000-00000000000a';
	SELECT public.set_card_illustration('17000000-0000-4000-8000-000000000063',NULL);
	RESET ROLE;
	SET LOCAL request.jwt.claim.role='service_role';
	-- last-reference-delete-pending
	DO $gate$ BEGIN
		IF NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects WHERE id='17000000-0000-4000-8000-000000000050' AND state='delete_pending') THEN
			RAISE EXCEPTION 'last reference removal did not create delete_pending';
		END IF;
	END $gate$;
	COMMIT;
`);

const attachWins = createS11DbClient(databaseUrl);
const cleanupSkipsLocked = createS11DbClient(databaseUrl);
await Promise.all([
	attachWins.execute(`
		BEGIN;
		SET LOCAL ROLE authenticated;
		SET LOCAL request.jwt.claim.role='authenticated';
		SET LOCAL request.jwt.claim.sub='17000000-0000-4000-8000-00000000000a';
		SELECT public.set_card_illustration('17000000-0000-4000-8000-000000000063','17000000-0000-4000-8000-000000000030');
		SELECT pg_sleep(1);
		COMMIT;
	`),
	cleanupSkipsLocked.execute(`
		BEGIN;
		SET LOCAL request.jwt.claim.role='service_role';
		SELECT pg_sleep(0.2);
		DO $gate$ BEGIN
			IF EXISTS (SELECT 1 FROM public.claim_ai_import_cleanup(100) WHERE "trackingId"='17000000-0000-4000-8000-000000000050') THEN
				RAISE EXCEPTION 'cleanup stole lifecycle lock from pending re-reference';
			END IF;
		END $gate$;
		COMMIT;
	`),
]);

await db.execute(`
	BEGIN;
	SET LOCAL ROLE authenticated;
	SET LOCAL request.jwt.claim.role='authenticated';
	SET LOCAL request.jwt.claim.sub='17000000-0000-4000-8000-00000000000a';
	SELECT public.set_card_illustration('17000000-0000-4000-8000-000000000063',NULL);
	COMMIT;
`);
const cleanupWins = createS11DbClient(databaseUrl);
const attachIsFenced = createS11DbClient(databaseUrl);
const [, attachDiagnostic] = await Promise.all([
	cleanupWins.execute(`
		BEGIN;
		SET LOCAL request.jwt.claim.role='service_role';
		CREATE TEMP TABLE s11_shared_cleanup_claim ON COMMIT DROP AS
		SELECT * FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='17000000-0000-4000-8000-000000000050';
		DO $gate$ BEGIN
			IF (SELECT count(*) FROM s11_shared_cleanup_claim)<>1 THEN
				RAISE EXCEPTION 'cleanup did not win pending lifecycle lock';
			END IF;
		END $gate$;
		SELECT pg_sleep(1);
		COMMIT;
	`),
	attachIsFenced.settle(`
		SELECT pg_sleep(0.2);
		SELECT public.set_card_illustration('17000000-0000-4000-8000-000000000063','17000000-0000-4000-8000-000000000030');
	`, { actor: { kind: "ownerA", role: "authenticated", userId: "17000000-0000-4000-8000-00000000000a" } }),
]);
if (attachDiagnostic?.sqlState !== "P1008") throw new Error("pending-rereference-cleanup-fenced boundary failed");
await db.execute(`
	-- pending-rereference-cleanup-fenced
	DELETE FROM public.cards WHERE id='17000000-0000-4000-8000-000000000063';
	DELETE FROM public.ai_illustration_objects WHERE id='17000000-0000-4000-8000-000000000050';
	DELETE FROM public.ai_import_concept_jobs WHERE id='17000000-0000-4000-8000-000000000040';
	DELETE FROM public.illustrations WHERE id='17000000-0000-4000-8000-000000000030';
	DELETE FROM public.ai_import_batches WHERE id='17000000-0000-4000-8000-000000000020';
	DELETE FROM public.decks WHERE id='17000000-0000-4000-8000-000000000010';
	DELETE FROM auth.users WHERE id='17000000-0000-4000-8000-00000000000a';
`);

await db.execute(`
	INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
	VALUES('18000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-delete-delete@example.local','not-for-login',now(),'{}','{}',now(),now());
	INSERT INTO public.decks(id,owner_user_id,name) VALUES('18000000-0000-4000-8000-000000000010','18000000-0000-4000-8000-00000000000a','delete-delete');
	INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
	VALUES('18000000-0000-4000-8000-000000000020','18000000-0000-4000-8000-00000000000a','app_ai','18000000-0000-4000-8000-000000000010','processing','delete-delete',repeat('8',64),'delete-delete-card',2,1);
	INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
	VALUES('18000000-0000-4000-8000-000000000030','18000000-0000-4000-8000-00000000000a','delete-delete-key','ready','18000000-0000-4000-8000-00000000000a/s11-managed/18000000-0000-4000-8000-000000000030.png');
	INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id)
	VALUES('18000000-0000-4000-8000-000000000040','18000000-0000-4000-8000-00000000000a','18000000-0000-4000-8000-000000000020','delete-delete','succeeded','18000000-0000-4000-8000-000000000030');
	INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state)
	VALUES('18000000-0000-4000-8000-000000000050','18000000-0000-4000-8000-00000000000a','18000000-0000-4000-8000-000000000040','18000000-0000-4000-8000-000000000030','18000000-0000-4000-8000-00000000000a/s11-managed/18000000-0000-4000-8000-000000000030.png','ready');
	INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key) VALUES
		('18000000-0000-4000-8000-000000000061','18000000-0000-4000-8000-00000000000a','private','reading','R1','dd-1','dd-1','delete-delete-key',repeat('4',64)),
		('18000000-0000-4000-8000-000000000062','18000000-0000-4000-8000-00000000000a','private','reading','R1','dd-2','dd-2','delete-delete-key',repeat('5',64));
`);
const deleteDeleteActor = { kind: "ownerA", role: "authenticated", userId: "18000000-0000-4000-8000-00000000000a" } as const;
const deleteDeleteDiagnostics = await Promise.all([
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT 1 FROM public.cards WHERE id='18000000-0000-4000-8000-000000000061' FOR UPDATE;
		SELECT pg_sleep(0.25);
		DELETE FROM public.cards WHERE id='18000000-0000-4000-8000-000000000061';
	`, { actor: deleteDeleteActor }),
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT 1 FROM public.cards WHERE id='18000000-0000-4000-8000-000000000062' FOR UPDATE;
		SELECT pg_sleep(0.25);
		SELECT public.delete_private_card(
			'18000000-0000-4000-8000-000000000062',
			(SELECT updated_at FROM public.cards WHERE id='18000000-0000-4000-8000-000000000062')
		);
	`, { actor: deleteDeleteActor }),
]);
if (deleteDeleteDiagnostics.some((diagnostic) => diagnostic !== null)) throw new Error("shared-delete-delete-no-deadlock boundary failed");
await db.execute(`
	-- shared-delete-delete-no-deadlock; shared-lock-timeout-bounded
	DO $gate$ BEGIN
		IF EXISTS (SELECT 1 FROM public.cards WHERE owner_user_id='18000000-0000-4000-8000-00000000000a') OR
			NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects WHERE id='18000000-0000-4000-8000-000000000050' AND reference_count=0 AND state='delete_pending') THEN
			RAISE EXCEPTION 'delete/delete final lifecycle mismatch';
		END IF;
	END $gate$;
	DELETE FROM public.ai_illustration_objects WHERE id='18000000-0000-4000-8000-000000000050';
	DELETE FROM public.ai_import_concept_jobs WHERE id='18000000-0000-4000-8000-000000000040';
	DELETE FROM public.illustrations WHERE id='18000000-0000-4000-8000-000000000030';
	DELETE FROM public.ai_import_batches WHERE id='18000000-0000-4000-8000-000000000020';
	DELETE FROM public.decks WHERE id='18000000-0000-4000-8000-000000000010';
	DELETE FROM auth.users WHERE id='18000000-0000-4000-8000-00000000000a';
`);

await db.execute(`
	INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
	VALUES('18100000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-delete-attach@example.local','not-for-login',now(),'{}','{}',now(),now());
	INSERT INTO public.decks(id,owner_user_id,name) VALUES('18100000-0000-4000-8000-000000000010','18100000-0000-4000-8000-00000000000a','delete-attach');
	INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
	VALUES('18100000-0000-4000-8000-000000000020','18100000-0000-4000-8000-00000000000a','app_ai','18100000-0000-4000-8000-000000000010','processing','delete-attach',repeat('9',64),'delete-attach-card',2,2);
	INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES
		('18100000-0000-4000-8000-000000000030','18100000-0000-4000-8000-00000000000a','delete-attach-old','ready','18100000-0000-4000-8000-00000000000a/s11-managed/18100000-0000-4000-8000-000000000030.png'),
		('18100000-0000-4000-8000-000000000031','18100000-0000-4000-8000-00000000000a','delete-attach-new','ready','18100000-0000-4000-8000-00000000000a/s11-managed/18100000-0000-4000-8000-000000000031.png');
	INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id) VALUES
		('18100000-0000-4000-8000-000000000040','18100000-0000-4000-8000-00000000000a','18100000-0000-4000-8000-000000000020','delete-attach-old','succeeded','18100000-0000-4000-8000-000000000030'),
		('18100000-0000-4000-8000-000000000041','18100000-0000-4000-8000-00000000000a','18100000-0000-4000-8000-000000000020','delete-attach-new','succeeded','18100000-0000-4000-8000-000000000031');
	INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state) VALUES
		('18100000-0000-4000-8000-000000000050','18100000-0000-4000-8000-00000000000a','18100000-0000-4000-8000-000000000040','18100000-0000-4000-8000-000000000030','18100000-0000-4000-8000-00000000000a/s11-managed/18100000-0000-4000-8000-000000000030.png','ready'),
		('18100000-0000-4000-8000-000000000051','18100000-0000-4000-8000-00000000000a','18100000-0000-4000-8000-000000000041','18100000-0000-4000-8000-000000000031','18100000-0000-4000-8000-00000000000a/s11-managed/18100000-0000-4000-8000-000000000031.png','ready');
	INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key) VALUES
		('18100000-0000-4000-8000-000000000061','18100000-0000-4000-8000-00000000000a','private','reading','R1','da-1','da-1','delete-attach-old',repeat('6',64)),
		('18100000-0000-4000-8000-000000000062','18100000-0000-4000-8000-00000000000a','private','reading','R1','da-2','da-2','delete-attach-old',repeat('7',64));
`);
const deleteAttachActor = { kind: "ownerA", role: "authenticated", userId: "18100000-0000-4000-8000-00000000000a" } as const;
const deleteAttachDiagnostics = await Promise.all([
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT 1 FROM public.cards WHERE id='18100000-0000-4000-8000-000000000061' FOR UPDATE;
		SELECT pg_sleep(0.25);
		DELETE FROM public.cards WHERE id='18100000-0000-4000-8000-000000000061';
	`, { actor: deleteAttachActor }),
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT 1 FROM public.cards WHERE id='18100000-0000-4000-8000-000000000062' FOR UPDATE;
		SELECT pg_sleep(0.25);
		SELECT public.set_card_illustration('18100000-0000-4000-8000-000000000062','18100000-0000-4000-8000-000000000031');
	`, { actor: deleteAttachActor }),
]);
if (deleteAttachDiagnostics.some((diagnostic) => diagnostic !== null)) throw new Error("shared-delete-attach-no-deadlock boundary failed");
await db.execute(`
	-- shared-delete-attach-no-deadlock
	DO $gate$ BEGIN
		IF EXISTS (SELECT 1 FROM public.cards WHERE id='18100000-0000-4000-8000-000000000061') OR
			NOT EXISTS (SELECT 1 FROM public.cards WHERE id='18100000-0000-4000-8000-000000000062' AND illustration_key='delete-attach-new') OR
			NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects WHERE id='18100000-0000-4000-8000-000000000050' AND reference_count=0 AND state='delete_pending') OR
			NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects WHERE id='18100000-0000-4000-8000-000000000051' AND reference_count=1 AND state='ready') THEN
			RAISE EXCEPTION 'delete/attach final lifecycle mismatch';
		END IF;
	END $gate$;
	DELETE FROM public.cards WHERE id='18100000-0000-4000-8000-000000000062';
	DELETE FROM public.ai_illustration_objects WHERE owner_user_id='18100000-0000-4000-8000-00000000000a';
	DELETE FROM public.ai_import_concept_jobs WHERE owner_user_id='18100000-0000-4000-8000-00000000000a';
	DELETE FROM public.illustrations WHERE owner_user_id='18100000-0000-4000-8000-00000000000a';
	DELETE FROM public.ai_import_batches WHERE id='18100000-0000-4000-8000-000000000020';
	DELETE FROM public.decks WHERE id='18100000-0000-4000-8000-000000000010';
	DELETE FROM auth.users WHERE id='18100000-0000-4000-8000-00000000000a';
`);

await db.execute(`
	DROP TRIGGER IF EXISTS aa_s11_cross_swap_barrier ON public.cards;
	DROP FUNCTION IF EXISTS public.s11_test_cross_swap_barrier();
	CREATE FUNCTION public.s11_test_cross_swap_barrier()
	RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $gate$
	BEGIN
		IF current_setting('app.s11_cross_swap_gate',true)='on' THEN
			PERFORM pg_sleep(0.25);
		END IF;
		RETURN NEW;
	END;
	$gate$;
	CREATE TRIGGER aa_s11_cross_swap_barrier
	BEFORE UPDATE OF illustration_key ON public.cards
	FOR EACH ROW EXECUTE FUNCTION public.s11_test_cross_swap_barrier();
`);

async function seedCrossSwapFixture(prefix: "184" | "185"): Promise<{
	readonly ownerId: string;
	readonly cardAId: string;
	readonly cardBId: string;
	readonly illustrationAId: string;
	readonly illustrationBId: string;
	readonly trackingAId: string;
	readonly trackingBId: string;
}> {
	const ownerId = `${prefix}00000-0000-4000-8000-00000000000a`;
	const deckId = `${prefix}00000-0000-4000-8000-000000000010`;
	const batchId = `${prefix}00000-0000-4000-8000-000000000020`;
	const illustrationAId = `${prefix}00000-0000-4000-8000-000000000030`;
	const illustrationBId = `${prefix}00000-0000-4000-8000-000000000031`;
	const jobAId = `${prefix}00000-0000-4000-8000-000000000040`;
	const jobBId = `${prefix}00000-0000-4000-8000-000000000041`;
	const trackingAId = `${prefix}00000-0000-4000-8000-000000000050`;
	const trackingBId = `${prefix}00000-0000-4000-8000-000000000051`;
	const cardAId = `${prefix}00000-0000-4000-8000-000000000060`;
	const cardBId = `${prefix}00000-0000-4000-8000-000000000061`;
	await db.execute(`
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('${ownerId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-cross-swap-${prefix}@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deckId}','${ownerId}','cross-swap-${prefix}');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('${batchId}','${ownerId}','app_ai','${deckId}','processing','cross-swap-${prefix}',repeat('c',64),'cross-swap-card-${prefix}',2,2);
		INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES
			('${illustrationAId}','${ownerId}','cross-swap-${prefix}-a','ready','${ownerId}/s11-managed/${illustrationAId}.png'),
			('${illustrationBId}','${ownerId}','cross-swap-${prefix}-b','ready','${ownerId}/s11-managed/${illustrationBId}.png');
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id) VALUES
			('${jobAId}','${ownerId}','${batchId}','cross-swap-${prefix}-a','succeeded','${illustrationAId}'),
			('${jobBId}','${ownerId}','${batchId}','cross-swap-${prefix}-b','succeeded','${illustrationBId}');
		INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state) VALUES
			('${trackingAId}','${ownerId}','${jobAId}','${illustrationAId}','${ownerId}/s11-managed/${illustrationAId}.png','ready'),
			('${trackingBId}','${ownerId}','${jobBId}','${illustrationBId}','${ownerId}/s11-managed/${illustrationBId}.png','ready');
		INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,illustration_key,card_key) VALUES
			('${cardAId}','${ownerId}','private','reading','R1','cross-a','cross-a','cross-swap-${prefix}-a',repeat('${prefix === "184" ? "a" : "c"}',64)),
			('${cardBId}','${ownerId}','private','reading','R1','cross-b','cross-b','cross-swap-${prefix}-b',repeat('${prefix === "184" ? "b" : "d"}',64));
	`);
	return { ownerId,cardAId,cardBId,illustrationAId,illustrationBId,trackingAId,trackingBId };
}

async function runCrossSwap(
	fixture: Awaited<ReturnType<typeof seedCrossSwapFixture>>,
	first: "a" | "b"
): Promise<void> {
	const actor = { kind: "ownerA",role: "authenticated",userId: fixture.ownerId } as const;
	const [aDiagnostic,bDiagnostic] = await Promise.all([
		createS11DbClient(databaseUrl).settle(`
			SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
			SELECT 1 FROM public.cards WHERE id='${fixture.cardAId}' FOR UPDATE;
			SELECT pg_sleep(${first === "a" ? "0" : "0.05"});
			SET LOCAL app.s11_cross_swap_gate='on';
			SELECT public.set_card_illustration('${fixture.cardAId}','${fixture.illustrationBId}');
		`, { actor }),
		createS11DbClient(databaseUrl).settle(`
			SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
			SELECT 1 FROM public.cards WHERE id='${fixture.cardBId}' FOR UPDATE;
			SELECT pg_sleep(${first === "b" ? "0" : "0.05"});
			SET LOCAL app.s11_cross_swap_gate='on';
			SELECT public.set_card_illustration('${fixture.cardBId}','${fixture.illustrationAId}');
		`, { actor }),
	]);
	if (aDiagnostic?.sqlState === "40P01" || bDiagnostic?.sqlState === "40P01") {
		throw new Error(`cross-swap-${first}-first-no-40p01 deadlocked`);
	}
	if (aDiagnostic !== null || bDiagnostic !== null) {
		throw new Error(`cross-swap-${first}-first-no-40p01 boundary failed`);
	}
	const rows = await db.query<{
		card_a_key: string;
		card_b_key: string;
		ref_a: number;
		ref_b: number;
		state_a: string;
		state_b: string;
	}>(`
		SELECT card_a.illustration_key AS card_a_key,card_b.illustration_key AS card_b_key,
			object_a.reference_count AS ref_a,object_b.reference_count AS ref_b,
			object_a.state AS state_a,object_b.state AS state_b
		FROM public.cards card_a CROSS JOIN public.cards card_b
		CROSS JOIN public.ai_illustration_objects object_a
		CROSS JOIN public.ai_illustration_objects object_b
		WHERE card_a.id='${fixture.cardAId}' AND card_b.id='${fixture.cardBId}'
			AND object_a.id='${fixture.trackingAId}' AND object_b.id='${fixture.trackingBId}'
	`);
	const row = rows[0];
	if (!row || row.card_a_key!==`cross-swap-${fixture.ownerId.slice(0,3)}-b` ||
		row.card_b_key!==`cross-swap-${fixture.ownerId.slice(0,3)}-a` ||
		Number(row.ref_a)!==1 || Number(row.ref_b)!==1 ||
		row.state_a!=="ready" || row.state_b!=="ready") {
		throw new Error("cross-swap-serializable-outcome mismatch");
	}
}

const crossSwapAFirst = await seedCrossSwapFixture("184");
await runCrossSwap(crossSwapAFirst,"a");
const crossSwapBFirst = await seedCrossSwapFixture("185");
await runCrossSwap(crossSwapBFirst,"b");
await db.execute(`
	-- cross-swap-a-first-no-40p01; cross-swap-b-first-no-40p01;
	-- cross-swap-serializable-outcome
	DROP TRIGGER aa_s11_cross_swap_barrier ON public.cards;
	DROP FUNCTION public.s11_test_cross_swap_barrier();
	DELETE FROM public.cards WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM public.ai_illustration_objects WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM public.ai_import_concept_jobs WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM public.illustrations WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM public.ai_import_batches WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM public.decks WHERE owner_user_id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
	DELETE FROM auth.users WHERE id IN ('${crossSwapAFirst.ownerId}','${crossSwapBFirst.ownerId}');
`);

async function seedCompleteAttachFixture(prefix: "182" | "183"): Promise<{
	readonly ownerId: string;
	readonly cardId: string;
	readonly illustrationId: string;
	readonly trackingId: string;
	readonly path: string;
	readonly claimToken: string;
}> {
	const ownerId = `${prefix}00000-0000-4000-8000-00000000000a`;
	const deckId = `${prefix}00000-0000-4000-8000-000000000010`;
	const batchId = `${prefix}00000-0000-4000-8000-000000000020`;
	const illustrationId = `${prefix}00000-0000-4000-8000-000000000030`;
	const jobId = `${prefix}00000-0000-4000-8000-000000000040`;
	const trackingId = `${prefix}00000-0000-4000-8000-000000000050`;
	const cardId = `${prefix}00000-0000-4000-8000-000000000060`;
	const path = `${ownerId}/s11-managed/${illustrationId}.png`;
	await db.execute(`
		INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		VALUES('${ownerId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-complete-attach-${prefix}@example.local','not-for-login',now(),'{}','{}',now(),now());
		INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deckId}','${ownerId}','complete-attach-${prefix}');
		INSERT INTO public.ai_import_batches(id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,card_reservation_key,requested_card_count,requested_image_count)
		VALUES('${batchId}','${ownerId}','app_ai','${deckId}','processing','complete-attach-${prefix}',repeat('a',64),'complete-attach-card-${prefix}',1,1);
		INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
		VALUES('${illustrationId}','${ownerId}','complete-attach-key-${prefix}','ready','${path}');
		INSERT INTO public.ai_import_concept_jobs(id,owner_user_id,batch_id,concept_id,state,illustration_id)
		VALUES('${jobId}','${ownerId}','${batchId}','complete-attach-${prefix}','succeeded','${illustrationId}');
		INSERT INTO public.ai_illustration_objects(id,owner_user_id,job_id,illustration_id,storage_path,state,delete_due_at,created_at)
		VALUES('${trackingId}','${ownerId}','${jobId}','${illustrationId}','${path}','delete_pending',clock_timestamp()-interval '1 second',clock_timestamp()-interval '25 hours');
		INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key)
		VALUES('${cardId}','${ownerId}','private','reading','R1','complete-attach-${prefix}','complete-attach-${prefix}',repeat('${prefix === "182" ? "1" : "2"}',64));
	`);
	const claimRows = await db.query<{ claim_token: string }>(`
		SELECT "claimToken"::text AS claim_token FROM public.claim_ai_import_cleanup(100)
		WHERE "trackingId"='${trackingId}'
	`, { actor: { kind: "service", role: "service_role", userId: null } });
	const claimToken = claimRows[0]?.claim_token;
	if (claimToken === undefined) throw new Error(`complete/attach ${prefix} cleanup claim missing`);
	return { ownerId, cardId, illustrationId, trackingId, path, claimToken };
}

async function assertCompleteAttachWinner(fixture: Awaited<ReturnType<typeof seedCompleteAttachFixture>>): Promise<void> {
	const rows = await db.query<{ card_key: string | null; state: string; reference_count: number; illustration_status: string; storage_path: string | null }>(`
		SELECT cards.illustration_key AS card_key,objects.state,objects.reference_count,
			illustrations.status AS illustration_status,illustrations.storage_path
		FROM public.cards cards
		CROSS JOIN public.ai_illustration_objects objects
		JOIN public.illustrations illustrations ON illustrations.id=objects.illustration_id
		WHERE cards.id='${fixture.cardId}' AND objects.id='${fixture.trackingId}'
	`);
	const row = rows[0];
	if (!row || row.card_key !== null || row.state !== "deleted" || Number(row.reference_count) !== 0 ||
		row.illustration_status !== "failed" || row.storage_path !== null) {
		throw new Error("complete-attach-serializable-winner final lifecycle mismatch");
	}
}

const attachFirst = await seedCompleteAttachFixture("182");
const [attachFirstDiagnostic, attachFirstCompleteDiagnostic] = await Promise.all([
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT 1 FROM public.illustrations WHERE id='${attachFirst.illustrationId}' FOR UPDATE;
		SELECT pg_sleep(0.25);
		SELECT public.set_card_illustration('${attachFirst.cardId}','${attachFirst.illustrationId}');
	`, { actor: { kind: "ownerA", role: "authenticated", userId: attachFirst.ownerId } }),
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT pg_sleep(0.1);
		SELECT public.complete_ai_import_cleanup(
			'${attachFirst.trackingId}','illustrations','${attachFirst.path}',
			'${attachFirst.claimToken}','deleted'
		);
	`, { actor: { kind: "service", role: "service_role", userId: null } }),
]);
if (attachFirstDiagnostic?.sqlState === "40P01" || attachFirstCompleteDiagnostic?.sqlState === "40P01") {
	throw new Error("complete-attach-attach-first-no-40p01 deadlocked");
}
if (attachFirstDiagnostic?.sqlState !== "P1008" || attachFirstCompleteDiagnostic !== null ||
	[attachFirstDiagnostic, attachFirstCompleteDiagnostic].filter((value) => value === null).length !== 1) {
	throw new Error("complete-attach-attach-first-no-40p01 winner mismatch");
}
await assertCompleteAttachWinner(attachFirst);

const completeFirst = await seedCompleteAttachFixture("183");
const [completeFirstCompleteDiagnostic, completeFirstAttachDiagnostic] = await Promise.all([
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT public.complete_ai_import_cleanup(
			'${completeFirst.trackingId}','illustrations','${completeFirst.path}',
			'${completeFirst.claimToken}','deleted'
		);
		SELECT pg_sleep(0.25);
	`, { actor: { kind: "service", role: "service_role", userId: null } }),
	createS11DbClient(databaseUrl).settle(`
		SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s';
		SELECT pg_sleep(0.1);
		SELECT public.set_card_illustration('${completeFirst.cardId}','${completeFirst.illustrationId}');
	`, { actor: { kind: "ownerA", role: "authenticated", userId: completeFirst.ownerId } }),
]);
if (completeFirstCompleteDiagnostic?.sqlState === "40P01" || completeFirstAttachDiagnostic?.sqlState === "40P01") {
	throw new Error("complete-attach-complete-first-no-40p01 deadlocked");
}
if (completeFirstCompleteDiagnostic !== null ||
	!(["P1003", "P1008"] as const).some((state) => state === completeFirstAttachDiagnostic?.sqlState) ||
	[completeFirstCompleteDiagnostic, completeFirstAttachDiagnostic].filter((value) => value === null).length !== 1) {
	throw new Error("complete-attach-complete-first-no-40p01 winner mismatch");
}
await assertCompleteAttachWinner(completeFirst);

await db.execute(`
	-- complete-attach-attach-first-no-40p01; complete-attach-complete-first-no-40p01;
	-- complete-attach-serializable-winner
	DELETE FROM public.cards WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM public.ai_illustration_objects WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM public.ai_import_concept_jobs WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM public.illustrations WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM public.ai_import_batches WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM public.decks WHERE owner_user_id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
	DELETE FROM auth.users WHERE id IN ('${attachFirst.ownerId}','${completeFirst.ownerId}');
`);

process.stdout.write(`${JSON.stringify({ gate: "s11-real-integration", status: "passed", boundaries: ["postgres", "pgmq", "rpc-acl", "private-bucket-limit", "durable-worker-log-outbox", "db-clock-concept-malicious-time-ignored", "db-clock-cleanup-malicious-time-ignored", "db-clock-outbox-malicious-time-ignored", "cleanup-stale-reclaim", "source-and-raw-first-run", "source-write-intent-ambiguous-cleanup", "cleanup-entity-limit-pair-expansion", "cleanup-complete-expiry-fence", "service-cleanup-lifecycle", "owner-rest-resurrection-rejected", "deleted-attach-rejected", "nondeleted-owner-update-allowed", "deleted-illustration-reattach-rejected", "shared-reference-two-to-one-ready", "shared-reference-third-s10-attach", "last-reference-delete-pending", "pending-rereference-cleanup-fenced", "shared-delete-delete-no-deadlock", "shared-delete-attach-no-deadlock", "shared-lock-timeout-bounded", "cross-swap-a-first-no-40p01", "cross-swap-b-first-no-40p01", "cross-swap-serializable-outcome", "complete-attach-attach-first-no-40p01", "complete-attach-complete-first-no-40p01", "complete-attach-serializable-winner", "shared-upload-release", "claim-expiry-fencing", "claim-expiry-side-effect-boundary", "claim-bound-terminal-failure-reconciliation", "pair-failure-sibling-success", "cleanup-exact-24h-reference-owner", "cleanup-delete-pending-immediate-retry-reference-recheck"] })}\n`);
