import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	QualityCheckExitError,
	buildCheckEnvironment,
	createPostgresAdapter,
	createQualityRunScope,
	parseDisposableDatabaseName,
	parseSourceDatabaseUrl,
	withDisposableS10Database,
} from "./quality-database.mjs";

export function createTerminationHandler({
	getCleanup,
	exit,
	reportFailure = () => process.stderr.write("quality_database: failed\n"),
}) {
	let terminating = false;
	return async (signal) => {
		if (terminating) return;
		terminating = true;
		try {
			await getCleanup()?.();
		} catch {
			try {
				reportFailure();
			} finally {
				exit(1);
			}
			return;
		}
		exit(signal === "SIGINT" ? 130 : 143);
	};
}

export function resolveProcessExitCode(code, signal) {
	if (signal === "SIGINT") return 130;
	if (signal === "SIGTERM") return 143;
	return code ?? 1;
}

export async function runActiveCleanups(activeCleanups) {
	let firstError;
	for (const cleanup of [...activeCleanups].reverse()) {
		try {
			await cleanup();
		} catch (error) {
			firstError ??= error;
		}
	}
	if (firstError !== undefined) throw firstError;
}

export async function reconcileRunScopedResidue({
	currentScope,
	sourceDatabaseName,
	listDatabaseNames,
	isRunScopeActive,
	dropDatabase,
}) {
	const namesByScope = new Map();
	for (const databaseName of await listDatabaseNames()) {
		const parsed = parseDisposableDatabaseName(databaseName);
		if (parsed === undefined) continue;
		const names = namesByScope.get(parsed.runScope) ?? [];
		names.push(databaseName);
		namesByScope.set(parsed.runScope, names);
	}
	for (const [runScope, databaseNames] of namesByScope) {
		if (runScope === currentScope || (await isRunScopeActive(runScope))) continue;
		for (const databaseName of databaseNames) {
			await dropDatabase(databaseName, sourceDatabaseName);
		}
	}
}

export async function assertNoCurrentRunResidue(currentScope, listDatabaseNames) {
	const remains = (await listDatabaseNames()).some(
		(name) => parseDisposableDatabaseName(name)?.runScope === currentScope
	);
	if (remains) throw new Error("Disposable database cleanup verification failed");
}

export async function runRepositoryQuality() {
	const activeCleanups = new Set();
	const sourceUrl = process.env.S10_ADMIN_DATABASE_URL;
	let sourceDatabaseName;
	try {
		({ sourceDatabaseName } = parseSourceDatabaseUrl(sourceUrl));
	} catch {
		process.stderr.write("quality_database: failed\n");
		return 1;
	}
	const adapter = createPostgresAdapter();
	const runScope = createQualityRunScope();
	const terminate = createTerminationHandler({
		getCleanup: () => async () => await runActiveCleanups(activeCleanups),
		exit: (exitCode) => process.exit(exitCode),
	});
	process.on("SIGINT", terminate);
	process.on("SIGTERM", terminate);
	const residueInput = {
		currentScope: runScope,
		sourceDatabaseName,
		listDatabaseNames: async () => await adapter.listDatabaseNames(sourceUrl),
		isRunScopeActive: async (scope) => await adapter.isRunScopeActive(sourceUrl, scope),
		dropDatabase: async (name) => await adapter.dropDatabase(sourceUrl, name, sourceDatabaseName),
	};
	let releaseLease;
	let auditCleanup;
	try {
		await reconcileRunScopedResidue(residueInput);
		await assertNoCurrentRunResidue(runScope, residueInput.listDatabaseNames);
		releaseLease = await adapter.acquireRunLease(sourceUrl, runScope);
		activeCleanups.add(releaseLease);
		auditCleanup = async () => {
			await reconcileRunScopedResidue(residueInput);
			await assertNoCurrentRunResidue(runScope, residueInput.listDatabaseNames);
		};
		activeCleanups.add(auditCleanup);
		await withDisposableS10Database({
			sourceUrl,
			adapter,
			runScope,
			onCleanupReady: cleanupRegistration(activeCleanups),
			check: async (freshUrl) =>
				await withDisposableS10Database({
					sourceUrl,
					adapter,
					runScope,
					onCleanupReady: cleanupRegistration(activeCleanups),
					check: async (upgradeUrl) =>
						await withDisposableS10Database({
							sourceUrl,
							adapter,
							runScope,
							onCleanupReady: cleanupRegistration(activeCleanups),
							check: async (failureUrl) =>
								await runQualityPhases({ freshUrl, upgradeUrl, failureUrl }),
						}),
				}),
		});
		await auditCleanup();
		return 0;
	} catch (error) {
		if (error instanceof QualityCheckExitError) return error.exitCode;
		process.stderr.write("quality_database: failed\n");
		return 1;
	} finally {
		if (auditCleanup !== undefined) activeCleanups.delete(auditCleanup);
		if (releaseLease !== undefined) {
			activeCleanups.delete(releaseLease);
			await releaseLease().catch(() => undefined);
		}
		process.off("SIGINT", terminate);
		process.off("SIGTERM", terminate);
	}
}

