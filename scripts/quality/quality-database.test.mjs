import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	CLUSTER_ROLE_STATE_SQL,
	DISPOSABLE_DATABASE_PREFIX,
	QualityCheckExitError,
	assertSafeDisposableDatabaseName,
	buildCheckEnvironment,
	createDisposableDatabaseName,
	parseSourceDatabaseUrl,
	removeClusterRoleMutations,
	withDisposableS10Database,
} from "./quality-database.mjs";
import {
	buildDiffWhitespacePhases,
	createTerminationHandler,
	reconcileRunScopedResidue,
	resolveQualityDiffBase,
	resolveProcessExitCode,
	runActiveCleanups,
	runCommand,
	runQualityPhaseSequence,
} from "./run-quality-with-database.mjs";

const SOURCE_URL = "postgresql://quality_user@127.0.0.1:54322/postgres";
const execFileAsync = promisify(execFile);

async function withTemporaryGitRepository(callback) {
	const repository = await mkdtemp(path.join(tmpdir(), "kanji-quality-git-"));
	const git = async (...arguments_) =>
		await execFileAsync("git", arguments_, { cwd: repository, env: process.env });
	try {
		await git("init", "--quiet");
		await git("config", "user.name", "Quality Test");
		await git("config", "user.email", "quality@example.invalid");
		await writeFile(path.join(repository, "tracked.txt"), "clean\n", "utf8");
		await git("add", "tracked.txt");
		await git("commit", "--quiet", "-m", "initial");
		return await callback({ repository, git });
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
}

async function withGitRepositoryEnvironment(repository, callback) {
	const previousGitDir = process.env.GIT_DIR;
	const previousWorkTree = process.env.GIT_WORK_TREE;
	process.env.GIT_DIR = path.join(repository, ".git");
	process.env.GIT_WORK_TREE = repository;
	try {
		return await callback();
	} finally {
		if (previousGitDir === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = previousGitDir;
		if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
		else process.env.GIT_WORK_TREE = previousWorkTree;
	}
}

function createMemoryAdapter() {
	const databases = new Set(["postgres"]);
	const events = [];
	let roleFingerprint = "role-state-1";
	return {
		databases,
		events,
		get roleFingerprint() {
			return roleFingerprint;
		},
		set roleFingerprint(value) {
			roleFingerprint = value;
		},
		async inspectClusterRoleState() {
			events.push(["roles", roleFingerprint]);
			return { prerequisitesReady: true, fingerprint: roleFingerprint };
		},
		async databaseExists(_url, name) {
			events.push(["exists", name]);
			return databases.has(name);
		},
		async createDatabase(_url, name) {
			events.push(["create", name]);
			assert.equal(databases.has(name), false);
			databases.add(name);
		},
		async prepareDatabase(_targetUrl, sourceName, targetName) {
			events.push(["prepare", sourceName, targetName]);
			assert.equal(databases.has(sourceName), true);
			assert.equal(databases.has(targetName), true);
		},
		async dropDatabase(_url, name) {
			events.push(["drop", name]);
			databases.delete(name);
		},
	};
}

test("S-10 preparation removes cluster role and membership mutations", async () => {
	const migration = await readFile(
		new URL(
			"../../supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql",
			import.meta.url
		),
		"utf8"
	);
	const safeMigration = removeClusterRoleMutations(migration);
	assert.doesNotMatch(safeMigration, /CREATE\s+ROLE\s+s10_migration_owner/iu);
	assert.doesNotMatch(safeMigration, /GRANT\s+s10_migration_owner\s+TO\s+postgres/iu);
	assert.match(safeMigration, /OWNER\s+TO\s+s10_migration_owner/iu);
	assert.throws(
		() => removeClusterRoleMutations("SELECT 1;"),
		/role safety contract/u
	);
});

test("cluster membership fingerprint covers every mutable membership attribute", () => {
	assert.match(CLUSTER_ROLE_STATE_SQL, /memberships\.admin_option::text/u);
	assert.match(CLUSTER_ROLE_STATE_SQL, /memberships\.inherit_option::text/u);
	assert.match(CLUSTER_ROLE_STATE_SQL, /memberships\.set_option::text/u);
});

test("missing cluster role prerequisites fail before target creation", async () => {
	const adapter = createMemoryAdapter();
	adapter.inspectClusterRoleState = async () => ({
		prerequisitesReady: false,
		fingerprint: "role-state-1",
	});
	await assert.rejects(
		withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async () => 0,
		}),
		/role prerequisites/u
	);
	assert.equal(adapter.events.some(([event]) => event === "create"), false);
});

