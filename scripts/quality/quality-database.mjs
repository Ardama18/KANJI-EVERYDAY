import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISPOSABLE_DATABASE_PREFIX = "kanji_everyday_quality_s10_";
const DISPOSABLE_DATABASE_PATTERN = /^kanji_everyday_quality_s10_[0-9a-f]{24}$/u;
const PROTECTED_DATABASE_NAMES = new Set([
	"postgres",
	"template0",
	"template1",
	"_supabase",
	"storage_vectors",
	"supabase",
]);
const CONNECTION_IDENTITY_PARAMETERS = new Set([
	"dbname",
	"host",
	"hostaddr",
	"port",
	"user",
	"password",
	"service",
]);
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const S10_DATABASE_FILES = [
	"supabase/migrations/20260223000000_s02_schema_rls.sql",
	"supabase/migrations/20260223000001_s02_storage_illustrations.sql",
	"supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql",
	"supabase/seed.sql",
];
const S10_FOUNDATION_MIGRATION =
	"supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql";
const S10_ROLE_CREATION_MUTATION = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 's10_migration_owner') THEN
    CREATE ROLE s10_migration_owner NOLOGIN BYPASSRLS;
  END IF;
END;
$$;
`;
const S10_ROLE_MEMBERSHIP_MUTATION = "GRANT s10_migration_owner TO postgres;\n";
export const CLUSTER_ROLE_STATE_SQL = `
	WITH role_state AS (
		SELECT string_agg(
			concat_ws(chr(31), rolname, rolsuper::text, rolinherit::text,
				rolcreaterole::text, rolcreatedb::text, rolcanlogin::text,
				rolreplication::text, rolbypassrls::text, rolconnlimit::text,
				coalesce(rolvaliduntil::text, ''), coalesce(rolconfig::text, '')),
			chr(30) ORDER BY rolname
		) AS value
		FROM pg_roles
	), membership_state AS (
		SELECT string_agg(
			concat_ws(chr(31), granted.rolname, member.rolname,
				coalesce(grantor.rolname, ''), memberships.admin_option::text,
				memberships.inherit_option::text, memberships.set_option::text),
			chr(30) ORDER BY granted.rolname, member.rolname, grantor.rolname
		) AS value
		FROM pg_auth_members AS memberships
		JOIN pg_roles AS granted ON granted.oid = memberships.roleid
		JOIN pg_roles AS member ON member.oid = memberships.member
		LEFT JOIN pg_roles AS grantor ON grantor.oid = memberships.grantor
	), prerequisites AS (
		SELECT
			EXISTS (
				SELECT 1 FROM pg_roles
				WHERE rolname = 's10_migration_owner'
					AND NOT rolcanlogin
					AND rolbypassrls
			) AND EXISTS (
				SELECT 1
				FROM pg_auth_members AS memberships
				JOIN pg_roles AS granted ON granted.oid = memberships.roleid
				JOIN pg_roles AS member ON member.oid = memberships.member
				WHERE granted.rolname = 's10_migration_owner'
					AND member.rolname = 'postgres'
			) AS ready
	)
	SELECT (CASE WHEN prerequisites.ready THEN 'ready' ELSE 'missing' END)
		|| ':' || md5(coalesce(role_state.value, '') || chr(29)
			|| coalesce(membership_state.value, ''))
	FROM prerequisites, role_state, membership_state
