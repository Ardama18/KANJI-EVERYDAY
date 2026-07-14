import { execFile } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	captureS10SeedGeneralSnapshot,
	captureS10SeedKeySnapshot,
	createS10DbClient,
	runS10Psql,
	runS10PsqlFile,
	type S10DbClient,
	type S10JsonSnapshot,
	S10DatabaseCommandError,
	sqlLiteral,
} from "./s10-db-testkit";

export type S10DatabaseJob = "fresh" | "upgrade" | "failure";

export interface S10DatabaseJobSelection {
	job: S10DatabaseJob;
	databaseUrl: string;
	databaseName: string;
	environmentKey: string;
	testFile: string;
	testNamePattern: string;
}

export interface S10MigrationFailureResult {
	failpoint: string;
	rolledBack: boolean;
}

export interface S10AcSmokeResult {
	passedAc: number[];
}

const JOBS = ["fresh", "upgrade", "failure"] as const satisfies readonly S10DatabaseJob[];
const JOB_DATABASE_ENV = {
	fresh: "S10_FRESH_DATABASE_URL",
	upgrade: "S10_UPGRADE_DATABASE_URL",
	failure: "S10_FAILURE_DATABASE_URL",
} as const satisfies Record<S10DatabaseJob, string>;
const JOB_TEST_PATTERN = {
	fresh: "^(?!.*E2E-MIGRATION-0[2-3])",
	upgrade: "E2E-MIGRATION-02",
	failure: "E2E-MIGRATION-03",
} as const satisfies Record<S10DatabaseJob, string>;
const JOB_INTEGRATION_PATTERN = {
	fresh: "^(?!.*IT-MIGRATION-0[2-5])",
	upgrade: "IT-MIGRATION-0[2-4]",
	failure: "IT-MIGRATION-05",
} as const satisfies Record<S10DatabaseJob, string>;
const MIGRATION_FAILPOINTS = [
	"after_helper_self_check",
	"after_collision_check",
	"after_card_key_backfill",
	"after_import_schema",
	"after_rls_contract",
] as const;
const CONNECTION_IDENTITY_QUERY_PARAMETERS = new Set([
	"dbname",
	"host",
	"hostaddr",
	"port",
	"user",
	"password",
	"service",
]);

const HELPER_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = path.resolve(HELPER_DIRECTORY, "../../../../..");
const FRONTEND_DIRECTORY = path.join(REPOSITORY_ROOT, "frontend");
const S02_MIGRATIONS = [
	path.join(REPOSITORY_ROOT, "supabase/migrations/20260223000000_s02_schema_rls.sql"),
	path.join(REPOSITORY_ROOT, "supabase/migrations/20260223000001_s02_storage_illustrations.sql"),
] as const;
const S10_MIGRATION = path.join(
	REPOSITORY_ROOT,
	"supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql"
);
const CURRENT_SEED = path.join(REPOSITORY_ROOT, "supabase/seed.sql");
const FROZEN_PRE_S10_SEED = path.join(
	REPOSITORY_ROOT,
	"specs/stories/S-10-ai-card-import-foundation/tests/fixtures/pre-s10-seed.sql"
);

export async function runS10CurrentSeed(databaseUrl: string): Promise<void> {
	await runS10PsqlFile(databaseUrl, CURRENT_SEED);
}
const INTEGRATION_TEST_FILE =
	"../specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts";
const CONTRACT_E2E_FILE =
	"../specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts";

export function selectS10DatabaseJobs(
	environment: Readonly<Record<string, string | undefined>> = process.env
): S10DatabaseJobSelection[] {
	const selections = JOBS.map((job) => selectJobWithoutCrossValidation(job, environment));
	if (new Set(selections.map(({ databaseUrl }) => databaseUrl)).size !== selections.length) {
		throw new Error("S-10 database jobs require three distinct connection strings");
	}
	if (new Set(selections.map(({ databaseName }) => databaseName)).size !== selections.length) {
		throw new Error("S-10 database jobs require three distinct database names");
	}
	return selections;
}

export function selectS10DatabaseJob(
	job: S10DatabaseJob,
	environment: Readonly<Record<string, string | undefined>> = process.env
): S10DatabaseJobSelection {
	const selection = selectS10DatabaseJobs(environment).find((candidate) => candidate.job === job);
	if (selection === undefined) {
		throw new Error(`Unsupported S-10 database job: ${job}`);
	}
	return selection;
}