test("generated disposable names are strict and collision resistant", () => {
	const names = new Set(Array.from({ length: 2_000 }, () => createDisposableDatabaseName()));
	assert.equal(names.size, 2_000);
	for (const name of names) {
		assert.match(name, /^kanji_everyday_quality_s10_[0-9a-f]{16}_[0-9a-f]{16}$/u);
		assert.ok(name.length <= 63);
	}
});

test("source parsing rejects implicit, non-PostgreSQL, and identity-overridden URLs", () => {
	assert.throws(() => parseSourceDatabaseUrl(undefined), /required/u);
	assert.throws(() => parseSourceDatabaseUrl("https://localhost/postgres"), /PostgreSQL/u);
	assert.throws(() => parseSourceDatabaseUrl(`${SOURCE_URL}?dbname=other`), /identity/u);
	assert.throws(() => parseSourceDatabaseUrl(SOURCE_URL.replace("/postgres", "/")), /database/u);
});

test("drop validation rejects source, protected, malformed, and near-prefix names", () => {
	const generated = createDisposableDatabaseName();
	assert.doesNotThrow(() => assertSafeDisposableDatabaseName(generated, "postgres"));
	for (const protectedName of [
		"postgres",
		"template0",
		"template1",
		"_supabase",
		"storage_vectors",
		"supabase",
		"kanji_everyday_quality_s10_not-hex",
		`${DISPOSABLE_DATABASE_PREFIX}0123456789abcdef0123456`,
	]) {
		assert.throws(
			() =>
				assertSafeDisposableDatabaseName(
					protectedName,
					protectedName === "postgres" ? "postgres" : "source"
				),
			/safe disposable/u
		);
	}
});

test("check environment scopes S10_TEST_DATABASE_URL and removes the admin URL", () => {
	const environment = buildCheckEnvironment(
		{ KEEP: "yes", S10_ADMIN_DATABASE_URL: SOURCE_URL, S10_TEST_DATABASE_URL: "stale" },
		"postgresql://quality_user@127.0.0.1:54322/target"
	);
	assert.equal(environment.KEEP, "yes");
	assert.equal(environment.S10_ADMIN_DATABASE_URL, undefined);
	assert.match(environment.S10_TEST_DATABASE_URL, /\/target$/u);
});

test("success keeps the source available and the target exists only inside the check", async () => {
	const adapter = createMemoryAdapter();
	let targetName;
	const exitCode = await withDisposableS10Database({
		sourceUrl: SOURCE_URL,
		adapter,
		check: async (_targetUrl, generatedName) => {
			targetName = generatedName;
			assert.equal(adapter.databases.has("postgres"), true);
			assert.equal(adapter.databases.has(generatedName), true);
			return 0;
		},
	});
	assert.equal(exitCode, 0);
	assert.equal(adapter.databases.has("postgres"), true);
	assert.equal(adapter.databases.has(targetName), false);
	assert.deepEqual(adapter.events.filter(([event]) => event === "prepare"), [
		["prepare", "postgres", targetName],
	]);
	assert.deepEqual(adapter.events.filter(([event]) => event === "drop"), [["drop", targetName]]);
});

test("repository quality provisions three distinct S-11 migration databases", async () => {
	const runner = await readFile(new URL("./run-quality-with-database.mjs", import.meta.url), "utf8");
	assert.match(runner, /S11_FRESH_DATABASE_URL/u);
	assert.match(runner, /S11_UPGRADE_DATABASE_URL/u);
	assert.match(runner, /S11_FAILURE_DATABASE_URL/u);
	assert.match(runner, /test:s11:fresh/u);
	assert.match(runner, /test:s11:upgrade/u);
	assert.match(runner, /test:s11:failure/u);
	assert.match(runner, /test:s11:local-real-integration/u);
	assert.match(runner, /committed diff whitespace validation/u);
	assert.match(runner, /diffBase.*\.\.\.HEAD/u);
	const committed = runner.indexOf("committed diff whitespace validation");
	const staged = runner.indexOf("staged diff whitespace validation");
	const unstaged = runner.indexOf("unstaged diff whitespace validation");
	assert.ok(committed >= 0 && staged > committed && unstaged > staged);
	assert.match(runner, /\["diff", "--cached", "--check"\]/u);
	assert.match(runner, /\["diff", "--check"\]/u);
});

