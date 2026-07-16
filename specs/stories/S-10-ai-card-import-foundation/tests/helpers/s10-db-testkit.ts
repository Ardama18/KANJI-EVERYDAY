import { execFile, spawn, type ChildProcess } from "node:child_process";

export const S10_DB_STATEMENT_TIMEOUT_MS = 10_000;
export const S10_DB_LOCK_TIMEOUT_MS = 5_000;
export const S10_DB_PROCESS_TIMEOUT_MS = 12_000;
export const S10_DB_TEST_TIMEOUT_MS = 30_000;

export type S10ActorKind = "ownerA" | "ownerB" | "anonymous" | "service";

export interface S10Actor {
	kind: S10ActorKind;
	role: "authenticated" | "anon" | "service_role";
	userId: string | null;
}

export interface S10ExecutionContext {
	actor?: S10Actor;
	testClock?: string;
	failpoint?: string;
}

export interface S10SnapshotQuery {
	name: string;
	sql: string;
}

export interface S10Snapshot {
	readonly entries: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

export type S10JsonSnapshot = unknown;

export interface S10DatabaseErrorDiagnostic {
	readonly sqlState: string | null;
	readonly constraint: string | null;
	readonly detail?: string;
}

export interface S10ProcessRuntime {
	readonly executable?: string;
	readonly arguments?: readonly string[];
	readonly timeoutMs?: number;
	readonly onSpawn?: (child: ChildProcess) => void;
}

export interface S10DbClient {
	databaseUrl: string;
	execute(sql: string, context?: S10ExecutionContext): Promise<void>;
	query<T extends Record<string, unknown>>(
		sql: string,
		context?: S10ExecutionContext
	): Promise<T[]>;
	captureError(
		sql: string,
		context?: S10ExecutionContext
	): Promise<S10DatabaseErrorDiagnostic>;
	settle(
		sql: string,
		context?: S10ExecutionContext
	): Promise<S10DatabaseErrorDiagnostic | null>;
}

export const S10_ACTORS = {
	ownerA: {
		kind: "ownerA",
		role: "authenticated",
		userId: "10000000-0000-4000-8000-00000000000a",
	},
	ownerB: {
		kind: "ownerB",
		role: "authenticated",
		userId: "10000000-0000-4000-8000-00000000000b",
	},
	anonymous: { kind: "anonymous", role: "anon", userId: null },
	service: { kind: "service", role: "service_role", userId: null },
} as const satisfies Record<S10ActorKind, S10Actor>;

export class S10DatabaseCommandError extends Error {
	readonly exitCode: number | null;