export async function readS10JobSnapshot(
	client: S10DbClient,
	name: string
): Promise<S10JsonSnapshot> {
	const rows = await client.query<{ snapshot: S10JsonSnapshot }>(`
		SELECT snapshot FROM s10_job.snapshots WHERE name = ${sqlLiteral(name)}
	`);
	const snapshot = rows[0]?.snapshot;
	if (snapshot === undefined) {
		throw new Error(`S-10 job snapshot is missing: ${name}`);
	}
	return snapshot;
}

export async function runS10AcSmoke(client: S10DbClient): Promise<S10AcSmokeResult> {
	const rows = await client.query<Record<`ac${number}`, boolean>>(`
		SELECT
			(SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public'
				AND indexname IN ('cards_public_card_key_uidx', 'cards_private_owner_card_key_uidx')) AS ac1,
			(SELECT count(*) = 2 FROM pg_constraint WHERE conname IN
				('cards_owner_visibility_check', 'cards_card_key_sha256_check')) AS ac2,
			(SELECT count(*) > 0 AND bool_and(card_key = public.ai_compute_card_key(pattern, front_text, back_text))
				FROM public.cards WHERE visibility = 'public') AS ac3,
			(to_regprocedure('public.commit_import(uuid,text,text,text,jsonb,text)') IS NOT NULL) AS ac4,
			(to_regprocedure('public.reserve_provider_usage(uuid,text,text,text,text,integer,uuid,uuid,text)') IS NOT NULL) AS ac5,
			(SELECT count(*) = 8 FROM information_schema.tables WHERE table_schema = 'public'
				AND table_name IN ('ai_import_batches','ai_import_items','ai_uploads','tags',
				'ai_import_item_tags','card_tags','ai_usage_daily','ai_quota_reservations')) AS ac6,
			(SELECT count(*) = 2 FROM pg_trigger WHERE NOT tgisinternal
				AND tgname IN ('guard_card_active_session','tombstone_import_item_on_delete')) AS ac7,
			(SELECT count(*) = 1 FROM pg_trigger WHERE NOT tgisinternal
				AND tgname = 'reset_review_state_on_content_change') AS ac8,
			(SELECT count(*) = 8 FROM pg_class WHERE relnamespace = 'public'::regnamespace
				AND relrowsecurity AND relname IN ('ai_import_batches','ai_import_items','ai_uploads','tags',
				'ai_import_item_tags','card_tags','ai_usage_daily','ai_quota_reservations')) AS ac9
	`);
	const result = rows[0];
	if (result === undefined) {
		throw new Error("S-10 AC smoke query returned no row");
	}
	const passedAc = Array.from({ length: 9 }, (_, index) => index + 1).filter(
		(ac) => result[`ac${ac}`] === true
	);
	return { passedAc };
}

export async function runS10MigrationFailureChecks(
	client: S10DbClient
): Promise<S10MigrationFailureResult[]> {
	const baseline = await readS10JobSnapshot(client, "failure_baseline");
	const originalMigration = await readFile(S10_MIGRATION, "utf8");
	const results: S10MigrationFailureResult[] = [];
	for (const failpoint of MIGRATION_FAILPOINTS) {
		const before = await captureS10MigrationSnapshot(client);
		if (!isDeepStrictEqual(before, baseline)) {
			throw new Error(`S-10 failure database drifted before ${failpoint}`);
		}
		const migration =
			failpoint === "after_rls_contract"
				? injectRlsFailpoint(originalMigration)
				: originalMigration;
		let failed = false;
		try {
			await runS10Psql(
				client.databaseUrl,
				`SET app.s10_failpoint = ${sqlLiteral(failpoint)};\n${migration}`
			);
		} catch (error) {
			if (!(error instanceof S10DatabaseCommandError)) throw error;
			failed = true;
		}
		if (!failed) {
			throw new Error(`S-10 migration failpoint unexpectedly committed: ${failpoint}`);
		}
		const after = await captureS10MigrationSnapshot(client);
		results.push({ failpoint, rolledBack: isDeepStrictEqual(after, baseline) });
	}
	return results;
}

