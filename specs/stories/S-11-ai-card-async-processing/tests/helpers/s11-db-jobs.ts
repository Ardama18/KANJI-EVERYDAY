import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	createS10DbClient,
	runS10Psql,
	runS10PsqlAutocommitScript,
	runS10PsqlFile,
} from "../../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";
import { requireDistinctS11DatabaseUrls } from "./s11-db-testkit";

export type S11DatabaseJob = "fresh" | "upgrade" | "failure";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const CORE_MIGRATION = path.join(
	ROOT,
	"supabase/migrations/20260715000000_s11_ai_card_async_processing.sql"
);
const SCHEDULE_MIGRATION = path.join(
	ROOT,
	"supabase/migrations/20260715000001_s11_ai_card_async_schedule_controls.sql"
);
const VALIDATE_MIGRATION = path.join(
	ROOT,
	"supabase/migrations/20260715000002_s11_ai_card_async_validate.sql"
);
const OWNER_SAFE_SELECT_MIGRATION = path.join(
	ROOT,
	"supabase/migrations/20260716000000_s11_owner_safe_select.sql"
);
const STORAGE_POLICY_HELPER_MIGRATION = path.join(
	ROOT,
	"supabase/migrations/20260716000001_s11_storage_policy_helper.sql"
);
const UPGRADE_FIXTURE = path.join(
	ROOT,
	"specs/stories/S-11-ai-card-async-processing/tests/fixtures/pre-s11-seed.sql"
);

export function selectS11DatabaseJob(
	job: S11DatabaseJob,
	environment: Readonly<Record<string, string | undefined>> = process.env
): string {
	const urls = requireDistinctS11DatabaseUrls(environment);
	return urls[{ fresh: 0, upgrade: 1, failure: 2 }[job]] ?? "";
}

export async function runS11DatabaseJob(
	job: S11DatabaseJob,
	environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
	const databaseUrl = selectS11DatabaseJob(job, environment);
	await assertS10Base(databaseUrl);
	if (job === "failure") {
		const migration = await readFile(CORE_MIGRATION, "utf8");
		await runS10Psql(
			databaseUrl,
			`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
			CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(
				version text PRIMARY KEY
			)`
		);
		const baselineNonServiceAcl = (
			await runS10Psql(databaseUrl, NON_SERVICE_SECURITY_DEFINER_ACL_SQL)
		).trim();
		for (const failpoint of [
			"before_constraint_swap",
			"after_expand_tables",
			"after_runtime_functions",
			"before_core_commit",
		] as const) {
			let failed = false;
			try {
				await runS10PsqlAutocommitScript(
					databaseUrl,
					`SET app.s11_failpoint='${failpoint}';\n${migration}`
				);
			} catch {
				failed = true;
			}
			if (!failed) throw new Error(`S-11 ${failpoint} injection unexpectedly completed`);
			await assertAutocommitFailureState(databaseUrl, failpoint, baselineNonServiceAcl);
			if (failpoint === "before_constraint_swap") {
				let atomicSwapFailed = false;
				try {
					await runS10PsqlAutocommitScript(
						databaseUrl,
						`ALTER TABLE public.ai_uploads
							DROP CONSTRAINT ai_uploads_status_check,
							ADD CONSTRAINT ai_uploads_s11_status_check CHECK (true) NOT VALID,
							ADD CONSTRAINT ai_uploads_s11_status_check CHECK (true) NOT VALID;`
					);
				} catch {
					atomicSwapFailed = true;
				}
				if (!atomicSwapFailed) throw new Error("S-11 atomic_swap_error injection completed");
				await assertAutocommitFailureState(databaseUrl, failpoint, baselineNonServiceAcl);
			}
		}
		await runS10PsqlAutocommitScript(databaseUrl, migration);
		await runS10PsqlFile(databaseUrl, OWNER_SAFE_SELECT_MIGRATION);
		await assertStoragePolicyForwardRecovery(databaseUrl);
		await runS10PsqlFile(databaseUrl, STORAGE_POLICY_HELPER_MIGRATION);
		await runS10PsqlFile(databaseUrl, STORAGE_POLICY_HELPER_MIGRATION);
		await backfillAndValidate(databaseUrl);
		await runS10Psql(
			databaseUrl,
			"INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20260715000000')"
		);
		await assertS11Contracts(databaseUrl, "fresh", false);
		const ledger = await runS10Psql(
			databaseUrl,
			"SELECT (count(*)=1)::text FROM supabase_migrations.schema_migrations WHERE version='20260715000000'"
		);
		if (!ledger.includes("true")) throw new Error("S-11 recovery ledger is inconsistent");
		return;
	}
	if (job === "upgrade") await runS10PsqlFile(databaseUrl, UPGRADE_FIXTURE);
	await runS10PsqlFile(databaseUrl, CORE_MIGRATION);
	await runS10PsqlFile(databaseUrl, OWNER_SAFE_SELECT_MIGRATION);
	if (job === "upgrade") await assertStoragePolicyForwardRecovery(databaseUrl);
	await runS10PsqlFile(databaseUrl, STORAGE_POLICY_HELPER_MIGRATION);
	await runS10PsqlFile(databaseUrl, STORAGE_POLICY_HELPER_MIGRATION);
	const coreOnly = environment.S11_LOCAL_CORE_ONLY === "1";
	if (!coreOnly) await runS10PsqlFile(databaseUrl, SCHEDULE_MIGRATION);
	await backfillAndValidate(databaseUrl);
	await assertS11Contracts(databaseUrl, job, !coreOnly);
}

