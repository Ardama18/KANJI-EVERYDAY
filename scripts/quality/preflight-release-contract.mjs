import {
	readReleaseContract,
	validateReleaseContractDefinition,
} from "./release-contract.mjs";

try {
	const contract = await readReleaseContract();
	const failures = validateReleaseContractDefinition(contract);
	if (failures.length > 0) {
		process.stderr.write(`${JSON.stringify({ gate: "s11-release-contract-preflight", status: "blocked", failures })}\n`);
		process.exitCode = 2;
	} else {
		process.stdout.write(`${JSON.stringify({ gate: "s11-release-contract-preflight", status: "passed" })}\n`);
	}
} catch (error) {
	process.stderr.write(`${JSON.stringify({ gate: "s11-release-contract-preflight", status: "blocked", failures: [error instanceof Error ? error.message : "release contract preflight failed"] })}\n`);
	process.exitCode = 2;
}