export async function runS10DatabaseJob(
	job: S10DatabaseJob,
	environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
	const selection = selectS10DatabaseJob(job, environment);
	let provisioned = false;
	try {
		await provisionDatabase(selection);
		provisioned = true;
		await bootstrapSupabaseContracts(selection.databaseUrl);
		await applyPreS10Migrations(selection.databaseUrl);
		if (job === "fresh") {
			await runS10PsqlFile(selection.databaseUrl, S10_MIGRATION);
			await runS10PsqlFile(selection.databaseUrl, CURRENT_SEED);
			await prepareJobMetadata(selection);
		} else if (job === "upgrade") {
			await runS10PsqlFile(selection.databaseUrl, FROZEN_PRE_S10_SEED);
			await prepareJobMetadata(selection);
			await storeJobSnapshot(
				selection.databaseUrl,
				"upgrade_baseline_general",
				await captureS10SeedGeneralSnapshot(createS10DbClient(selection.databaseUrl))
			);
			await storeJobSnapshot(
				selection.databaseUrl,
				"upgrade_baseline_keys",
				await captureS10SeedKeySnapshot(createS10DbClient(selection.databaseUrl))
			);
			await runS10PsqlFile(selection.databaseUrl, S10_MIGRATION);
			await storeUpgradeSnapshots(selection.databaseUrl, "upgrade_after_migration");
			await runS10PsqlFile(selection.databaseUrl, CURRENT_SEED);
			await storeUpgradeSnapshots(selection.databaseUrl, "upgrade_after_seed");
		} else {
			await runS10PsqlFile(selection.databaseUrl, FROZEN_PRE_S10_SEED);
			await prepareJobMetadata(selection);
			await storeJobSnapshot(
				selection.databaseUrl,
				"failure_baseline",
				await captureS10MigrationSnapshot(createS10DbClient(selection.databaseUrl))
			);
		}
		await runJobTests(selection, INTEGRATION_TEST_FILE, JOB_INTEGRATION_PATTERN[job]);
		await runJobTests(selection, CONTRACT_E2E_FILE, JOB_TEST_PATTERN[job]);
	} finally {
		if (provisioned) await dropDatabase(selection);
	}
}

function selectJobWithoutCrossValidation(
	job: S10DatabaseJob,
	environment: Readonly<Record<string, string | undefined>>
): S10DatabaseJobSelection {
	const environmentKey = JOB_DATABASE_ENV[job];
	const databaseUrl = environment[environmentKey]?.trim();
	if (databaseUrl === undefined || databaseUrl.length === 0) {
		throw new Error(`${environmentKey} is required for S-10 ${job} database job`);
	}
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new Error(`${environmentKey} must be a PostgreSQL connection URL`);
	}
	if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
		throw new Error(`${environmentKey} must use postgres:// or postgresql://`);
	}
	const identityOverride = Array.from(parsed.searchParams.keys()).find((parameter) =>
		CONNECTION_IDENTITY_QUERY_PARAMETERS.has(parameter.toLowerCase())
	);
	if (identityOverride !== undefined) {
		throw new Error(
			`${environmentKey} must not override connection identity via ${identityOverride}`
		);
	}
	const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
	if (
		databaseName.length === 0 ||
		databaseName.length > 63 ||
		new Set(["postgres", "template0", "template1"]).has(databaseName) ||
		!/^[a-zA-Z0-9_]+$/u.test(databaseName)
	) {
		throw new Error(`${environmentKey} must name a dedicated alphanumeric test database`);
	}
	return {
		job,
		databaseUrl,
		databaseName,
		environmentKey,
		testFile: CONTRACT_E2E_FILE,
		testNamePattern: JOB_TEST_PATTERN[job],
	};
}

async function provisionDatabase(selection: S10DatabaseJobSelection): Promise<void> {
	const adminUrl = adminDatabaseUrl(selection.databaseUrl);
	const exists = await runS10Psql(
		adminUrl,
		`SELECT 1 FROM pg_database WHERE datname = ${sqlLiteral(selection.databaseName)}`
	);
	if (exists.trim() !== "") {
		throw new Error(`S-10 job refuses to reuse existing database: ${selection.databaseName}`);
	}
	await runS10Psql(adminUrl, `CREATE DATABASE ${quoteIdentifier(selection.databaseName)} TEMPLATE template0`);
}

async function dropDatabase(selection: S10DatabaseJobSelection): Promise<void> {
	await runS10Psql(
		adminDatabaseUrl(selection.databaseUrl),
		`DROP DATABASE ${quoteIdentifier(selection.databaseName)} WITH (FORCE)`
	);
}

