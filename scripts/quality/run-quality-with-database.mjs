import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	QualityCheckExitError,
	buildCheckEnvironment,
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

export async function runRepositoryQuality() {
	let activeCleanup;
	const terminate = createTerminationHandler({
		getCleanup: () => activeCleanup,
		exit: (exitCode) => process.exit(exitCode),
	});
	process.on("SIGINT", terminate);
	process.on("SIGTERM", terminate);
	try {
		await withDisposableS10Database({
			sourceUrl: process.env.S10_ADMIN_DATABASE_URL,
			onCleanupReady(cleanup) {
				activeCleanup = cleanup;
			},
			check: async (targetUrl) => await runQualityPhases(targetUrl),
		});
		return 0;
	} catch (error) {
		if (error instanceof QualityCheckExitError) return error.exitCode;
		process.stderr.write("quality_database: failed\n");
		return 1;
	} finally {
		process.off("SIGINT", terminate);
		process.off("SIGTERM", terminate);
	}
}

async function runQualityPhases(targetUrl) {
	const checkEnvironment = buildCheckEnvironment(process.env, targetUrl);
	const phases = [
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
			"S-11 focused 34 regressions",
			"npm",
			[
				"--prefix",
				"frontend",
				"run",
				"test:s11:integration",
				"--",
				"-t",
				"R[789]-F|R10-(R[12]-)?F|R11-(R2-)?F[12]",
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