test("ordinary Vitest alone serializes file workers without changing later gates", async () => {
	const [runner, vitestConfig, testkit, integration, e2e, contractWorkflow] = await Promise.all([
		readFile(new URL("./run-quality-with-database.mjs", import.meta.url), "utf8"),
		readFile(new URL("../../frontend/vitest.config.ts", import.meta.url), "utf8"),
		readFile(new URL("../../specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts", import.meta.url), "utf8"),
		readFile(new URL("../../specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts", import.meta.url), "utf8"),
		readFile(new URL("../../specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts", import.meta.url), "utf8"),
		readFile(new URL("../../specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-contract-workflow.ts", import.meta.url), "utf8"),
	]);
	const ordinaryStart = runner.indexOf('"complete ordinary Vitest"');
	const inventoryStart = runner.indexOf('"S-11 inventory"', ordinaryStart);
	const focusedStart = runner.indexOf('"S-11 focused 77 regressions"', inventoryStart);
	const diffStart = runner.indexOf("buildDiffWhitespacePhases", focusedStart);
	assert.ok(
		ordinaryStart >= 0 &&
			inventoryStart > ordinaryStart &&
			focusedStart > inventoryStart &&
			diffStart > focusedStart
	);
	const ordinaryPhase = runner.slice(ordinaryStart, inventoryStart);
	const inventoryPhase = runner.slice(inventoryStart, focusedStart);
	const focusedPhase = runner.slice(focusedStart, diffStart);
	assert.match(
		ordinaryPhase,
		/\[\s*"--prefix",\s*"frontend",\s*"run",\s*"test",\s*"--",\s*"--maxWorkers=1",\s*"--minWorkers=1",?\s*\]/u
	);
	assert.doesNotMatch(inventoryPhase, /maxWorkers|minWorkers/u);
	assert.doesNotMatch(focusedPhase, /maxWorkers|minWorkers/u);
	assert.equal(runner.match(/--maxWorkers=1|--minWorkers=1/gu)?.length, 2);
	assert.doesNotMatch(vitestConfig, /testTimeout/u);
	assert.match(testkit, /S10_DB_STATEMENT_TIMEOUT_MS = 10_000/u);
	assert.match(testkit, /S10_DB_LOCK_TIMEOUT_MS = 5_000/u);
	assert.match(testkit, /S10_DB_PROCESS_TIMEOUT_MS = 12_000/u);
	assert.match(testkit, /S10_DB_TEST_TIMEOUT_MS = 30_000/u);
	assert.equal(
		testkit.match(/timeout: processRuntime\?\.timeoutMs \?\? S10_DB_PROCESS_TIMEOUT_MS/gu)?.length,
		3
	);
	assert.match(testkit, /processRuntime\?\.onSpawn\?\.\(child\)/u);
	assert.match(testkit, /runS10SettledTestScope/u);
	for (const databaseSuite of [integration, e2e]) {
		assert.match(databaseSuite, /\{ timeout: S10_DB_TEST_TIMEOUT_MS \}/u);
	}
	assert.match(integration, /captureScopedDailyUsage/u);
	assert.match(integration, /usageAfterReservation - usageBaseline/u);
	assert.match(integration, /expect\(await captureScopedDailyUsage\(usageScope\)\)\.toBe\(usageAfterReservation\)/u);
	assert.match(integration, /const retried = await commitImport\(params\)/u);
	assert.match(integration, /const cardUsageBaseline = await captureScopedDailyUsage\(cardUsageScope\)/u);
	assert.match(integration, /captureScopedDailyUsage\(cardUsageScope\) - cardUsageBaseline\)\.toBe\(0\)/u);
	assert.doesNotMatch(integration, /sum\(generated_card_count\).*IT-COMMIT/u);
	assert.match(contractWorkflow, /pg_advisory_xact_lock\(hashtextextended/u);
	assert.match(contractWorkflow, /WHERE reservation_key LIKE/u);
});