function adminDatabaseUrl(databaseUrl: string): string {
	const parsed = new URL(databaseUrl);
	parsed.pathname = "/postgres";
	return parsed.toString();
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/gu, '""')}"`;
}

async function bootstrapSupabaseContracts(databaseUrl: string): Promise<void> {
	await runS10Psql(databaseUrl, `
		CREATE SCHEMA extensions;
		CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
		CREATE SCHEMA auth;
		CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
			SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
		$$;
		CREATE TABLE auth.users (
			id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
			encrypted_password text, email_confirmed_at timestamptz,
			raw_app_meta_data jsonb, raw_user_meta_data jsonb,
			created_at timestamptz, updated_at timestamptz
		);
		CREATE SCHEMA storage;
		CREATE TABLE storage.buckets (
			id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false
		);
		CREATE TABLE storage.objects (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL,
			name text NOT NULL, owner uuid, owner_id text, metadata jsonb,
			created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
			UNIQUE (bucket_id, name)
		);
		ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
		GRANT USAGE ON SCHEMA auth, storage, extensions TO anon, authenticated, service_role;
		GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
		GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
		GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
	`);
}

async function applyPreS10Migrations(databaseUrl: string): Promise<void> {
	for (const migration of S02_MIGRATIONS) await runS10PsqlFile(databaseUrl, migration);
}

async function prepareJobMetadata(selection: S10DatabaseJobSelection): Promise<void> {
	await runS10Psql(selection.databaseUrl, `
		CREATE SCHEMA s10_job;
		CREATE TABLE s10_job.metadata (job text NOT NULL, database_name text NOT NULL);
		CREATE TABLE s10_job.snapshots (name text PRIMARY KEY, snapshot jsonb NOT NULL);
		INSERT INTO s10_job.metadata (job, database_name)
		VALUES (${sqlLiteral(selection.job)}, ${sqlLiteral(selection.databaseName)});
	`);
}

async function storeUpgradeSnapshots(databaseUrl: string, prefix: string): Promise<void> {
	const client = createS10DbClient(databaseUrl);
	await storeJobSnapshot(
		databaseUrl,
		`${prefix}_general`,
		await captureS10SeedGeneralSnapshot(client)
	);
	await storeJobSnapshot(databaseUrl, `${prefix}_keys`, await captureS10SeedKeySnapshot(client));
}

async function storeJobSnapshot(
	databaseUrl: string,
	name: string,
	snapshot: S10JsonSnapshot
): Promise<void> {
	await runS10Psql(
		databaseUrl,
		`INSERT INTO s10_job.snapshots (name, snapshot) VALUES (
			${sqlLiteral(name)}, ${sqlLiteral(JSON.stringify(snapshot))}::jsonb
		)`
	);
}

async function captureS10MigrationSnapshot(client: S10DbClient): Promise<S10JsonSnapshot> {
	const rows = await client.query<{ snapshot: S10JsonSnapshot }>(`
		SELECT jsonb_build_object(
			'schemas', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.schema_name)
				FROM (SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner,
					n.nspacl::text AS acl FROM pg_namespace n
					WHERE n.nspname IN ('public', 's10_private')) entry), '[]'::jsonb),
			'columns', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.table_name, entry.ordinal_position)
				FROM (SELECT table_name, ordinal_position, column_name, data_type, is_nullable
					FROM information_schema.columns WHERE table_schema = 'public') entry), '[]'::jsonb),
			'constraints', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.table_name, entry.constraint_name)
				FROM (SELECT cls.relname AS table_name, con.conname AS constraint_name,
					pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
					JOIN pg_class cls ON cls.oid = con.conrelid WHERE cls.relnamespace = 'public'::regnamespace) entry), '[]'::jsonb),
			'indexes', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.indexname)
				FROM (SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public') entry), '[]'::jsonb),
			'policies', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.tablename, entry.policyname)
				FROM (SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public') entry), '[]'::jsonb),
			'relations', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.relation_name)
				FROM (SELECT cls.relname AS relation_name, cls.relkind, cls.relrowsecurity,
					cls.relforcerowsecurity, pg_get_userbyid(cls.relowner) AS owner, cls.relacl::text AS acl
					FROM pg_class cls WHERE cls.relnamespace = 'public'::regnamespace
					AND cls.relkind IN ('r', 'p', 'v', 'm', 'S')) entry), '[]'::jsonb),
			'functions', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.identity)
				FROM (SELECT p.oid::regprocedure::text AS identity, pg_get_functiondef(p.oid) AS definition,
					pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl::text AS acl
					FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
					AND p.prokind IN ('f', 'p')) entry), '[]'::jsonb),
			'triggers', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.table_name, entry.trigger_name)
				FROM (SELECT cls.relname AS table_name, trigger.tgname AS trigger_name,
					trigger.tgenabled, pg_get_triggerdef(trigger.oid) AS definition
					FROM pg_trigger trigger JOIN pg_class cls ON cls.oid = trigger.tgrelid
					WHERE cls.relnamespace = 'public'::regnamespace AND NOT trigger.tgisinternal) entry), '[]'::jsonb),
			'collations', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.collation_name)
				FROM (SELECT col.collname AS collation_name, col.collprovider, col.collisdeterministic,
					col.collcollate, col.collctype FROM pg_collation col
					WHERE col.collnamespace = 'public'::regnamespace) entry), '[]'::jsonb),
			'generalSeed', ${migrationGeneralSnapshotExpression()},
			'keys', ${migrationKeySnapshotExpression()}
		) AS snapshot
	`);
	const snapshot = rows[0]?.snapshot;
	if (snapshot === undefined) throw new Error("S-10 migration snapshot query returned no row");
	return snapshot;
}