async function assertAutocommitFailureState(
	databaseUrl: string,
	failpoint:
		| "before_constraint_swap"
		| "after_expand_tables"
		| "after_runtime_functions"
		| "before_core_commit",
	baselineNonServiceAcl: string
): Promise<void> {
	const expectsExpand = failpoint !== "before_constraint_swap";
	const expectsRuntime = ["after_runtime_functions", "before_core_commit"].includes(failpoint);
	const expectsFinalGrants = failpoint === "before_core_commit";
	const helperContract = expectsExpand
		? `to_regprocedure('public.ai_s11_storage_object_is_managed(text,text)') IS NOT NULL
			AND has_function_privilege('authenticated','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')
			AND NOT has_function_privilege('anon','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')
			AND NOT has_function_privilege('service_role','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')`
		: `to_regprocedure('public.ai_s11_storage_object_is_managed(text,text)') IS NULL`;
	const constraintState = expectsExpand
		? `EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_uploads'::regclass
			AND conname='ai_uploads_s11_status_check' AND NOT convalidated)
			AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_uploads'::regclass
				AND conname IN ('ai_uploads_status_check','ai_uploads_status_time_check'))`
		: `(SELECT count(*)=2 FROM pg_constraint WHERE conrelid='public.ai_uploads'::regclass
			AND conname IN ('ai_uploads_status_check','ai_uploads_status_time_check'))
			AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_uploads'::regclass
				AND conname='ai_uploads_s11_status_check')`;
	const result = await runS10Psql(
		databaseUrl,
		`SELECT (
			NOT EXISTS (
				SELECT 1 FROM supabase_migrations.schema_migrations
				WHERE version='20260715000000'
			) AND (to_regclass('public.ai_import_concept_jobs') IS NOT NULL) = ${expectsExpand}
			AND (${constraintState})
			AND (EXISTS (SELECT 1 FROM pg_policy
				WHERE polname='ai_import_concept_jobs_select_owner')) = ${expectsExpand}
			AND (${expectsExpand ? "NOT has_table_privilege('authenticated','public.ai_import_concept_jobs','INSERT')" : "true"})
			AND NOT has_column_privilege('authenticated','public.ai_uploads','cleanup_claim_token','SELECT')
			AND (${expectsExpand ? "NOT has_column_privilege('authenticated','public.ai_import_concept_jobs','claim_token','SELECT')" : "true"})
			AND (${helperContract})
			AND ((SELECT count(*) FROM pg_trigger
				WHERE tgname IN ('ai_s11_sync_upload_compat','ai_s11_track_card_reference_removal',
					'ai_s11_guard_illustration_lifecycle','ai_s11_guard_illustration_reference')
					AND NOT tgisinternal) = ${expectsRuntime ? 4 : 0})
			AND (to_regprocedure('public.commit_import_async(uuid,text,text,text,jsonb,text)') IS NOT NULL) = ${expectsRuntime}
			AND COALESCE((
				SELECT EXISTS (
					SELECT 1 FROM aclexplode(COALESCE(procedures.proacl,acldefault('f',procedures.proowner))) acl
					JOIN pg_roles roles ON roles.oid=acl.grantee
					WHERE roles.rolname='service_role' AND acl.privilege_type='EXECUTE'
				)
				FROM pg_proc procedures
				JOIN pg_namespace namespaces ON namespaces.oid=procedures.pronamespace
				WHERE namespaces.nspname='public' AND procedures.proname='commit_import_async'
			),false) = ${expectsFinalGrants}
			AND (${NON_SERVICE_SECURITY_DEFINER_ACL_SQL})=${sqlLiteral(baselineNonServiceAcl)}
		)::text`
	);
	if (!result.includes("true")) {
		const diagnostics = await runS10Psql(
			databaseUrl,
			`SELECT concat_ws(',',
				(to_regclass('public.ai_import_concept_jobs') IS NOT NULL)::text,
				(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_uploads'::regclass
					AND conname='ai_uploads_s11_status_check' AND NOT convalidated))::text,
				(EXISTS (SELECT 1 FROM pg_policy WHERE polname='ai_import_concept_jobs_select_owner'))::text,
				((SELECT count(*) FROM pg_trigger WHERE tgname IN
					('ai_s11_sync_upload_compat','ai_s11_track_card_reference_removal',
					'ai_s11_guard_illustration_lifecycle','ai_s11_guard_illustration_reference')
					AND NOT tgisinternal))::text,
				(to_regprocedure('public.commit_import_async(uuid,text,text,text,jsonb,text)') IS NOT NULL)::text,
				(COALESCE((SELECT EXISTS (SELECT 1 FROM
					aclexplode(COALESCE(procedures.proacl,acldefault('f',procedures.proowner))) acl
					JOIN pg_roles roles ON roles.oid=acl.grantee
					WHERE roles.rolname='service_role' AND acl.privilege_type='EXECUTE')
					FROM pg_proc procedures JOIN pg_namespace namespaces ON namespaces.oid=procedures.pronamespace
					WHERE namespaces.nspname='public' AND procedures.proname='commit_import_async'),false))::text,
				((${NON_SERVICE_SECURITY_DEFINER_ACL_SQL})=${sqlLiteral(baselineNonServiceAcl)})::text)`
		);
		throw new Error(
			`S-11 ${failpoint} autocommit durable-state verification failed (${diagnostics.trim()})`
		);
	}
}