test("quality diff base rejects ambiguous shorthand refs but accepts exact full refs", async () => {
	const runner = await readFile(new URL("./run-quality-with-database.mjs", import.meta.url), "utf8");
	assert.match(runner, /for-each-ref/u);
	await withTemporaryGitRepository(async ({ repository, git }) => {
		await git("branch", "release");
		await git("tag", "release");
		await withGitRepositoryEnvironment(repository, async () => {
			await assert.rejects(
				resolveQualityDiffBase({ QUALITY_DIFF_BASE: "release" }),
				/quality diff base/u
			);
			for (const ref of ["refs/heads/release", "refs/tags/release"]) {
				assert.match(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: ref }), /^[0-9a-f]{40}$/u);
			}
		});
		await git("update-ref", "refs/release", "HEAD");
		await git("branch", "origin/main");
		await git("update-ref", "refs/remotes/origin/main", "HEAD");
		await withGitRepositoryEnvironment(repository, async () => {
			await assert.rejects(
				resolveQualityDiffBase({ QUALITY_DIFF_BASE: "release" }),
				/quality diff base/u
			);
			await assert.rejects(
				resolveQualityDiffBase({ QUALITY_DIFF_BASE: "origin/main" }),
				/quality diff base/u
			);
			for (const ref of [
				"refs/release",
				"refs/heads/origin/main",
				"refs/remotes/origin/main",
			]) {
				assert.match(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: ref }), /^[0-9a-f]{40}$/u);
			}
		});
	});
});

test("quality diff base accepts symbolic HEAD and rejects detached HEAD", async () => {
	await withTemporaryGitRepository(async ({ repository, git }) => {
		await withGitRepositoryEnvironment(repository, async () => {
			assert.match(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: "HEAD" }), /^[0-9a-f]{40}$/u);
		});
		await git("checkout", "--quiet", "--detach", "HEAD");
		await withGitRepositoryEnvironment(repository, async () => {
			await assert.rejects(
				resolveQualityDiffBase({ QUALITY_DIFF_BASE: "HEAD" }),
				/quality diff base/u
			);
		});
	});
});

test("staged-only whitespace failure is distinct from committed and unstaged checks", async () => {
	await withTemporaryGitRepository(async ({ repository, git }) => {
		await writeFile(path.join(repository, "tracked.txt"), "staged trailing whitespace  \n", "utf8");
		await git("add", "tracked.txt");
		await withGitRepositoryEnvironment(repository, async () => {
			const calls = [];
			const exitCode = await runQualityPhaseSequence(
				buildDiffWhitespacePhases("HEAD", process.env),
				async (program, arguments_, environment) => {
					calls.push([program, arguments_]);
					return await runCommand(program, arguments_, environment);
				}
			);
			assert.notEqual(exitCode, 0);
			assert.deepEqual(calls, [
				["git", ["diff", "--check", "HEAD...HEAD"]],
				["git", ["diff", "--cached", "--check"]],
			]);
		});
	});
});

test("diff whitespace phases preserve committed, staged, unstaged argument order and exits", async () => {
	const environment = { PATH: process.env.PATH };
	const phases = buildDiffWhitespacePhases("a".repeat(40), environment);
	assert.deepEqual(phases, [
		[
			"committed diff whitespace validation",
			"git",
			["diff", "--check", `${"a".repeat(40)}...HEAD`],
			environment,
		],
		["staged diff whitespace validation", "git", ["diff", "--cached", "--check"], environment],
		["unstaged diff whitespace validation", "git", ["diff", "--check"], environment],
	]);
	const calls = [];
	assert.equal(
		await runQualityPhaseSequence(phases, async (_program, arguments_) => {
			calls.push(arguments_);
			return arguments_.includes("--cached") ? 17 : 0;
		}),
		17
	);
	assert.deepEqual(calls, [
		["diff", "--check", `${"a".repeat(40)}...HEAD`],
		["diff", "--cached", "--check"],
	]);
});

test("quality diff base resolves only existing refs or a full SHA-1 commit", async () => {
	const refCalls = [];
	const commitCalls = [];
	const sha = "a".repeat(40);
	const resolvers = {
		resolveFullCommit: async (commit) => {
			commitCalls.push(commit);
			return commit === sha ? sha : undefined;
		},
		resolveRef: async (ref) => {
			refCalls.push(ref);
			return ["HEAD", "main", "origin/main", "refs/remotes/origin/main"].includes(ref)
				? sha
				: undefined;
		},
	};
	for (const ref of ["HEAD", "main", "origin/main", "refs/remotes/origin/main"]) {
		assert.equal(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: ref }, resolvers), sha);
	}
	assert.deepEqual(refCalls, ["HEAD", "main", "origin/main", "refs/remotes/origin/main"]);
	assert.equal(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: sha }, resolvers), sha);
	assert.deepEqual(commitCalls, [sha]);
	await assert.rejects(
		resolveQualityDiffBase(
			{ QUALITY_DIFF_BASE: "b".repeat(40) },
			{ ...resolvers, resolveFullCommit: async () => sha }
		),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "missing-safe-ref" }, resolvers),
		/quality diff base/u
	);
	assert.deepEqual(refCalls.at(-1), "missing-safe-ref");
});