function migrationGeneralSnapshotExpression(): string {
	return `(SELECT jsonb_build_object(
		'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM
			(SELECT id::text, owner_user_id::text, visibility, skill, pattern, front_text, back_text, illustration_key
			 FROM public.cards) c), '[]'::jsonb),
		'decks', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM
			(SELECT id::text, owner_user_id::text, name, new_limit_per_day FROM public.decks) d), '[]'::jsonb),
		'deckCards', COALESCE((SELECT jsonb_agg(to_jsonb(dc) ORDER BY dc.deck_id, dc.card_id) FROM
			(SELECT deck_id::text, card_id::text FROM public.deck_cards) dc), '[]'::jsonb)
	))`;
}

function migrationKeySnapshotExpression(): string {
	return `(SELECT COALESCE(jsonb_agg(to_jsonb(k) ORDER BY k.id), '[]'::jsonb)
		FROM (SELECT id::text, card_key FROM public.cards) k)`;
}

function injectRlsFailpoint(migration: string): string {
	const replacement = `
DO $s10_failure$
BEGIN
	IF current_setting('app.s10_failpoint', true) = 'after_rls_contract' THEN
		RAISE EXCEPTION 'S-10 injected migration failure after RLS contract';
	END IF;
END;
$s10_failure$;

COMMIT;
`;
	const instrumented = migration.replace(/\nCOMMIT;\s*$/u, replacement);
	if (instrumented === migration) {
		throw new Error("S-10 migration harness could not locate the final COMMIT");
	}
	return instrumented;
}

async function runJobTests(
	selection: S10DatabaseJobSelection,
	testFile: string,
	testNamePattern: string
): Promise<void> {
	const vitest = path.join(FRONTEND_DIRECTORY, "node_modules/.bin/vitest");
	await new Promise<void>((resolve, reject) => {
		execFile(
			vitest,
			["run", testFile, "-t", testNamePattern],
			{
				cwd: FRONTEND_DIRECTORY,
				encoding: "utf8",
				env: {
					...process.env,
					S10_TEST_DATABASE_URL: selection.databaseUrl,
					S10_DATABASE_JOB: selection.job,
				},
				maxBuffer: 20 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				process.stdout.write(stdout);
				process.stderr.write(stderr);
				if (error !== null) {
					reject(new Error(`S-10 ${selection.job} test process failed`));
					return;
				}
				resolve();
			}
		);
	});
}

function parseJob(value: string | undefined): S10DatabaseJob {
	if (value === "fresh" || value === "upgrade" || value === "failure") return value;
	throw new Error("S-10 database job must be fresh, upgrade, or failure");
}

const requestedJob = process.argv[2];
if (requestedJob === "fresh" || requestedJob === "upgrade" || requestedJob === "failure") {
	runS10DatabaseJob(parseJob(requestedJob)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : "S-10 database job failed"}\n`);
		process.exitCode = 1;
	});
}
