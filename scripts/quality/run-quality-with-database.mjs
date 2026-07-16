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
import {
	readReleaseContract,
	validateReleaseContractDefinition,
} from "./release-contract.mjs";

const POST_CLEANUP_LOCAL_GATE_IDS = new Set(["database-residue", "source-continuity"]);

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

const QUALITY_BASE_REF_PATTERN = /^(?!.*(?:\.\.|@\{|\/\/))[A-Za-z0-9][A-Za-z0-9._\/-]{0,255}$/u;
const FULL_SHA1_PATTERN = /^[0-9a-f]{40}$/iu;
const HEX_OBJECT_ID_PATTERN = /^[0-9a-f]+$/iu;
const RESOLVED_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RESOLVED_REF_PATTERN = /^refs\/(?!.*(?:\.\.|@\{|\/\/))[A-Za-z0-9][A-Za-z0-9._\/-]{0,255}$/u;

export async function resolveQualityDiffBase(
	environment = process.env,
	resolvers = {}
) {
	const resolveFullCommit = resolvers.resolveFullCommit ?? resolveGitFullCommit;
	const resolveRef = resolvers.resolveRef ?? resolveGitRefCommit;
	const configuredInput = environment.QUALITY_DIFF_BASE;
	if (configuredInput !== undefined) {
		const configured = configuredInput.trim();
		if (configured.length === 0) {
			throw new Error("Invalid quality diff base");
		}
		if (HEX_OBJECT_ID_PATTERN.test(configured)) {
			if (!FULL_SHA1_PATTERN.test(configured)) throw new Error("Invalid quality diff base");
			const canonicalCommit = configured.toLowerCase();
			const resolved = await resolveFullCommit(canonicalCommit);
			if (resolved !== canonicalCommit) throw new Error("Unable to resolve quality diff base");
			return resolved;
		}
		if (!QUALITY_BASE_REF_PATTERN.test(configured)) throw new Error("Invalid quality diff base");
		const resolved = await resolveRef(configured);
		if (resolved === undefined) throw new Error("Unable to resolve quality diff base");
		return resolved;
	}
	for (const candidate of ["origin/main", "main"]) {
		const resolved = await resolveRef(candidate);
		if (resolved !== undefined) return resolved;
	}
	throw new Error("Unable to resolve quality diff base");
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
	let postCleanupPhases;
	try {
		const diffBase = await resolveQualityDiffBase(process.env);
		const releaseContract = await readReleaseContract();
		const preflightFailures = validateReleaseContractDefinition(releaseContract, {
			expectedBaseSha: diffBase,
		});
		if (preflightFailures.length > 0) {
			process.stderr.write(`${JSON.stringify({ gate: "s11-release-contract-preflight", status: "blocked", failures: preflightFailures })}\n`);
			return 2;
		}
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
							check: async (failureUrl) => {
								const plan = buildContractLocalQualityPhases({
									contract: releaseContract,
									diffBase,
									sourceEnvironment: process.env,
									freshUrl,
									upgradeUrl,
									failureUrl,
								});
								postCleanupPhases = plan.postCleanup;
								return await runQualityPhaseSequence(plan.databaseScoped);
							},
						}),
				}),
		});
		await auditCleanup();
		if (postCleanupPhases === undefined) throw new Error("Repository local quality plan was not dispatched");
		const postCleanupExitCode = await runQualityPhaseSequence(postCleanupPhases);
		if (postCleanupExitCode !== 0) return postCleanupExitCode;
		await auditCleanup();
		process.stdout.write("Repository local quality checks passed.\n");
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