test("quality diff base rejects abbreviated OIDs and revision expressions before resolution", async () => {
	const calls = [];
	const resolvers = {
		resolveFullCommit: async (value) => {
			calls.push(["commit", value]);
			return "a".repeat(40);
		},
		resolveRef: async (value) => {
			calls.push(["ref", value]);
			return "a".repeat(40);
		},
	};
	for (const value of [
		"9d49eeb",
		"45969b1",
		...Array.from({ length: 36 }, (_, index) => "a".repeat(index + 4)),
		...Array.from({ length: 23 }, (_, index) => "a".repeat(index + 41)),
		"a".repeat(64),
		"HEAD~1",
		"main^{commit}",
		"main:README.md",
	]) {
		await assert.rejects(
			resolveQualityDiffBase({ QUALITY_DIFF_BASE: value }, resolvers),
			/quality diff base/u
		);
	}
	assert.deepEqual(calls, []);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "main;touch /tmp/injected" }, resolvers),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "   " }, resolvers),
		/quality diff base/u
	);
	assert.deepEqual(calls, []);
});

test("quality diff base resolves real symbolic, local, remote-tracking, and full SHA inputs", async () => {
	for (const ref of [
		"HEAD",
		"main",
		"origin/main",
		"refs/heads/main",
		"refs/remotes/origin/main",
	]) {
		assert.match(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: ref }), /^[0-9a-f]{40}$/u);
	}
	const head = await resolveQualityDiffBase({ QUALITY_DIFF_BASE: "HEAD" });
	assert.equal(await resolveQualityDiffBase({ QUALITY_DIFF_BASE: head }), head);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: head.slice(0, 12) }),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "45969b1" }),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "HEAD~1" }),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "main^{commit}" }),
		/quality diff base/u
	);
	await assert.rejects(
		resolveQualityDiffBase({ QUALITY_DIFF_BASE: "main:README.md" }),
		/quality diff base/u
	);
});

test("quality diff base deterministically falls back to origin/main then main and fails closed", async () => {
	const sha = "b".repeat(40);
	const calls = [];
	assert.equal(
		await resolveQualityDiffBase({}, {
			resolveFullCommit: async () => undefined,
			resolveRef: async (ref) => {
				calls.push(ref);
				return ref === "main" ? sha : undefined;
			},
		}),
		sha
	);
	assert.deepEqual(calls, ["origin/main", "main"]);
	await assert.rejects(
		resolveQualityDiffBase({}, {
			resolveFullCommit: async () => undefined,
			resolveRef: async () => undefined,
		}),
		/quality diff base/u
	);
});

test("signal cleanup attempts every active database in reverse order before failing", async () => {
	const events = [];
	const failure = new Error("first cleanup failed");
	await assert.rejects(
		runActiveCleanups(new Set([
			async () => events.push("fresh"),
			async () => {
				events.push("upgrade");
				throw failure;
			},
			async () => events.push("failure"),
		])),
		(error) => error === failure
	);
	assert.deepEqual(events, ["failure", "upgrade", "fresh"]);
});

test("run-scoped residue cleanup removes stale strict names and ignores a concurrent run", async () => {
	const staleScope = "1111111111111111";
	const currentScope = "2222222222222222";
	const concurrentScope = "3333333333333333";
	const names = new Set([
		`${DISPOSABLE_DATABASE_PREFIX}${staleScope}_aaaaaaaaaaaaaaaa`,
		`${DISPOSABLE_DATABASE_PREFIX}${currentScope}_bbbbbbbbbbbbbbbb`,
		`${DISPOSABLE_DATABASE_PREFIX}${concurrentScope}_cccccccccccccccc`,
		`${DISPOSABLE_DATABASE_PREFIX}not-a-safe-name`,
	]);
	const dropped = [];
	await reconcileRunScopedResidue({
		currentScope,
		sourceDatabaseName: "postgres",
		async listDatabaseNames() {
			return [...names];
		},
		async isRunScopeActive(scope) {
			return scope === currentScope || scope === concurrentScope;
		},
		async dropDatabase(name) {
			dropped.push(name);
			names.delete(name);
		},
	});
	assert.deepEqual(dropped, [`${DISPOSABLE_DATABASE_PREFIX}${staleScope}_aaaaaaaaaaaaaaaa`]);
	assert.equal(names.has(`${DISPOSABLE_DATABASE_PREFIX}${concurrentScope}_cccccccccccccccc`), true);
});