const NON_SERVICE_SECURITY_DEFINER_ACL_SQL = `SELECT COALESCE(string_agg(
	procedures.oid::regprocedure::text||':'||COALESCE(roles.rolname,'PUBLIC'),','
	ORDER BY procedures.oid::regprocedure::text,COALESCE(roles.rolname,'PUBLIC')
),'') FROM pg_proc procedures
JOIN pg_namespace namespaces ON namespaces.oid=procedures.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(procedures.proacl,acldefault('f',procedures.proowner))) acl
LEFT JOIN pg_roles roles ON roles.oid=acl.grantee
WHERE namespaces.nspname='public' AND procedures.prosecdef
	AND procedures.proname<>'ai_s11_storage_object_is_managed'
	AND acl.privilege_type='EXECUTE'
	AND (acl.grantee=0 OR roles.rolname IN ('anon','authenticated'))`;

function sqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

async function backfillAndValidate(databaseUrl: string): Promise<void> {
	for (;;) {
		const output = await runS10Psql(
			databaseUrl,
			"SELECT public.backfill_ai_uploads_s11(500)::text"
		);
		const affected = Number(output.trim().split(/\s+/u).at(-1));
		if (!Number.isSafeInteger(affected) || affected < 0) {
			throw new Error("S-11 backfill returned an invalid count");
		}
		if (affected === 0) break;
	}
	await runS10PsqlFile(databaseUrl, VALIDATE_MIGRATION);
}

async function assertS10Base(databaseUrl: string): Promise<void> {
	const result = await runS10Psql(
		databaseUrl,
		"SELECT (to_regprocedure('public.commit_import_internal(uuid,text,text,text,jsonb,text)') IS NOT NULL)::text"
	);
	if (!result.includes("true")) throw new Error("S-11 database job requires an applied S-10 base");
}

