import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	runS10Psql,
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
		for (const failpoint of [
			"after_expand_tables",
			"after_runtime_functions",
			"before_core_commit",
		] as const) {
			let failed = false;
			try {
				await runS10Psql(databaseUrl, `SET app.s11_failpoint='${failpoint}';\n${migration}`);
			} catch {
				failed = true;
			}
			if (!failed) throw new Error(`S-11 ${failpoint} injection unexpectedly completed`);
			await assertAutocommitFailureState(databaseUrl);
		}
		await runS10Psql(databaseUrl, migration);
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
	const coreOnly = environment.S11_LOCAL_CORE_ONLY === "1";
	if (!coreOnly) await runS10PsqlFile(databaseUrl, SCHEDULE_MIGRATION);
	await backfillAndValidate(databaseUrl);
	await assertS11Contracts(databaseUrl, job, !coreOnly);
}

async function assertAutocommitFailureState(databaseUrl: string): Promise<void> {
	const result = await runS10Psql(
		databaseUrl,
		`SELECT (
			NOT EXISTS (
				SELECT 1 FROM supabase_migrations.schema_migrations
				WHERE version='20260715000000'
			) AND NOT EXISTS (
				SELECT 1 FROM pg_proc procedures
				JOIN pg_namespace namespaces ON namespaces.oid=procedures.pronamespace
				WHERE namespaces.nspname='public'
					AND procedures.prosecdef
					AND has_function_privilege('public',procedures.oid,'EXECUTE')
			)
		)::text`
	);
	if (!result.includes("true")) {
		throw new Error("S-11 autocommit failure exposed a function or advanced the ledger");
	}
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
					AND (COALESCE(qual,'') || COALESCE(with_check,'')) LIKE '%ai_illustration_objects%') AND
			has_function_privilege('service_role','public.get_ai_import_status(uuid,uuid,text)','EXECUTE') AND
			NOT has_function_privilege('authenticated','public.get_ai_import_status(uuid,uuid,text)','EXECUTE') AND
			${scheduleApplied
				? "NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('s11-ai-card-worker','s11-ai-card-cleanup'))"
				: "to_regprocedure('public.activate_ai_card_async_schedules()') IS NULL"}
		)::text`
	);
	if (!result.includes("true")) throw new Error("S-11 database contract smoke failed");
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