test("setup failure cleans immediately after creation and never touches the source", async () => {
	const adapter = createMemoryAdapter();
	adapter.prepareDatabase = async (_targetUrl, sourceName, targetName) => {
		adapter.events.push(["prepare", sourceName, targetName]);
		throw new Error("setup marker");
	};
	await assert.rejects(
		withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async () => 0,
		}),
		/quality database execution/u
	);
	assert.deepEqual([...adapter.databases], ["postgres"]);
	assert.equal(adapter.events.some(([event, name]) => event === "drop" && name === "postgres"), false);
	assert.equal(adapter.events.filter(([event]) => event === "roles").length, 2);
});

test("cluster role and membership state must remain unchanged after preparation", async () => {
	const adapter = createMemoryAdapter();
	adapter.prepareDatabase = async () => {
		adapter.roleFingerprint = "role-state-2";
	};
	await assert.rejects(
		withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async () => 0,
		}),
		/role.*changed/u
	);
	assert.deepEqual([...adapter.databases], ["postgres"]);
});

test("cleanup requested during creation waits for settlement and leaves no residue", async () => {
	const adapter = createMemoryAdapter();
	let releaseCreation;
	let creationStarted;
	const creationStartedPromise = new Promise((resolve) => {
		creationStarted = resolve;
	});
	const creationReleasePromise = new Promise((resolve) => {
		releaseCreation = resolve;
	});
	adapter.createDatabase = async (_url, name) => {
		creationStarted();
		await creationReleasePromise;
		adapter.databases.add(name);
	};
	let cleanup;
	const execution = withDisposableS10Database({
		sourceUrl: SOURCE_URL,
		adapter,
		onCleanupReady(value) {
			if (value !== undefined) cleanup = value;
		},
		check: async () => 0,
	});
	await creationStartedPromise;
	const cleanupExecution = cleanup();
	releaseCreation();
	await cleanupExecution;
	await execution.catch(() => undefined);
	assert.deepEqual([...adapter.databases], ["postgres"]);
});

test("controlled failure preserves its exit code and always cleans the target", async () => {
	const adapter = createMemoryAdapter();
	let targetName;
	await assert.rejects(
		withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async (_targetUrl, generatedName) => {
				targetName = generatedName;
				return 37;
			},
		}),
		(error) => error instanceof QualityCheckExitError && error.exitCode === 37
	);
	assert.equal(adapter.databases.has("postgres"), true);
	assert.equal(adapter.databases.has(targetName), false);
});

test("drop failure overrides a primary quality exit with a sanitized cleanup failure", async () => {
	const adapter = createMemoryAdapter();
	adapter.dropDatabase = async () => {
		throw new Error(`${SOURCE_URL} drop marker`);
	};
	let failure;
	try {
		await withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async () => 37,
		});
	} catch (error) {
		failure = error;
	}
	assert.equal(failure instanceof QualityCheckExitError, false);
	assert.match(String(failure), /Disposable database cleanup failed/u);
	assert.doesNotMatch(String(failure), /postgresql|quality_user|kanji_everyday_quality_s10_/u);
});

test("residue verification failure overrides a primary quality exit", async () => {
	const adapter = createMemoryAdapter();
	adapter.dropDatabase = async (_url, name) => {
		adapter.events.push(["drop-noop", name]);
	};
	let failure;
	try {
		await withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async () => 41,
		});
	} catch (error) {
		failure = error;
	}
	assert.equal(failure instanceof QualityCheckExitError, false);
	assert.match(String(failure), /cleanup verification failed/u);
	assert.doesNotMatch(String(failure), /postgresql|quality_user|kanji_everyday_quality_s10_/u);
});