async function assertStoragePolicyForwardRecovery(databaseUrl: string): Promise<void> {
	await runS10Psql(
		databaseUrl,
		`BEGIN;
		DROP POLICY IF EXISTS storage_objects_insert_owner_illustrations ON storage.objects;
		CREATE POLICY storage_objects_insert_owner_illustrations ON storage.objects FOR INSERT
		WITH CHECK (bucket_id='illustrations' AND split_part(name,'/',1)=auth.uid()::text
			AND NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects managed
				WHERE managed.owner_user_id=auth.uid() AND managed.storage_bucket=bucket_id
					AND managed.storage_path=name));
		DROP POLICY IF EXISTS storage_objects_update_owner_illustrations ON storage.objects;
		CREATE POLICY storage_objects_update_owner_illustrations ON storage.objects FOR UPDATE
		USING (bucket_id='illustrations' AND split_part(name,'/',1)=auth.uid()::text
			AND NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects managed
				WHERE managed.owner_user_id=auth.uid() AND managed.storage_bucket=bucket_id
					AND managed.storage_path=name))
		WITH CHECK (bucket_id='illustrations' AND split_part(name,'/',1)=auth.uid()::text
			AND NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects managed
				WHERE managed.owner_user_id=auth.uid() AND managed.storage_bucket=bucket_id
					AND managed.storage_path=name));
		DROP POLICY IF EXISTS storage_objects_delete_owner_illustrations ON storage.objects;
		CREATE POLICY storage_objects_delete_owner_illustrations ON storage.objects FOR DELETE
		USING (bucket_id='illustrations' AND split_part(name,'/',1)=auth.uid()::text
			AND NOT EXISTS (SELECT 1 FROM public.ai_illustration_objects managed
				WHERE managed.owner_user_id=auth.uid() AND managed.storage_bucket=bucket_id
					AND managed.storage_path=name));
		DROP FUNCTION IF EXISTS public.ai_s11_storage_object_is_managed(text,text);
		COMMIT;`
	);
	await assertLegacyStoragePolicyState(databaseUrl);
	const ownerId = "00000000-0000-4000-8000-000000000001";
	const database = createS10DbClient(databaseUrl);
	const legacyInsert = await database.captureError(
		`INSERT INTO storage.objects(bucket_id,name)
		 VALUES('illustrations','${ownerId}/legacy/pre-forward.png')`,
		{ actor: { kind: "ownerA", role: "authenticated", userId: ownerId } }
	);
	if (legacyInsert.sqlState !== "42501") {
		throw new Error("S-11 pre-forward Storage ACL regression was not reproduced");
	}
	const migration = await readFile(STORAGE_POLICY_HELPER_MIGRATION, "utf8");
	let interrupted = false;
	try {
		await runS10PsqlAutocommitScript(
			databaseUrl,
			`SET app.s11_storage_policy_failpoint='after_helper';\n${migration}`
		);
	} catch {
		interrupted = true;
	}
	if (!interrupted) throw new Error("S-11 storage policy failpoint unexpectedly completed");
	await assertLegacyStoragePolicyState(databaseUrl);
}

async function assertLegacyStoragePolicyState(databaseUrl: string): Promise<void> {
	const result = await runS10Psql(
		databaseUrl,
		`SELECT (
			to_regprocedure('public.ai_s11_storage_object_is_managed(text,text)') IS NULL AND
			(SELECT count(*)=3 FROM pg_policies
				WHERE schemaname='storage' AND tablename='objects'
					AND policyname IN ('storage_objects_insert_owner_illustrations',
						'storage_objects_update_owner_illustrations','storage_objects_delete_owner_illustrations')
					AND (COALESCE(qual,'') || COALESCE(with_check,'')) LIKE '%ai_illustration_objects%')
		)::text`
	);
	if (!result.includes("true")) {
		throw new Error("S-11 storage policy forward rollback did not preserve the legacy state");
	}
}

