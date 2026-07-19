import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	S10DatabaseCommandError,
	runS10Psql,
	runS10PsqlAutocommitScript,
	runS10PsqlFile,
	sqlLiteral,
} from "../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

type GateMode = "all" | "fresh" | "upgrade";
type DatabaseKind = Exclude<GateMode, "all">;

interface GateDatabase {
	readonly kind: DatabaseKind;
	readonly name: string;
	readonly url: string;
}

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const S13_MIGRATION = path.join(MIGRATIONS, "20260719000001_s13_ai_card_management_undo.sql");
const SEED = path.join(ROOT, "supabase/seed.sql");
// pg_cron is bound to the local project's postgres database and rejects
// installation in a disposable database. S-13 has no schedule/cron dependency,
// so the gate applies every pre-S13 application-schema migration and reports
// this single operational omission explicitly in its evidence.
const PRE_S13_MIGRATIONS = [
	"20260223000000_s02_schema_rls.sql",
	"20260223000001_s02_storage_illustrations.sql",
	"20260714000000_s10_ai_card_import_foundation.sql",
	"20260715000000_s11_ai_card_async_processing.sql",
	"20260715000002_s11_ai_card_async_validate.sql",
	"20260716000000_s11_owner_safe_select.sql",
	"20260716000001_s11_storage_policy_helper.sql",
	"20260718000000_s12_ai_card_generation_source_release.sql",
	"20260718000001_fix_users_profile_authenticated_grants.sql",
	"20260718000002_fix_runtime_authenticated_grants.sql",
	"20260718000003_fix_service_role_runtime_grants.sql",
	"20260718000004_restrict_authenticated_illustration_writes.sql",
	"20260718000005_validate_preview_existing_duplicates.sql",
	"20260718000006_commit_generated_import_after_exclusions.sql",
	"20260719000000_s12_fix_generation_source_function_ownership.sql",
] as const;
const LONG_RUNNING = { timeoutMs: 180_000 } as const;
const OMITTED_OPERATIONAL_MIGRATION = "20260715000001_s11_ai_card_async_schedule_controls.sql";
const OWNER_ID = "13000000-0000-4000-8000-00000000000a";
const FIXTURE_DECK_ID = "d1300000-0000-4000-8000-000000000001";
const FIXTURE_CARD_ID = "c1300000-0000-4000-8000-000000000001";
const FIXTURE_BATCH_ID = "b1300000-0000-4000-8000-000000000001";
const FIXTURE_ITEM_ID = "a1300000-0000-4000-8000-000000000001";
const FIXTURE_JOB_ID = "e1300000-0000-4000-8000-000000000001";
const FIXTURE_CONCEPT_ID = "s13-upgrade-concept";

function requireMode(value: string | undefined): GateMode {
	if (value === "all" || value === "fresh" || value === "upgrade") return value;
	throw new Error("S-13 database gate mode must be all, fresh, or upgrade");
}