test("concurrent executions never collide and leave no disposable targets", async () => {
	const adapter = createMemoryAdapter();
	const observedNames = new Set();
	await Promise.all(
		Array.from({ length: 40 }, () =>
			withDisposableS10Database({
				sourceUrl: SOURCE_URL,
				adapter,
				check: async (_targetUrl, generatedName) => {
					assert.equal(observedNames.has(generatedName), false);
					observedNames.add(generatedName);
					await new Promise((resolve) => setImmediate(resolve));
					assert.equal(adapter.databases.has(generatedName), true);
					return 0;
				},
			})
		)
	);
	assert.equal(observedNames.size, 40);
	assert.deepEqual([...adapter.databases], ["postgres"]);
});

test("errors and serialization never expose URLs, passwords, or generated names", async () => {
	const adapter = createMemoryAdapter();
	let targetName = "";
	let failure;
	try {
		await withDisposableS10Database({
			sourceUrl: SOURCE_URL,
			adapter,
			check: async (_targetUrl, generatedName) => {
				targetName = generatedName;
				throw new Error("controlled quality failure");
			},
		});
	} catch (error) {
		failure = error;
	}
	const rendered = `${String(failure)} ${JSON.stringify(failure)}`;
	assert.doesNotMatch(rendered, /quality_user|postgresql:\/\//u);
	assert.equal(rendered.includes(targetName), false);
});

test("controlled failures and child signals preserve exact exit codes", async () => {
	assert.equal(resolveProcessExitCode(29, null), 29);
	assert.equal(resolveProcessExitCode(null, "SIGINT"), 130);
	assert.equal(resolveProcessExitCode(null, "SIGTERM"), 143);
	assert.equal(
		await runCommand(
			process.execPath,
			["-e", "process.kill(process.pid, 'SIGTERM')"],
			process.env
		),
		143
	);
});

test("termination waits for cleanup before propagating the signal exit", async () => {
	const events = [];
	const terminate = createTerminationHandler({
		getCleanup: () => async () => {
			events.push("cleanup");
		},
		exit: (exitCode) => events.push(`exit:${exitCode}`),
	});
	await terminate("SIGINT");
	await terminate("SIGTERM");
	assert.deepEqual(events, ["cleanup", "exit:130"]);
});

test("signal cleanup rejection wins over the signal exit with a generic failure", async () => {
	const events = [];
	const output = [];
	const terminate = createTerminationHandler({
		getCleanup: () => async () => {
			throw new Error(`${SOURCE_URL} ${DISPOSABLE_DATABASE_PREFIX}secret`);
		},
		exit: (exitCode) => events.push(`exit:${exitCode}`),
		reportFailure: () => output.push("quality_database: failed"),
	});
	await terminate("SIGTERM");
	assert.deepEqual(events, ["exit:1"]);
	assert.deepEqual(output, ["quality_database: failed"]);
	assert.doesNotMatch(output.join(" "), /postgresql|quality_user|kanji_everyday_quality_s10_/u);
});

test("signal callback requires complete teardown verification before signal exit", async () => {
	const adapter = createMemoryAdapter();
	adapter.dropDatabase = async (_url, name) => {
		adapter.events.push(["drop-noop", name]);
	};
	let cleanup;
	let releaseCheck;
	const checkRelease = new Promise((resolve) => {
		releaseCheck = resolve;
	});
	const execution = withDisposableS10Database({
		sourceUrl: SOURCE_URL,
		adapter,
		onCleanupReady(value) {
			if (value !== undefined) cleanup = value;
		},
		check: async () => {
			await checkRelease;
			return 0;
		},
	});
	while (cleanup === undefined || !adapter.events.some(([event]) => event === "prepare")) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	const exits = [];
	const terminate = createTerminationHandler({
		getCleanup: () => cleanup,
		exit: (exitCode) => exits.push(exitCode),
		reportFailure: () => undefined,
	});
	await terminate("SIGINT");
	releaseCheck();
	await execution.catch(() => undefined);
	assert.deepEqual(exits, [1]);
	const dropIndex = adapter.events.findIndex(([event]) => event === "drop-noop");
	const verificationEvents = adapter.events.slice(dropIndex + 1);
	assert.ok(verificationEvents.some(([event, name]) => event === "exists" && name === "postgres"));
	assert.ok(
		verificationEvents.some(
			([event, name]) => event === "exists" && name.startsWith(DISPOSABLE_DATABASE_PREFIX)
		)
	);
	assert.ok(verificationEvents.some(([event]) => event === "roles"));
});