async function assertS11Contracts(
	databaseUrl: string,
	job: Exclude<S11DatabaseJob, "failure">,
	scheduleApplied: boolean
): Promise<void> {
	const result = await runS10Psql(
		databaseUrl,
		`SELECT (
			to_regclass('public.ai_import_concept_jobs') IS NOT NULL AND
			to_regclass('public.ai_upload_consumers') IS NOT NULL AND
			to_regclass('public.ai_illustration_objects') IS NOT NULL AND
			to_regclass('public.ai_worker_log_outbox') IS NOT NULL AND
			to_regprocedure('public.commit_import_async(uuid,text,text,text,jsonb,text)') IS NOT NULL AND
			to_regprocedure('public.claim_ai_import_concept(uuid,bigint,uuid)') IS NOT NULL AND
			to_regprocedure('public.claim_ai_worker_log_outbox(uuid)') IS NOT NULL AND
			to_regprocedure('public.verify_ai_import_cleanup(uuid,text,text,uuid)') IS NOT NULL AND
			has_table_privilege('s10_migration_owner','public.ai_import_concept_jobs','SELECT,INSERT,UPDATE,DELETE') AND
			has_table_privilege('s10_migration_owner','public.ai_illustration_objects','SELECT,INSERT,UPDATE,DELETE') AND
			has_table_privilege('s10_migration_owner','public.illustrations','INSERT') AND
			has_schema_privilege('s10_migration_owner','pgmq','USAGE') AND
			has_function_privilege('s10_migration_owner','pgmq.send(text,jsonb,integer)','EXECUTE') AND
			has_function_privilege('s10_migration_owner','pgmq.read(text,integer,integer,jsonb)','EXECUTE') AND
			has_table_privilege('s10_migration_owner','pgmq.q_ai_card_imports','SELECT,INSERT,UPDATE,DELETE') AND
			has_table_privilege('s10_migration_owner','pgmq.a_ai_card_imports','SELECT,INSERT,UPDATE,DELETE') AND
			(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role') AND
			(SELECT position('/s11-managed/' in pg_get_constraintdef(oid)) > 0
				FROM pg_constraint WHERE conname='ai_illustration_objects_path_check') AND
			(SELECT data_type='bigint' FROM information_schema.columns
				WHERE table_schema='public' AND table_name='ai_illustration_objects'
					AND column_name='reference_count') AND
			(SELECT count(*)=3 FROM pg_policies
				WHERE schemaname='storage' AND tablename='objects'
					AND policyname IN (
						'storage_objects_insert_owner_illustrations',
						'storage_objects_update_owner_illustrations',
						'storage_objects_delete_owner_illustrations'
					)
					AND (COALESCE(qual,'') || COALESCE(with_check,'')) LIKE '%ai_s11_storage_object_is_managed%') AND
			to_regprocedure('public.ai_s11_storage_object_is_managed(text,text)') IS NOT NULL AND
			has_function_privilege('authenticated','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE') AND
			NOT has_function_privilege('anon','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE') AND
			NOT has_function_privilege('service_role','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE') AND
			has_function_privilege('service_role','public.get_ai_import_status(uuid,uuid,text)','EXECUTE') AND
			NOT has_function_privilege('authenticated','public.get_ai_import_status(uuid,uuid,text)','EXECUTE') AND
			${
				scheduleApplied
					? "NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('s11-ai-card-worker','s11-ai-card-cleanup'))"
					: "to_regprocedure('public.activate_ai_card_async_schedules()') IS NULL"
			}
		)::text`
	);
	if (!result.includes("true")) throw new Error("S-11 database contract smoke failed");
	await assertOwnerSafeSelectMatrix(databaseUrl);
	if (job !== "upgrade") return;
	const lifecycle = await runS10Psql(
		databaseUrl,
		`SELECT (
			(SELECT count(*)=1 FROM public.ai_uploads
				WHERE upload_key='upgrade-deleted' AND status='deleted' AND deleted_at IS NOT NULL) AND
			(SELECT count(*)=2 FROM public.ai_uploads
				WHERE upload_key IN ('upgrade-ready','upgrade-consumed')
					AND source_storage_path=storage_path
					AND source_storage_bucket='illustrations'
					AND raw_storage_path IS NULL AND raw_storage_bucket IS NULL) AND
			(SELECT count(*)=0 FROM public.ai_uploads
				WHERE upload_key IN ('upgrade-ready','upgrade-consumed')
					AND source_storage_bucket='ai-card-sources')
		)::text`
	);
	if (!lifecycle.includes("true")) throw new Error("S-11 upload lifecycle backfill smoke failed");
}