function cleanupRegistration(activeCleanups) {
	let current;
	return (cleanup) => {
		if (current !== undefined) activeCleanups.delete(current);
		current = cleanup;
		if (cleanup !== undefined) activeCleanups.add(cleanup);
	};
}

async function runQualityPhases({ freshUrl, upgradeUrl, failureUrl }) {
	const checkEnvironment = {
		// Keep legacy S-10 integration on the rollback-verified S-10 target;
		// S-11 DB gates use their explicit fresh/upgrade URLs below.
		...buildCheckEnvironment(process.env, failureUrl),
		S11_FRESH_DATABASE_URL: freshUrl,
		S11_UPGRADE_DATABASE_URL: upgradeUrl,
		S11_FAILURE_DATABASE_URL: failureUrl,
		S11_LOCAL_DATABASE_URL: freshUrl,
		S11_LOCAL_CORE_ONLY: "1",
	};
	const phases = [
		["S-11 local core fresh migration", "npm", ["--prefix", "frontend", "run", "test:s11:fresh"], checkEnvironment],
		["S-11 local core upgrade migration", "npm", ["--prefix", "frontend", "run", "test:s11:upgrade"], checkEnvironment],
		["S-11 local core failure rollback", "npm", ["--prefix", "frontend", "run", "test:s11:failure"], checkEnvironment],
		["S-11 local real PostgreSQL integration", "npm", ["--prefix", "frontend", "run", "test:s11:local-real-integration"], checkEnvironment],
		["frontend lint", "npm", ["--prefix", "frontend", "run", "lint"], checkEnvironment],
		[
			"frontend typecheck",
			"npm",
			["--prefix", "frontend", "run", "typecheck"],
			checkEnvironment,
		],
		[
			"configured frontend production build",
			"npm",
			["--prefix", "frontend", "run", "build"],
			{
				...checkEnvironment,
				NEXT_PUBLIC_SUPABASE_URL:
					checkEnvironment.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
				NEXT_PUBLIC_SUPABASE_ANON_KEY:
					checkEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "quality-build-anon-key",
				SUPABASE_SERVICE_ROLE_KEY:
					checkEnvironment.SUPABASE_SERVICE_ROLE_KEY ?? "quality-build-service-role-key",
			},
		],
		[
			"complete ordinary Vitest",
			"npm",
			["--prefix", "frontend", "run", "test"],
			checkEnvironment,
		],
		[
			"S-11 inventory",
			"npm",
			["--prefix", "frontend", "run", "test:s11:inventory"],
			checkEnvironment,
		],
		[
			"S-11 focused 51 regressions",
			"npm",
			[
				"--prefix",
				"frontend",
				"run",
				"test:s11:integration",
				"--",
				"-t",
				"R[789]-F|R10-(R[12]-)?F|R11-(R2-)?F[12]|R12-F|R13-F|R14-F",
			],
			checkEnvironment,
		],
		["diff whitespace validation", "git", ["diff", "--check"], checkEnvironment],
	];
	for (const [label, program, arguments_, environment] of phases) {
		process.stdout.write(`=== ${label} ===\n`);
		const exitCode = await runCommand(program, arguments_, environment);
		if (exitCode !== 0) return exitCode;
	}
	process.stdout.write("Repository quality checks passed.\n");
	return 0;
}

export async function runCommand(program, arguments_, environment) {
	return await new Promise((resolve) => {
		const child = spawn(program, arguments_, { stdio: "inherit", env: environment });
		child.once("error", () => resolve(1));
		child.once("close", (code, signal) => resolve(resolveProcessExitCode(code, signal)));
	});
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
	process.exitCode = await runRepositoryQuality();
}
