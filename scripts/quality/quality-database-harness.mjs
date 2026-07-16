import {
	QualityCheckExitError,
	createPostgresAdapter,
	parseSourceDatabaseUrl,
	withDisposableS10Database,
} from "./quality-database.mjs";

function requireCondition(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const configuredUrl = process.env.S10_ADMIN_DATABASE_URL;
	const { sourceUrl, sourceDatabaseName } = parseSourceDatabaseUrl(configuredUrl);
	const adapter = createPostgresAdapter();
	requireCondition(
		(await adapter.countDatabasesByPrefix(sourceUrl)) === 0,
		"Disposable database residue existed before the harness"
	);
	const targets = [];
	const success = withDisposableS10Database({
		sourceUrl,
		adapter,
		check: async (_targetUrl, targetName) => {
			targets.push(targetName);
			requireCondition(
				await adapter.databaseExists(sourceUrl, sourceDatabaseName),
				"Source database was unavailable during the success probe"
			);
			requireCondition(
				await adapter.databaseExists(sourceUrl, targetName),
				"Success target did not exist during its probe"
			);
			return 0;
		},
	});
	const controlledFailure = withDisposableS10Database({
		sourceUrl,
		adapter,
		check: async (_targetUrl, targetName) => {
			targets.push(targetName);
			requireCondition(
				await adapter.databaseExists(sourceUrl, sourceDatabaseName),
				"Source database was unavailable during the failure probe"
			);
			requireCondition(
				await adapter.databaseExists(sourceUrl, targetName),
				"Failure target did not exist during its probe"
			);
			return 23;
		},
	}).catch((error) => {
		if (!(error instanceof QualityCheckExitError) || error.exitCode !== 23) {
			const kind = error instanceof Error ? `${error.name}: ${error.message}` : "unknown failure";
			throw new Error(`Controlled failure exit propagation was incorrect (${kind})`);
		}
		return 23;
	});
	const setupFailureAdapter = {
		...adapter,
		async createDatabase(...arguments_) {
			targets.push(arguments_[1]);
			return await adapter.createDatabase(...arguments_);
		},
		async prepareDatabase() {
			throw new Error("controlled setup failure");
		},
	};
	const controlledSetupFailure = withDisposableS10Database({
		sourceUrl,
		adapter: setupFailureAdapter,
		check: async () => 0,
	}).then(
		() => {
			throw new Error("Controlled setup failure unexpectedly passed");
		},
		() => "setup-failed"
	);
	const [successCode, failureCode, setupFailureCode] = await Promise.all([
		success,
		controlledFailure,
		controlledSetupFailure,
	]);
	requireCondition(successCode === 0, "Success probe exit propagation was incorrect");
	requireCondition(failureCode === 23, "Failure probe exit propagation was incorrect");
	requireCondition(
		setupFailureCode === "setup-failed",
		"Setup failure propagation was incorrect"
	);
	requireCondition(
		targets.length === 3 && new Set(targets).size === 3,
		"Concurrent names collided"
	);
	requireCondition(
		await adapter.databaseExists(sourceUrl, sourceDatabaseName),
		"Source database was unavailable after the harness"
	);
	for (const targetName of targets) {
		requireCondition(
			!(await adapter.databaseExists(sourceUrl, targetName)),
			"A disposable target remained after the harness"
		);
	}
	requireCondition(
		(await adapter.countDatabasesByPrefix(sourceUrl)) === 0,
		"Disposable database residue remained after the harness"
	);
	process.stdout.write("quality_database_harness: passed\n");
}

main().catch((error) => {
	const detail = error instanceof Error ? error.message : "unknown failure";
	process.stderr.write(`quality_database_harness: failed (${detail})\n`);
	process.exitCode = 1;
});
