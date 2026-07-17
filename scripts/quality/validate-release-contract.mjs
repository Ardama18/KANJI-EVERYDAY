import {
	readReleaseFiles,
	validateReleaseState,
	validateRepositoryEvidenceBinding,
} from "./release-contract.mjs";

try {
	const { contract, evidence } = await readReleaseFiles();
	const failures = [
		...validateReleaseState(contract, evidence),
		...await validateRepositoryEvidenceBinding(contract, evidence),
	];
	if (failures.length > 0) {
		process.stderr.write(`${JSON.stringify({ gate: "s11-release-contract", status: "blocked", failures })}\n`);
		process.exitCode = 2;
	} else {
		process.stdout.write(`${JSON.stringify({ gate: "s11-release-contract", status: "passed" })}\n`);
	}
} catch (error) {
	process.stderr.write(`${JSON.stringify({ gate: "s11-release-contract", status: "blocked", failures: [error instanceof Error ? error.message : "release validation failed"] })}\n`);
	process.exitCode = 2;
}