`;
const S10_BOOTSTRAP_SQL = `
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
		id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
		file_size_limit bigint, allowed_mime_types text[]
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
`;

export class QualityCheckExitError extends Error {
	constructor(exitCode) {
		super("Repository quality checks failed");
		this.name = "QualityCheckExitError";
		this.exitCode = exitCode;
	}
}

export function createDisposableDatabaseName(randomBytesImplementation = randomBytes) {
	return `${DISPOSABLE_DATABASE_PREFIX}${randomBytesImplementation(12).toString("hex")}`;
}

export function assertSafeDisposableDatabaseName(databaseName, sourceDatabaseName) {
	if (
		!DISPOSABLE_DATABASE_PATTERN.test(databaseName) ||
		databaseName.length > 63 ||
		PROTECTED_DATABASE_NAMES.has(databaseName) ||
		databaseName === sourceDatabaseName
	) {
		throw new Error("Refusing operation without an exact safe disposable database name");
	}
}

export function parseSourceDatabaseUrl(value) {
	const sourceUrl = value?.trim();
	if (sourceUrl === undefined || sourceUrl.length === 0) {
		throw new Error("S10_ADMIN_DATABASE_URL is required as an explicit admin/source URL");
	}
	let parsed;
	try {
		parsed = new URL(sourceUrl);
	} catch {
		throw new Error("S10_ADMIN_DATABASE_URL must be a PostgreSQL URL");
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new Error("S10_ADMIN_DATABASE_URL must be a PostgreSQL URL");
	}
	const identityParameter = [...parsed.searchParams.keys()].find((parameter) =>
		CONNECTION_IDENTITY_PARAMETERS.has(parameter.toLowerCase())
	);
	if (identityParameter !== undefined) {
		throw new Error("S10_ADMIN_DATABASE_URL must not override connection identity");
	}
	let databaseName;
	try {
		databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
	} catch {
		throw new Error("S10_ADMIN_DATABASE_URL must name a source database");
	}
	if (databaseName.length === 0 || databaseName.length > 63 || databaseName.includes("/")) {
		throw new Error("S10_ADMIN_DATABASE_URL must name a source database");
	}
	return { sourceUrl: parsed.toString(), sourceDatabaseName: databaseName };
}

export function buildCheckEnvironment(environment, targetUrl) {
	const result = { ...environment, S10_TEST_DATABASE_URL: targetUrl };
	delete result.S10_ADMIN_DATABASE_URL;
	return result;
}

export function removeClusterRoleMutations(migrationSql) {
	const withoutRoleCreation = migrationSql.replace(S10_ROLE_CREATION_MUTATION, "");
	if (withoutRoleCreation === migrationSql) {
		throw new Error("The S-10 migration role safety contract changed");
	}
	const safeMigration = withoutRoleCreation.replace(S10_ROLE_MEMBERSHIP_MUTATION, "");
	if (safeMigration === withoutRoleCreation) {
		throw new Error("The S-10 migration role safety contract changed");
	}
	if (
		/\b(?:CREATE|ALTER|DROP)\s+ROLE\b/iu.test(safeMigration) ||
		/\bGRANT\s+s10_migration_owner\s+TO\s+postgres\b/iu.test(safeMigration)
	) {
		throw new Error("The S-10 migration role safety contract changed");
	}
	return safeMigration;
}

export async function withDisposableS10Database(input) {
	const { sourceUrl, sourceDatabaseName } = parseSourceDatabaseUrl(input.sourceUrl);
	const adapter = input.adapter ?? createPostgresAdapter();
	const databaseName = createDisposableDatabaseName(input.randomBytesImplementation);
	assertSafeDisposableDatabaseName(databaseName, sourceDatabaseName);
	const targetUrl = databaseUrlForName(sourceUrl, databaseName);
	if (!(await adapter.databaseExists(sourceUrl, sourceDatabaseName))) {
		throw new Error("The configured source database is unavailable");
	}
	if (await adapter.databaseExists(sourceUrl, databaseName)) {
		throw new Error("A generated disposable database unexpectedly already exists");
	}
	const initialClusterRoleState = await adapter.inspectClusterRoleState(sourceUrl);
	if (!initialClusterRoleState.prerequisitesReady) {
		throw new Error("The configured cluster is missing S-10 role prerequisites");
	}

	let settleCreation;
	const creationSettled = new Promise((resolve) => {
		settleCreation = resolve;
	});
	let teardownPromise;
	const teardown = async () => {
		if (teardownPromise !== undefined) return await teardownPromise;
		teardownPromise = (async () => {
			let teardownError;
			try {
				await creationSettled;
				assertSafeDisposableDatabaseName(databaseName, sourceDatabaseName);
				if (await adapter.databaseExists(sourceUrl, databaseName)) {
					await adapter.dropDatabase(sourceUrl, databaseName, sourceDatabaseName);
				}
			} catch {
				teardownError = new Error("Disposable database cleanup failed");
			}
			try {
				if (!(await adapter.databaseExists(sourceUrl, sourceDatabaseName))) {
					teardownError ??= new Error("The source database is unavailable after quality checks");
				}
			} catch {
				teardownError ??= new Error("The source database is unavailable after quality checks");
			}
			try {
				if (await adapter.databaseExists(sourceUrl, databaseName)) {
					teardownError ??= new Error("Disposable database cleanup verification failed");
				}
			} catch {
				teardownError ??= new Error("Disposable database cleanup verification failed");
			}
			try {
				const finalClusterRoleState = await adapter.inspectClusterRoleState(sourceUrl);
				if (
					!finalClusterRoleState.prerequisitesReady ||
					finalClusterRoleState.fingerprint !== initialClusterRoleState.fingerprint
				) {
					teardownError ??= new Error(
						"Database cluster role or membership state changed during quality checks"
					);
				}
			} catch {
				teardownError ??= new Error("Database cluster role safety verification failed");
			}
			if (teardownError !== undefined) throw teardownError;
		})();
		return await teardownPromise;
	};
	input.onCleanupReady?.(teardown);

	let primaryError;
	try {
		try {
			await adapter.createDatabase(sourceUrl, databaseName, sourceDatabaseName);
		} finally {
			settleCreation();
		}
		await adapter.prepareDatabase(targetUrl, sourceDatabaseName, databaseName);
		if (!(await adapter.databaseExists(sourceUrl, sourceDatabaseName))) {
			throw new Error("The source database became unavailable during quality setup");
		}
		if (!(await adapter.databaseExists(sourceUrl, databaseName))) {
			throw new Error("The disposable database is unavailable during quality checks");
		}
		const exitCode = await input.check(targetUrl, databaseName);
		if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
			throw new Error("The repository quality command returned an invalid exit code");
		}
		if (exitCode !== 0) throw new QualityCheckExitError(exitCode);
	} catch (error) {
		primaryError = sanitizeFailure(error);
	}

	try {
		await teardown();
	} finally {
		input.onCleanupReady?.(undefined);
	}
	if (primaryError !== undefined) throw primaryError;
	return 0;
}

export function createPostgresAdapter() {
	return {
		async inspectClusterRoleState(connectionUrl) {
			const output = await runCaptured(
				"psql",
				[connectionUrl, "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-q", "-c", CLUSTER_ROLE_STATE_SQL],
				"cluster role safety inspection"
			);
			const match = /^(ready|missing):([0-9a-f]{32})$/u.exec(output.trim());
			if (match === null) {
				throw new Error("Database cluster role safety inspection returned an invalid result");
			}
			return { prerequisitesReady: match[1] === "ready", fingerprint: match[2] };
		},
		async databaseExists(connectionUrl, databaseName) {
			const output = await runCaptured(
				"psql",
				[
					connectionUrl,
					"-v",
					"ON_ERROR_STOP=1",
					"-X",
					"-A",
					"-t",
					"-q",
					"-c",
					`SELECT 1 FROM pg_database WHERE datname = ${sqlLiteral(databaseName)}`,
				],
				"database availability check"
			);
			return output.trim() === "1";
		},
		async createDatabase(connectionUrl, databaseName, sourceDatabaseName) {
			assertSafeDisposableDatabaseName(databaseName, sourceDatabaseName);
			await runCaptured(
				"psql",
				[
					connectionUrl,
					"-v",
					"ON_ERROR_STOP=1",
					"-X",
					"-q",
					"-c",
					`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0`,
				],
				"disposable database creation"
			);
		},
		async prepareDatabase(targetUrl) {
			await runCaptured(
				"psql",
				[targetUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-c", S10_BOOTSTRAP_SQL],
				"S-10 platform contract bootstrap"
			);
			for (const relativeFile of S10_DATABASE_FILES) {
				if (relativeFile === S10_FOUNDATION_MIGRATION) {
					const migrationSql = await readFile(path.join(REPOSITORY_ROOT, relativeFile), "utf8");
					await runCaptured(
						"psql",
						[targetUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "-"],
						"S-10 repository database preparation",
						removeClusterRoleMutations(migrationSql)
					);
				} else {
					await runCaptured(
						"psql",
						[
							targetUrl,
							"-v",
							"ON_ERROR_STOP=1",
							"-X",
							"-q",
							"-f",
							path.join(REPOSITORY_ROOT, relativeFile),
						],
						"S-10 repository database preparation"
					);
				}
			}
			const result = await runCaptured(
				"psql",
				[
					targetUrl,
					"-v",
					"ON_ERROR_STOP=1",
					"-X",
					"-A",
					"-t",
					"-q",
					"-c",
					"SELECT (to_regprocedure('public.commit_import_internal(uuid,text,text,text,jsonb,text)') IS NOT NULL AND (SELECT count(*) = 100 FROM public.cards))::text",
				],
				"S-10 repository contract verification"
			);
			if (result.trim() !== "true") {
				throw new Error("The disposable S-10 database contract is incomplete");
			}
		},
		async dropDatabase(connectionUrl, databaseName, sourceDatabaseName) {
			assertSafeDisposableDatabaseName(databaseName, sourceDatabaseName);
			await runCaptured(
				"psql",
				[
					connectionUrl,
					"-v",
					"ON_ERROR_STOP=1",
					"-X",
					"-q",
					"-c",
					`DROP DATABASE ${quoteIdentifier(databaseName)} WITH (FORCE)`,
				],
				"disposable database cleanup"
			);
		},
		async countDatabasesByPrefix(connectionUrl) {
			const output = await runCaptured(
				"psql",
				[
					connectionUrl,
					"-v",
					"ON_ERROR_STOP=1",
					"-X",
					"-A",
					"-t",
					"-q",
					"-c",
					`SELECT count(*) FROM pg_database WHERE datname LIKE ${sqlLiteral(`${DISPOSABLE_DATABASE_PREFIX}%`)}`,
				],
				"disposable database residue check"
			);
			return Number(output.trim());
		},
	};
}

function databaseUrlForName(sourceUrl, databaseName) {
	const parsed = new URL(sourceUrl);
	parsed.pathname = `/${databaseName}`;
	return parsed.toString();
}

function quoteIdentifier(value) {
	return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

function sanitizeFailure(error) {
	if (error instanceof QualityCheckExitError) return error;
	if (error instanceof Error && error.message.startsWith("The ")) return new Error(error.message);
	if (error instanceof Error && error.message.startsWith("Disposable ")) {
		return new Error(error.message);
	}
	if (error instanceof Error && error.message.startsWith("Repository ")) {
		return new Error(error.message);
	}
	if (error instanceof Error && error.message.startsWith("Database command ")) {
		return new Error(error.message);
	}
	return new Error("Repository quality database execution failed");
}

async function runCaptured(program, arguments_, stage, standardInput) {
	return await new Promise((resolve, reject) => {
		const child = spawn(program, arguments_, {
			stdio: [standardInput === undefined ? "ignore" : "pipe", "pipe", "ignore"],
			env: { ...process.env, PGAPPNAME: "kanji-everyday-quality" },
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (stdout.length > 1024 * 1024) child.kill("SIGKILL");
		});
		if (standardInput !== undefined) {
			child.stdin.on("error", () => undefined);
			child.stdin.end(standardInput);
		}
		child.once("error", () => reject(new Error(`Database command unavailable during ${stage}`)));
		child.once("close", (code, signal) => {
			if (code === 0 && signal === null) resolve(stdout);
			else reject(new Error(`Database command failed during ${stage}`));
		});
	});
}