async function assertOwnerSafeSelectMatrix(databaseUrl: string): Promise<void> {
	const catalog = await runS10Psql(
		databaseUrl,
		`SELECT (
			NOT has_table_privilege('authenticated','public.ai_uploads','SELECT') AND
			NOT has_table_privilege('authenticated','public.ai_import_concept_jobs','SELECT') AND
			NOT has_table_privilege('authenticated','public.ai_upload_consumers','SELECT') AND
			NOT has_table_privilege('authenticated','public.ai_illustration_objects','SELECT') AND
			has_column_privilege('authenticated','public.ai_uploads','status','SELECT') AND
			has_column_privilege('authenticated','public.ai_import_concept_jobs','state','SELECT') AND
			has_column_privilege('authenticated','public.ai_upload_consumers','created_at','SELECT') AND
			has_column_privilege('authenticated','public.ai_illustration_objects','state','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_uploads','cleanup_claim_token','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_uploads','raw_cleanup_claim_token','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_uploads','source_write_intent_path','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_import_concept_jobs','claim_token','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_import_concept_jobs','terminal_claim_token_hash','SELECT') AND
			NOT has_column_privilege('authenticated','public.ai_illustration_objects','cleanup_claim_token','SELECT') AND
			NOT has_column_privilege('anon','public.ai_uploads','status','SELECT') AND
			has_table_privilege('service_role','public.ai_uploads','SELECT') AND
			has_table_privilege('service_role','public.ai_import_concept_jobs','SELECT') AND
			has_table_privilege('service_role','public.ai_upload_consumers','SELECT') AND
			has_table_privilege('service_role','public.ai_illustration_objects','SELECT')
		)::text`
	);
	if (!catalog.includes("true")) throw new Error("S-11 owner-safe column ACL smoke failed");

	const ownerId = "00000000-0000-4000-8000-000000000001";
	const otherOwnerId = "00000000-0000-4000-8000-000000000002";
	const uploadId = "15000000-0000-4000-8000-000000000015";
	const batchId = "15000000-0000-4000-8000-000000000016";
	const jobId = "15000000-0000-4000-8000-000000000017";
	const illustrationId = "15000000-0000-4000-8000-000000000018";
	const objectId = "15000000-0000-4000-8000-000000000019";
	await runS10Psql(
		databaseUrl,
		`INSERT INTO public.ai_uploads(
			id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status
		) VALUES (
			'${uploadId}','${ownerId}','s11-owner-safe-matrix','card_illustration',
			'${ownerId}/${uploadId}/source','image/png',24,'ready'
		) ON CONFLICT (id) DO NOTHING;
		INSERT INTO public.ai_import_batches(
			id,owner_user_id,source,status,idempotency_key,import_request_hash,
			requested_card_count,requested_image_count
		) VALUES (
			'${batchId}','${ownerId}','app_ai','committed','s11-owner-safe-matrix',
			repeat('a',64),1,1
		) ON CONFLICT (id) DO NOTHING;
		INSERT INTO public.illustrations(
			id,owner_user_id,illustration_key,status,storage_path
		) VALUES (
			'${illustrationId}','${ownerId}','s11-owner-safe-matrix','ready',
			'${ownerId}/s11-managed/${illustrationId}.png'
		) ON CONFLICT (id) DO NOTHING;
		INSERT INTO public.ai_import_concept_jobs(
			id,owner_user_id,batch_id,concept_id,state,illustration_id
		) VALUES (
			'${jobId}','${ownerId}','${batchId}','owner-safe-matrix','queued','${illustrationId}'
		) ON CONFLICT (id) DO NOTHING;
		INSERT INTO public.ai_upload_consumers(upload_id,job_id,owner_user_id)
		VALUES ('${uploadId}','${jobId}','${ownerId}')
		ON CONFLICT (upload_id,job_id) DO NOTHING;
		INSERT INTO public.ai_illustration_objects(
			id,owner_user_id,job_id,illustration_id,storage_path,state
		) VALUES (
			'${objectId}','${ownerId}','${jobId}','${illustrationId}',
			'${ownerId}/s11-managed/${illustrationId}.png','uploading'
		) ON CONFLICT (id) DO NOTHING`
	);
	for (const [actor, expected] of [
		[ownerId, "1"],
		[otherOwnerId, "0"],
	] as const) {
		const safe = await runS10Psql(
			databaseUrl,
			`BEGIN;
			SET LOCAL ROLE authenticated;
			SET LOCAL request.jwt.claim.role='authenticated';
			SET LOCAL request.jwt.claim.sub='${actor}';
			SELECT (
				(SELECT count(id) FROM public.ai_uploads WHERE id='${uploadId}')=${expected} AND
				(SELECT count(id) FROM public.ai_import_concept_jobs WHERE id='${jobId}')=${expected} AND
				(SELECT count(job_id) FROM public.ai_upload_consumers WHERE job_id='${jobId}')=${expected} AND
				(SELECT count(id) FROM public.ai_illustration_objects WHERE id='${objectId}')=${expected}
			)::text;
			ROLLBACK;`
		);
		if (!safe.includes("true")) {
			throw new Error("S-11 owner-safe RLS projection failed");
		}
	}
	for (const statement of [
		"SELECT cleanup_claim_token,raw_cleanup_claim_token,source_write_intent_path FROM public.ai_uploads LIMIT 0",
		"SELECT claim_token,terminal_claim_token_hash FROM public.ai_import_concept_jobs LIMIT 0",
		"SELECT cleanup_claim_token,storage_path,digest FROM public.ai_illustration_objects LIMIT 0",
	]) {
		await runS10Psql(
			databaseUrl,
			`BEGIN; SET LOCAL ROLE authenticated;
			SET LOCAL request.jwt.claim.role='authenticated';
			SET LOCAL request.jwt.claim.sub='${ownerId}';
			DO $owner_safe_matrix$
			BEGIN
				EXECUTE ${sqlLiteral(statement)};
				RAISE EXCEPTION 'S-11 owner token projection unexpectedly succeeded';
			EXCEPTION
				WHEN insufficient_privilege THEN
					IF SQLSTATE <> '42501' THEN RAISE; END IF;
			END
			$owner_safe_matrix$;
			ROLLBACK;`
		);
	}
	await runS10Psql(
		databaseUrl,
		`BEGIN; SET LOCAL ROLE service_role;
		SELECT * FROM public.ai_uploads LIMIT 0;
		SELECT * FROM public.ai_import_concept_jobs LIMIT 0;
		SELECT * FROM public.ai_upload_consumers LIMIT 0;
		SELECT * FROM public.ai_illustration_objects LIMIT 0;
		ROLLBACK;`
	);
	await assertStorageObjectMutationMatrix(databaseUrl, {
		ownerId,
		otherOwnerId,
		managedPath: `${ownerId}/s11-managed/${illustrationId}.png`,
	});
}