	constructor(exitCode: number | null, diagnostic?: string) {
		const detail = diagnostic?.trim();
		super(
			detail === undefined || detail.length === 0
				? "S-10 database command failed; inspect the isolated test database logs"
				: `S-10 database command failed: ${detail.slice(0, 2000)}`
		);
		this.name = "S10DatabaseCommandError";
		this.exitCode = exitCode;
	}
}

export function requireS10TestDatabaseUrl(
	environment: Readonly<Record<string, string | undefined>> = process.env
): string {
	const databaseUrl = environment.S10_TEST_DATABASE_URL?.trim();
	if (databaseUrl === undefined || databaseUrl.length === 0) {
		throw new Error("S10_TEST_DATABASE_URL is required for S-10 database tests");
	}
	return databaseUrl;
}

export function createS10DbClient(
	databaseUrl = requireS10TestDatabaseUrl(),
	processRuntime?: S10ProcessRuntime
): S10DbClient {
	return {
		databaseUrl,
		async execute(sql: string, context?: S10ExecutionContext): Promise<void> {
			await runS10Psql(databaseUrl, buildContextSql(sql, context), processRuntime);
		},
		async query<T extends Record<string, unknown>>(
			sql: string,
			context?: S10ExecutionContext
		): Promise<T[]> {
			const query = trimTrailingSemicolon(sql);
			const wrapped = `
				WITH result_row AS (${query})
				SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text
				FROM result_row
			`;
			const output = await runS10Psql(
				databaseUrl,
				buildContextSql(wrapped, context),
				processRuntime
			);
			return parseRows<T>(output.trim());
		},
		async captureError(
			sql: string,
			context?: S10ExecutionContext
		): Promise<S10DatabaseErrorDiagnostic> {
			return await capturePsqlError(databaseUrl, buildContextSql(sql, context), processRuntime);
		},
		async settle(
			sql: string,
			context?: S10ExecutionContext
		): Promise<S10DatabaseErrorDiagnostic | null> {
			return await settlePsql(databaseUrl, buildContextSql(sql, context), processRuntime);
		},
	};
}

/**
 * Vitest test timeouts do not cancel an already-running Promise. Keep the
 * operation and its marker cleanup in one Promise so the next snapshot is not
 * exposed until both have settled. The psql boundary below is independently
 * bounded so this scope rejects before the enclosing DB test timeout.
 */
export async function runS10SettledTestScope<T>(
	operation: () => Promise<T>,
	cleanup: () => Promise<void>
): Promise<T> {
	try {
		return await operation();
	} finally {
		await cleanup();
	}
}

export async function ensureS10ActorFixtures(client: S10DbClient): Promise<void> {
	await client.execute(`
		INSERT INTO auth.users (
			id,
			instance_id,
			aud,
			role,
			email,
			encrypted_password,
			email_confirmed_at,
			raw_app_meta_data,
			raw_user_meta_data,
			created_at,
			updated_at
		)
		VALUES
			(
				'${S10_ACTORS.ownerA.userId}'::uuid,
				'00000000-0000-0000-0000-000000000000'::uuid,
				'authenticated',
				'authenticated',
				's10-owner-a@example.local',
				's10-test-not-for-login',
				now(),
				'{"provider":"email","providers":["email"]}'::jsonb,
				'{}'::jsonb,
				now(),
				now()
			),
			(
				'${S10_ACTORS.ownerB.userId}'::uuid,
				'00000000-0000-0000-0000-000000000000'::uuid,
				'authenticated',
				'authenticated',
				's10-owner-b@example.local',
				's10-test-not-for-login',
				now(),
				'{"provider":"email","providers":["email"]}'::jsonb,
				'{}'::jsonb,
				now(),
				now()
			)
		ON CONFLICT (id) DO NOTHING
	`);
}

export async function captureS10Snapshot(
	client: S10DbClient,
	queries: readonly S10SnapshotQuery[]
): Promise<S10Snapshot> {
	const entries: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
	for (const query of queries) {
		entries[query.name] = await client.query(query.sql);
	}
	return { entries };
}

export async function captureS10SeedGeneralSnapshot(
	client: S10DbClient
): Promise<S10JsonSnapshot> {
	const rows = await client.query<{ snapshot: S10JsonSnapshot }>(`
		SELECT jsonb_build_object(
			'cards', COALESCE((
				SELECT jsonb_agg(to_jsonb(seed_card) ORDER BY seed_card.id)
				FROM (
					SELECT id::text, owner_user_id::text, visibility, skill, pattern,
						front_text, back_text, illustration_key
					FROM public.cards WHERE visibility = 'public'
				) AS seed_card
			), '[]'::jsonb),
			'decks', COALESCE((
				SELECT jsonb_agg(to_jsonb(seed_deck) ORDER BY seed_deck.id)
				FROM (
					SELECT id::text, owner_user_id::text, name, new_limit_per_day
					FROM public.decks
				) AS seed_deck
			), '[]'::jsonb),
			'deckCards', COALESCE((
				SELECT jsonb_agg(to_jsonb(seed_relation) ORDER BY seed_relation.deck_id, seed_relation.card_id)
				FROM (
					SELECT deck_id::text, card_id::text FROM public.deck_cards
				) AS seed_relation
			), '[]'::jsonb),
			'counts', jsonb_build_object(
				'cards', (SELECT count(*) FROM public.cards WHERE visibility = 'public'),
				'decks', (SELECT count(*) FROM public.decks),
				'deckCards', (SELECT count(*) FROM public.deck_cards)
			)
		) AS snapshot
	`);
	const snapshot = rows[0]?.snapshot;
	if (snapshot === undefined) {
		throw new Error("S-10 seed general snapshot query returned no row");
	}
	return snapshot;
}

export async function captureS10SeedKeySnapshot(
	client: S10DbClient
): Promise<S10JsonSnapshot> {
	const rows = await client.query<{ snapshot: S10JsonSnapshot }>(`
		SELECT COALESCE(jsonb_agg(to_jsonb(seed_key) ORDER BY seed_key.id), '[]'::jsonb) AS snapshot
		FROM (
			SELECT id::text, card_key FROM public.cards WHERE visibility = 'public'
		) AS seed_key
	`);
	const snapshot = rows[0]?.snapshot;
	if (snapshot === undefined) {
		throw new Error("S-10 seed key snapshot query returned no row");
	}
	return snapshot;
}

export async function runWithS10Connections<T>(
	connectionCount: number,
	operation: (client: S10DbClient, connectionIndex: number) => Promise<T>,
	databaseUrl = requireS10TestDatabaseUrl()
): Promise<T[]> {
	if (!Number.isInteger(connectionCount) || connectionCount < 1) {
		throw new Error("connectionCount must be a positive integer");
	}
	return await Promise.all(
		Array.from({ length: connectionCount }, (_, index) =>
			operation(createS10DbClient(databaseUrl), index)
		)
	);
}

export function sqlLiteral(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

function trimTrailingSemicolon(sql: string): string {
	return sql.trim().replace(/;\s*$/u, "");
}

function buildContextSql(sql: string, context?: S10ExecutionContext): string {
	const statement = trimTrailingSemicolon(sql);
	if (context === undefined) {
		return statement;
	}
	const settings = [
		context.testClock === undefined
			? ""
			: `SET LOCAL app.s10_test_now = ${sqlLiteral(context.testClock)};`,
		context.failpoint === undefined
			? ""
			: `SET LOCAL app.s10_failpoint = ${sqlLiteral(context.failpoint)};`,
	].join("\n");
	const actor = context.actor;
	const actorSettings =
		actor === undefined
			? ""
			: `
				SET LOCAL ROLE ${actor.role};
				SET LOCAL request.jwt.claim.role = ${sqlLiteral(actor.role)};
				SET LOCAL request.jwt.claim.sub = ${sqlLiteral(actor.userId ?? "")};
				SET LOCAL request.jwt.claims = ${sqlLiteral(JSON.stringify({ role: actor.role, ...(actor.userId === null ? {} : { sub: actor.userId }) }))};
			`;
	return `BEGIN;\n${actorSettings}\n${settings}\n${statement};\nCOMMIT;`;
}

function parseRows<T extends Record<string, unknown>>(output: string): T[] {
	if (output.length === 0) {
		return [];
	}
	const parsed: unknown = JSON.parse(output);
	if (!Array.isArray(parsed) || parsed.some((row) => typeof row !== "object" || row === null)) {
		throw new Error("S-10 database query returned an invalid row envelope");
	}
	return parsed as T[];
}

export async function runS10Psql(
	databaseUrl: string,
	sql: string,
	processRuntime?: S10ProcessRuntime
): Promise<string> {
	return await new Promise((resolve, reject) => {
		const child = execFile(
			processRuntime?.executable ?? "psql",
			[
				...(processRuntime?.arguments ??
					[databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-q", "-c", sql]),
			],
			{
				encoding: "utf8",
				env: buildS10DatabaseCommandEnvironment("s10-ai-card-import-tests"),
				maxBuffer: 10 * 1024 * 1024,
				timeout: processRuntime?.timeoutMs ?? S10_DB_PROCESS_TIMEOUT_MS,
			},
			(error, stdout, stderr) => {
				if (error !== null) {
					const exitCode = typeof error.code === "number" ? error.code : null;
					reject(new S10DatabaseCommandError(exitCode, stderr));
					return;
				}
				resolve(stdout);
			}
		);
		processRuntime?.onSpawn?.(child);
	});
}

export async function runS10PsqlAutocommitScript(
	databaseUrl: string,
	sql: string
): Promise<string> {
	return await new Promise((resolve, reject) => {
		const child = spawn(
			"psql",
			[databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-q", "-f", "-"],
			{
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, PGAPPNAME: "s10-ai-card-import-autocommit-tests" },
			}
		);
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", () => reject(new S10DatabaseCommandError(null)));
		child.once("close", (code, signal) => {
			if (code === 0 && signal === null) resolve(stdout);
			else reject(new S10DatabaseCommandError(code, stderr));
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(sql);
	});
}

export async function runS10PsqlFile(databaseUrl: string, filePath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		execFile(
			"psql",
			[databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", filePath],
			{
				encoding: "utf8",
				env: { ...process.env, PGAPPNAME: "s10-ai-card-import-migration-job" },
				maxBuffer: 10 * 1024 * 1024,
			},
			(error) => {
				if (error !== null) {
					const exitCode = typeof error.code === "number" ? error.code : null;
					reject(new S10DatabaseCommandError(exitCode));
					return;
				}
				resolve();
			}
		);
	});
}

async function capturePsqlError(
	databaseUrl: string,
	sql: string,
	processRuntime?: S10ProcessRuntime
): Promise<S10DatabaseErrorDiagnostic> {
	return await new Promise((resolve, reject) => {
		const child = execFile(
			processRuntime?.executable ?? "psql",
			processRuntime?.arguments === undefined ? [
				databaseUrl,
				"-v",
				"ON_ERROR_STOP=1",
				"-v",
				"VERBOSITY=verbose",
				"-X",
				"-A",
				"-t",
				"-q",
				"-c",
				sql,
			] : [...processRuntime.arguments],
			{
				encoding: "utf8",
				env: buildS10DatabaseCommandEnvironment("s10-ai-card-import-tests"),
				maxBuffer: 10 * 1024 * 1024,
				timeout: processRuntime?.timeoutMs ?? S10_DB_PROCESS_TIMEOUT_MS,
			},
			(error, _stdout, stderr) => {
				if (error === null) {
					reject(new Error("S-10 database command unexpectedly succeeded"));
					return;
				}
				if (error.killed === true || (error.signal !== undefined && error.signal !== null)) {
					reject(new S10DatabaseCommandError(null, stderr));
					return;
				}
				const sqlState = /ERROR:\s+([0-9A-Z]{5}):/u.exec(stderr)?.[1] ?? null;
				const constraint =
					/CONSTRAINT NAME:\s+([^\s]+)/u.exec(stderr)?.[1] ??
					/unique constraint "([^"]+)"/u.exec(stderr)?.[1] ??
					null;
				const detail = /DETAIL:\s+([^\n]+)/u.exec(stderr)?.[1]?.trim() ?? null;
				const diagnostic: S10DatabaseErrorDiagnostic = { sqlState, constraint };
				if (detail !== null) {
					Object.defineProperty(diagnostic, "detail", {
						value: detail,
						enumerable: false,
					});
				}
				resolve(diagnostic);
			}
		);
		processRuntime?.onSpawn?.(child);
	});
}

async function settlePsql(
	databaseUrl: string,
	sql: string,
	processRuntime?: S10ProcessRuntime
): Promise<S10DatabaseErrorDiagnostic | null> {
	return await new Promise((resolve, reject) => {
		const child = execFile(
			processRuntime?.executable ?? "psql",
			[
				...(processRuntime?.arguments ?? [databaseUrl, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-X", "-A", "-t", "-q", "-c", sql]),
			],
			{
				encoding: "utf8",
				env: buildS10DatabaseCommandEnvironment("s10-ai-card-import-tests"),
				maxBuffer: 10 * 1024 * 1024,
				timeout: processRuntime?.timeoutMs ?? S10_DB_PROCESS_TIMEOUT_MS,
			},
			(error, _stdout, stderr) => {
				if (error === null) {
					resolve(null);
					return;
				}
				if (error.killed === true || (error.signal !== undefined && error.signal !== null)) {
					reject(new S10DatabaseCommandError(null, stderr));
					return;
				}
				resolve({
					sqlState: /ERROR:\s+([0-9A-Z]{5}):/u.exec(stderr)?.[1] ?? null,
					constraint: /CONSTRAINT NAME:\s+([^\s]+)/u.exec(stderr)?.[1] ?? null,
				});
			}
		);
		processRuntime?.onSpawn?.(child);
	});
}

export function buildS10DatabaseCommandEnvironment(
	applicationName: string,
	environment: Readonly<Record<string, string | undefined>> = process.env
): NodeJS.ProcessEnv {
	const inheritedOptions = environment.PGOPTIONS?.trim();
	const nodeEnvironment = environment.NODE_ENV;
	const boundedOptions = [
		`-c statement_timeout=${S10_DB_STATEMENT_TIMEOUT_MS}`,
		`-c lock_timeout=${S10_DB_LOCK_TIMEOUT_MS}`,
	].join(" ");
	return {
		...environment,
		NODE_ENV:
			nodeEnvironment === "development" || nodeEnvironment === "production"
				? nodeEnvironment
				: "test",
		PGAPPNAME: applicationName,
		PGOPTIONS:
			inheritedOptions === undefined || inheritedOptions.length === 0
				? boundedOptions
				: `${inheritedOptions} ${boundedOptions}`,
	};
}