export function buildContractLocalQualityPhases({
	contract,
	diffBase,
	sourceEnvironment,
	freshUrl,
	upgradeUrl,
	failureUrl,
}) {
	if (!RESOLVED_COMMIT_SHA_PATTERN.test(diffBase)) throw new Error("Invalid resolved quality diff base");
	const checkEnvironment = {
		// Keep legacy S-10 integration on the rollback-verified S-10 target;
		// S-11 DB gates use their explicit fresh/upgrade URLs below.
		...buildCheckEnvironment(sourceEnvironment, failureUrl),
		S11_FRESH_DATABASE_URL: freshUrl,
		S11_UPGRADE_DATABASE_URL: upgradeUrl,
		S11_FAILURE_DATABASE_URL: failureUrl,
		S11_LOCAL_DATABASE_URL: freshUrl,
		S11_LOCAL_CORE_ONLY: "1",
	};
	const buildEnvironment = {
		...checkEnvironment,
		NEXT_PUBLIC_SUPABASE_URL:
			checkEnvironment.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
		NEXT_PUBLIC_SUPABASE_ANON_KEY:
			checkEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "quality-build-anon-key",
		SUPABASE_SERVICE_ROLE_KEY:
			checkEnvironment.SUPABASE_SERVICE_ROLE_KEY ?? "quality-build-service-role-key",
	};
	const phases = contract.localGates.map((gate) => {
		const [program, ...declaredArguments] = gate.command;
		const arguments_ = declaredArguments.map((argument) =>
			argument === "BASE...HEAD" ? `${diffBase}...HEAD` : argument
		);
		const environment = gate.id === "build"
			? buildEnvironment
			: new Set(["quality-database-harness", "database-residue", "source-continuity"]).has(gate.id)
				? sourceEnvironment
				: checkEnvironment;
		return [gate.id, program, arguments_, environment];
	});
	const firstPostCleanupIndex = phases.findIndex(([id]) => POST_CLEANUP_LOCAL_GATE_IDS.has(id));
	if (firstPostCleanupIndex < 0 ||
		phases.slice(firstPostCleanupIndex).some(([id]) => !POST_CLEANUP_LOCAL_GATE_IDS.has(id)) ||
		phases.length - firstPostCleanupIndex !== POST_CLEANUP_LOCAL_GATE_IDS.size) {
		throw new Error("Release contract post-cleanup gate order drifted");
	}
	return {
		databaseScoped: phases.slice(0, firstPostCleanupIndex),
		postCleanup: phases.slice(firstPostCleanupIndex),
	};
}

export async function runQualityPhaseSequence(phases, commandRunner = runCommand) {
	for (const [label, program, arguments_, environment] of phases) {
		process.stdout.write(`=== ${label} ===\n`);
		const exitCode = await commandRunner(program, arguments_, environment);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
}

async function resolveGitCommit(ref) {
	return await resolveSingleGitLine(
		["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
		RESOLVED_COMMIT_SHA_PATTERN
	);
}

async function resolveGitFullCommit(commit) {
	return await resolveGitCommit(commit);
}

async function resolveGitRefCommit(ref) {
	let candidates;
	if (ref === "HEAD") {
		const symbolicHead = await resolveSingleGitLine(
			["symbolic-ref", "--quiet", "HEAD"],
			RESOLVED_REF_PATTERN
		);
		if (symbolicHead === undefined) return undefined;
		candidates = [symbolicHead];
	} else if (ref.startsWith("refs/")) {
		candidates = [ref];
	} else {
		candidates = [
			`refs/${ref}`,
			`refs/tags/${ref}`,
			`refs/heads/${ref}`,
			`refs/remotes/${ref}`,
			`refs/remotes/${ref}/HEAD`,
		];
	}
	const existingRefs = await listGitRefs();
	if (existingRefs === undefined) return undefined;
	const matches = [...new Set(candidates)].filter((candidate) => existingRefs.has(candidate));
	if (matches.length > 1) throw new Error("Ambiguous quality diff base");
	if (matches.length === 0) return undefined;
	return await resolveGitCommit(matches[0]);
}

async function listGitRefs() {
	return await new Promise((resolve) => {
		const child = spawn("git", ["for-each-ref", "--format=%(refname)"], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.once("error", () => resolve(undefined));
		child.once("close", (code, signal) => {
			if (code !== 0 || signal !== null) {
				resolve(undefined);
				return;
			}
			const refs = output.split("\n").filter((value) => value.length > 0);
			resolve(refs.every((value) => RESOLVED_REF_PATTERN.test(value)) ? new Set(refs) : undefined);
		});
	});
}

async function resolveSingleGitLine(arguments_, outputPattern) {
	return await new Promise((resolve) => {
		const child = spawn("git", arguments_, {
			stdio: ["ignore", "pipe", "ignore"],
		});
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.once("error", () => resolve(undefined));
		child.once("close", (code, signal) => {
			const value = output.trim();
			resolve(code === 0 && signal === null && outputPattern.test(value) ? value : undefined);
		});
	});
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