async function assertStorageObjectMutationMatrix(
	databaseUrl: string,
	fixture: Readonly<{ ownerId: string; otherOwnerId: string; managedPath: string }>
): Promise<void> {
	const database = createS10DbClient(databaseUrl);
	const owner = {
		kind: "ownerA",
		role: "authenticated",
		userId: fixture.ownerId,
	} as const;
	const otherOwner = {
		kind: "ownerB",
		role: "authenticated",
		userId: fixture.otherOwnerId,
	} as const;
	const legacyPath = `${fixture.ownerId}/legacy/cycle16.png`;
	const sourcePath = `${fixture.ownerId}/s11-source/cycle16.png`;
	const movedPath = `${fixture.ownerId}/legacy/cycle16-moved.png`;
	const crossOwnerPath = `${fixture.otherOwnerId}/legacy/cycle16-cross.png`;
	const legacyId = "16000000-0000-4000-8000-000000000001";
	const managedStorageId = "16000000-0000-4000-8000-000000000002";

	const catalog = await runS10Psql(
		databaseUrl,
		`SELECT (
			(SELECT procedures.prosecdef AND procedures.provolatile='s'
				AND roles.rolname='s10_migration_owner'
				AND procedures.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
			 FROM pg_proc procedures
			 JOIN pg_namespace namespaces ON namespaces.oid=procedures.pronamespace
			 JOIN pg_roles roles ON roles.oid=procedures.proowner
			 WHERE namespaces.nspname='public'
				AND procedures.proname='ai_s11_storage_object_is_managed')
			AND has_function_privilege('authenticated','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')
			AND NOT has_function_privilege('anon','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')
			AND NOT has_function_privilege('service_role','public.ai_s11_storage_object_is_managed(text,text)','EXECUTE')
			AND NOT EXISTS (
				SELECT 1
				FROM pg_proc helper
				CROSS JOIN LATERAL aclexplode(COALESCE(helper.proacl,acldefault('f',helper.proowner))) acl
				WHERE helper.oid='public.ai_s11_storage_object_is_managed(text,text)'::regprocedure
					AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
			)
		)::text`
	);
	if (!catalog.includes("true")) throw new Error("S-11 Storage helper catalog ACL smoke failed");

	const helperRows = await database.query<{ legacy: boolean; tracked: boolean }>(
		`SELECT
			public.ai_s11_storage_object_is_managed('illustrations',${sqlLiteral(legacyPath)}) AS legacy,
			public.ai_s11_storage_object_is_managed('illustrations',${sqlLiteral(fixture.managedPath)}) AS tracked`,
		{ actor: owner }
	);
	if (
		helperRows.length !== 1 ||
		helperRows[0]?.legacy !== false ||
		helperRows[0]?.tracked !== true
	) {
		throw new Error("S-11 Storage helper owner behavior failed");
	}
	const packedClaims = await runS10Psql(
		databaseUrl,
		`BEGIN;
		SET LOCAL ROLE authenticated;
		SET LOCAL request.jwt.claim.role='';
		SET LOCAL request.jwt.claim.sub='';
		SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.ownerId}"}';
		SELECT (NOT public.ai_s11_storage_object_is_managed(
			'illustrations',${sqlLiteral(legacyPath)}
		))::text;
		ROLLBACK;`
	);
	if (!packedClaims.includes("true")) {
		throw new Error("S-11 Storage helper packed JWT claims fallback failed");
	}
	for (const [sql, actor] of [
		[
			`SELECT public.ai_s11_storage_object_is_managed('illustrations',${sqlLiteral(crossOwnerPath)})`,
			owner,
		],
		[
			`SELECT public.ai_s11_storage_object_is_managed('ai-card-sources',${sqlLiteral(sourcePath)})`,
			owner,
		],
		[
			`SELECT public.ai_s11_storage_object_is_managed('illustrations',${sqlLiteral(legacyPath)})`,
			otherOwner,
		],
	] as const) {
		const denied = await database.captureError(sql, { actor });
		if (denied.sqlState !== "42501") throw new Error("S-11 Storage helper owner validation failed");
	}
	for (const role of ["anon", "service_role"] as const) {
		const denied = await database.captureError(
			`SELECT public.ai_s11_storage_object_is_managed('illustrations',${sqlLiteral(legacyPath)})`,
			{
				actor:
					role === "anon"
						? { kind: "anonymous", role, userId: null }
						: { kind: "service", role, userId: null },
			}
		);
		if (denied.sqlState !== "42501") throw new Error("S-11 Storage helper role ACL failed");
	}
	await database.execute(
		`INSERT INTO storage.objects(id,bucket_id,name)
		 VALUES('${legacyId}'::uuid,'illustrations',${sqlLiteral(legacyPath)})`,
		{ actor: owner }
	);
	await database.execute(
		`UPDATE storage.objects SET name=${sqlLiteral(sourcePath)} WHERE id='${legacyId}'::uuid`,
		{ actor: owner }
	);
	const trackedDestination = await database.captureError(
		`UPDATE storage.objects SET name=${sqlLiteral(fixture.managedPath)} WHERE id='${legacyId}'::uuid`,
		{ actor: owner }
	);
	if (trackedDestination.sqlState !== "42501") {
		throw new Error("S-11 tracked Storage destination was not denied with 42501");
	}
	await database.execute(
		`UPDATE storage.objects SET name=${sqlLiteral(movedPath)} WHERE id='${legacyId}'::uuid`,
		{ actor: owner }
	);
	await database.execute(`DELETE FROM storage.objects WHERE id='${legacyId}'::uuid`, {
		actor: owner,
	});

	for (const [path, actor] of [
		[fixture.managedPath, owner],
		[crossOwnerPath, owner],
		[legacyPath, otherOwner],
	] as const) {
		const denied = await database.captureError(
			`INSERT INTO storage.objects(bucket_id,name) VALUES('illustrations',${sqlLiteral(path)})`,
			{ actor }
		);
		if (denied.sqlState !== "42501") throw new Error("S-11 Storage INSERT actor denial failed");
	}

	await database.execute(
		`INSERT INTO storage.objects(id,bucket_id,name)
		 VALUES('${managedStorageId}'::uuid,'illustrations',${sqlLiteral(fixture.managedPath)})`,
		{ actor: { kind: "service", role: "service_role", userId: null } }
	);
	const ownerTrackedUpdate = await database.query<{ id: string }>(
		`UPDATE storage.objects SET metadata='{"cycle":16}'::jsonb
		 WHERE id='${managedStorageId}'::uuid RETURNING id::text`,
		{ actor: owner }
	);
	const ownerTrackedDelete = await database.query<{ id: string }>(
		`DELETE FROM storage.objects WHERE id='${managedStorageId}'::uuid RETURNING id::text`,
		{ actor: owner }
	);
	if (ownerTrackedUpdate.length !== 0 || ownerTrackedDelete.length !== 0) {
		throw new Error("S-11 tracked Storage OLD row remained owner-mutable");
	}
	await database.execute(
		`UPDATE storage.objects SET metadata='{"cycle":16}'::jsonb WHERE id='${managedStorageId}'::uuid;
		 DELETE FROM storage.objects WHERE id='${managedStorageId}'::uuid`,
		{ actor: { kind: "service", role: "service_role", userId: null } }
	);
	const rowState = await database.query<{ legacyCount: number; managedCount: number }>(
		`SELECT
			count(*) FILTER (WHERE id='${legacyId}'::uuid)::int AS "legacyCount",
			count(*) FILTER (WHERE id='${managedStorageId}'::uuid)::int AS "managedCount"
		 FROM storage.objects`
	);
	if (rowState[0]?.legacyCount !== 0 || rowState[0]?.managedCount !== 0) {
		throw new Error("S-11 Storage actor matrix left unexpected row state");
	}
}

const job = process.argv[2] as S11DatabaseJob | undefined;
if (job !== undefined) {
	if (!(["fresh", "upgrade", "failure"] as const).includes(job)) {
		throw new Error("Unsupported S-11 database job");
	}
	try {
		await runS11DatabaseJob(job);
	} catch (error) {
		if (!isDatabasePrerequisiteError(error)) throw error;
		process.stderr.write(
			`${JSON.stringify({
				gate: `s11-database-${job}`,
				status: "not_run",
				reason: "three distinct S11 database URLs are required; fallback is forbidden",
			})}\n`
		);
		process.exitCode = 2;
	}
}

function isDatabasePrerequisiteError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		/^S11_(FRESH|UPGRADE|FAILURE)_DATABASE_URL is required$/u.test(error.message) ||
		error.message === "S-11 database jobs require three distinct connection strings" ||
		error.message === "S-11 database jobs require three distinct databases"
	);
}