function requireAdminUrl(): string {
	const value = process.env.S13_ADMIN_DATABASE_URL?.trim();
	if (!value) throw new Error("S13_ADMIN_DATABASE_URL is required");
	const parsed = new URL(value);
	if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
		throw new Error("S13_ADMIN_DATABASE_URL must be a PostgreSQL URL");
	}
	if (decodeURIComponent(parsed.pathname.replace(/^\//u, "")) !== "postgres") {
		throw new Error("S13_ADMIN_DATABASE_URL must target the postgres admin database");
	}
	return parsed.toString();
}

function databaseUrl(adminUrl: string, name: string): string {
	const parsed = new URL(adminUrl);
	parsed.pathname = `/${name}`;
	return parsed.toString();
}

function quoteIdentifier(value: string): string {
	if (!/^s13_gate_(fresh|upgrade)_[a-z0-9_]+$/u.test(value)) {
		throw new Error("unsafe S-13 gate database name");
	}
	return `"${value}"`;
}

async function createDatabase(adminUrl: string, kind: DatabaseKind): Promise<GateDatabase> {
	const suffix = `${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
	const name = `s13_gate_${kind}_${suffix}`;
	const exists = await runS10Psql(
		adminUrl,
		`SELECT 1 FROM pg_database WHERE datname=${sqlLiteral(name)}`
	);
	if (exists.trim()) throw new Error(`S-13 gate refuses to reuse database ${name}`);
	await runS10Psql(
		adminUrl,
		`CREATE DATABASE ${quoteIdentifier(name)} TEMPLATE template0`,
		LONG_RUNNING
	);
	return { kind, name, url: databaseUrl(adminUrl, name) };
}

async function dropDatabase(adminUrl: string, database: GateDatabase): Promise<void> {
	await runS10Psql(
		adminUrl,
		`DROP DATABASE ${quoteIdentifier(database.name)} WITH (FORCE)`,
		LONG_RUNNING
	);
}

async function bootstrapSupabaseContracts(url: string): Promise<void> {
	await runS10Psql(
		url,
		`CREATE SCHEMA extensions;
		CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
		CREATE SCHEMA auth;
		CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
			SELECT COALESCE(
				NULLIF(current_setting('request.jwt.claim.sub',true),''),
				NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'
			)::uuid
		$$;
		CREATE TABLE auth.users(
			id uuid PRIMARY KEY,instance_id uuid,aud text,role text,email text,
			encrypted_password text,email_confirmed_at timestamptz,
			raw_app_meta_data jsonb,raw_user_meta_data jsonb,
			created_at timestamptz,updated_at timestamptz
		);
		CREATE SCHEMA storage;
		CREATE TABLE storage.buckets(
			id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,
			file_size_limit bigint
		);
		CREATE TABLE storage.objects(
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,
			name text NOT NULL,owner uuid,owner_id text,metadata jsonb,
			created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
			UNIQUE(bucket_id,name)
		);
		ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
		GRANT USAGE ON SCHEMA auth,storage,extensions TO anon,authenticated,service_role;
		GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
		GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
		GRANT SELECT ON storage.buckets TO anon,authenticated,service_role;`,
		LONG_RUNNING
	);
}

async function applyPreS13Chain(url: string): Promise<void> {
	for (const migration of PRE_S13_MIGRATIONS) {
		if (migration === "20260715000002_s11_ai_card_async_validate.sql") {
			for (;;) {
				const count = Number(
					(
						await runS10Psql(url, "SELECT public.backfill_ai_uploads_s11(500)::text", LONG_RUNNING)
					).trim()
				);
				if (!Number.isSafeInteger(count) || count < 0) {
					throw new Error("S-13 gate received an invalid S-11 backfill count");
				}
				if (count === 0) break;
			}
		}
		await runS10PsqlFile(url, path.join(MIGRATIONS, migration), LONG_RUNNING);
	}
	await runS10PsqlFile(url, SEED, LONG_RUNNING);
}

async function insertUpgradeFixture(url: string): Promise<void> {
	await runS10Psql(
		url,
		`INSERT INTO auth.users(
			id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
			raw_app_meta_data,raw_user_meta_data,created_at,updated_at
		) VALUES(
			'${OWNER_ID}'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,
			'authenticated','authenticated','s13-upgrade@example.local','test',now(),
			'{}'::jsonb,'{}'::jsonb,now(),now()
		);
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('${FIXTURE_DECK_ID}'::uuid,'${OWNER_ID}'::uuid,'S-13 upgrade deck');
		INSERT INTO public.cards(
			id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key
		) VALUES(
			'${FIXTURE_CARD_ID}'::uuid,'${OWNER_ID}'::uuid,'private','reading','R1',
			'漢字 S-13 upgrade','かんじ S-13 upgrade',repeat('a',64)
		);
		INSERT INTO public.deck_cards(deck_id,card_id)
		VALUES('${FIXTURE_DECK_ID}'::uuid,'${FIXTURE_CARD_ID}'::uuid);
		INSERT INTO public.ai_import_batches(
			id,owner_user_id,source,target_deck_id,status,idempotency_key,import_request_hash,
			requested_card_count,requested_image_count,finalized_count,failed_count,completed_at
		) VALUES(
			'${FIXTURE_BATCH_ID}'::uuid,'${OWNER_ID}'::uuid,'app_ai','${FIXTURE_DECK_ID}'::uuid,
			'completed','s13-upgrade',repeat('b',64),1,0,1,0,now()
		);
		INSERT INTO public.ai_import_items(
			id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,
			front_text,back_text,card_key,image_mode,status,result_card_id,finalized_at
		) VALUES(
			'${FIXTURE_ITEM_ID}'::uuid,'${OWNER_ID}'::uuid,'${FIXTURE_BATCH_ID}'::uuid,
			's13-upgrade-item','${FIXTURE_CONCEPT_ID}',0,'R1','reading',
			'漢字 S-13 upgrade','かんじ S-13 upgrade',repeat('c',64),'none','finalized',
			'${FIXTURE_CARD_ID}'::uuid,now()
		);
		INSERT INTO public.ai_import_concept_jobs(
			id,owner_user_id,batch_id,concept_id,state,queue_message_id,completed_at
		) VALUES(
			'${FIXTURE_JOB_ID}'::uuid,'${OWNER_ID}'::uuid,'${FIXTURE_BATCH_ID}'::uuid,
			'${FIXTURE_CONCEPT_ID}','succeeded',130000000001,now()
		);`,
		LONG_RUNNING
	);
}

async function captureData(url: string): Promise<string> {
	return (
		await runS10Psql(
			url,
			`SELECT jsonb_build_object(
				'cards',(SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM (
					SELECT id::text,owner_user_id::text,visibility,front_text,back_text,card_key
					FROM public.cards
				) row_data),
				'decks',(SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM (
					SELECT id::text,owner_user_id::text,name FROM public.decks
				) row_data),
				'batches',(SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM (
					SELECT id::text,owner_user_id::text,status,finalized_count,failed_count
					FROM public.ai_import_batches
				) row_data),
				'items',(SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM (
					SELECT id::text,batch_id::text,status,result_card_id::text,user_edited_at
					FROM public.ai_import_items
				) row_data),
				'jobs',(SELECT jsonb_agg(to_jsonb(row_data) ORDER BY id) FROM (
					SELECT id::text,batch_id::text,state,queue_message_id
					FROM public.ai_import_concept_jobs
				) row_data)
			)::text`,
			LONG_RUNNING
		)
	).trim();
}

async function captureMigrationBaseline(url: string): Promise<string> {
	return (
		await runS10Psql(
			url,
			`SELECT jsonb_build_object(
				'helper',to_regprocedure('public.ai_s13_authenticated_actor()'),
				'cardIndex',to_regclass('public.cards_owner_private_created_id_idx'),
				'itemIndex',to_regclass('public.ai_import_items_owner_finalized_card_idx'),
				'undo',md5(pg_get_functiondef('public.undo_import_internal(uuid,uuid)'::regprocedure))
			)::text`,
			LONG_RUNNING
		)
	).trim();
}

function injectFailure(migration: string): string {
	const replacement = `
DO $s13_failure$
BEGIN
	RAISE EXCEPTION 'S-13 injected failure before commit';
END;
$s13_failure$;

COMMIT;
`;
	const instrumented = migration.replace(/\nCOMMIT;\s*$/u, replacement);
	if (instrumented === migration) throw new Error("S-13 gate could not inject rollback failure");
	return instrumented;
}

async function assertRollbackAndReapply(url: string): Promise<void> {
	const migration = await readFile(S13_MIGRATION, "utf8");
	const dataBefore = await captureData(url);
	const catalogBefore = await captureMigrationBaseline(url);
	let failed = false;
	try {
		await runS10PsqlAutocommitScript(url, injectFailure(migration), LONG_RUNNING);
	} catch (error) {
		if (!(error instanceof S10DatabaseCommandError)) throw error;
		failed = true;
	}
	if (!failed) throw new Error("S-13 injected migration unexpectedly committed");
	if ((await captureData(url)) !== dataBefore) {
		throw new Error("S-13 failed migration changed upgrade data");
	}
	if ((await captureMigrationBaseline(url)) !== catalogBefore) {
		throw new Error("S-13 failed migration left catalog state behind");
	}
	await runS10PsqlFile(url, S13_MIGRATION, LONG_RUNNING);
	if ((await captureData(url)) !== dataBefore) {
		throw new Error("S-13 recovery apply changed upgrade data");
	}
}

async function assertCatalog(url: string): Promise<void> {
	const output = await runS10Psql(
		url,
		`WITH expected(identity,public_rpc) AS (VALUES
			('public.ai_s13_authenticated_actor()'::regprocedure,false),
			('public.ai_s13_assert_managed_card(uuid,uuid)'::regprocedure,false),
			('public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)'::regprocedure,true),
			('public.update_imported_card(uuid,jsonb,timestamptz)'::regprocedure,true),
			('public.delete_private_card(uuid,timestamptz)'::regprocedure,true),
			('public.set_card_decks(uuid,uuid[])'::regprocedure,true),
			('public.set_card_tags(uuid,uuid[])'::regprocedure,true),
			('public.set_card_tag_names(uuid,text[])'::regprocedure,true),
			('public.set_card_illustration(uuid,uuid)'::regprocedure,true),
			('public.bulk_delete_imported_cards(jsonb)'::regprocedure,true),
			('public.undo_import(uuid)'::regprocedure,true),
			('public.undo_import_internal(uuid,uuid)'::regprocedure,false)
		), checked AS (
			SELECT bool_and(
				roles.rolname='s10_migration_owner' AND procedures.prosecdef
				AND procedures.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
				AND has_function_privilege('authenticated',expected.identity,'EXECUTE')=expected.public_rpc
				AND NOT has_function_privilege('anon',expected.identity,'EXECUTE')
				AND NOT has_function_privilege('service_role',expected.identity,'EXECUTE')
				AND NOT EXISTS(
					SELECT 1 FROM aclexplode(COALESCE(procedures.proacl,acldefault('f',procedures.proowner))) acl
					WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
				)
			) valid,count(*)::int count
			FROM expected
			JOIN pg_proc procedures ON procedures.oid=expected.identity
			JOIN pg_roles roles ON roles.oid=procedures.proowner
		)
		SELECT (valid AND count=12)::text FROM checked`,
		LONG_RUNNING
	);
	if (output.trim() !== "true") throw new Error("S-13 function owner/grant catalog is invalid");
}

async function assertPackedClaimsRpc(url: string, expectedCardId?: string): Promise<void> {
	const expected = expectedCardId
		? `(result->'items') @> jsonb_build_array(jsonb_build_object('id','${expectedCardId}'))`
		: `jsonb_array_length(result->'items')=0`;
	const output = await runS10Psql(
		url,
		`BEGIN;
		SET LOCAL ROLE authenticated;
		SET LOCAL request.jwt.claim.role='';
		SET LOCAL request.jwt.claim.sub='';
		SET LOCAL request.jwt.claims=${sqlLiteral(
			JSON.stringify({ role: "authenticated", sub: OWNER_ID })
		)};
		WITH response AS (
			SELECT public.list_ai_managed_cards(20,NULL,NULL,NULL,NULL,NULL,NULL,NULL) result
		)
		SELECT (${expected})::text FROM response;
		COMMIT;`,
		LONG_RUNNING
	);
	if (!output.includes("true")) throw new Error("S-13 packed claims public RPC failed");
}

async function runGateDatabase(adminUrl: string, kind: DatabaseKind): Promise<void> {
	const database = await createDatabase(adminUrl, kind);
	try {
		await bootstrapSupabaseContracts(database.url);
		await applyPreS13Chain(database.url);
		if (kind === "upgrade") {
			await insertUpgradeFixture(database.url);
			await assertRollbackAndReapply(database.url);
		} else {
			await runS10PsqlFile(database.url, S13_MIGRATION, LONG_RUNNING);
		}
		await assertCatalog(database.url);
		await assertPackedClaimsRpc(database.url, kind === "upgrade" ? FIXTURE_CARD_ID : undefined);
		process.stdout.write(
			`${JSON.stringify({
				gate: `s13-database-${kind}`,
				status: "passed",
				database: database.name,
				migration: path.basename(S13_MIGRATION),
				omittedOperationalMigration: OMITTED_OPERATIONAL_MIGRATION,
				omissionReason:
					"pg_cron is configured for the postgres database and S-13 has no cron dependency",
				rollbackReapply: kind === "upgrade" ? "passed" : "not_applicable",
			})}\n`
		);
	} finally {
		await dropDatabase(adminUrl, database);
	}
}

async function main(): Promise<void> {
	const mode = requireMode(process.argv[2]);
	const adminUrl = requireAdminUrl();
	const kinds: readonly DatabaseKind[] = mode === "all" ? ["fresh", "upgrade"] : [mode];
	for (const kind of kinds) await runGateDatabase(adminUrl, kind);
	process.stdout.write(
		`${JSON.stringify({
			gate: "s13-database",
			status: "passed",
			modes: kinds,
			artifactSha256: createHash("sha256")
				.update(await readFile(S13_MIGRATION))
				.digest("hex"),
		})}\n`
	);
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : "S-13 database gate failed"}\n`);
	process.exitCode = 1;
});
