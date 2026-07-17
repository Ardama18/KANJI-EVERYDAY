import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CONTRACT_VERSION = "S11-RC1-1.0.5";
const CONTRACT_DIGEST = "cac498b88716331f6b05ea3a2988ceddffca0bff211c5afe01d9be48ed2eb125";
const LOCAL_GATE_PHASES = ["pre-provision", "disposable", "post-cleanup"];
const LOCAL_GATE_CONTEXTS = new Set(["source", "disposable", "build"]);
const EXPECTED_ACCEPTANCE_CRITERIA = [
	"AC-01-async-commit-under-two-seconds",
	"AC-02-reconnectable-owner-status",
	"AC-03-idempotent-queue-worker-retry",
	"AC-04-explicit-provider-no-fallback",
	"AC-05-validated-bounded-image-processing",
	"AC-06-concept-shared-illustration-lifecycle",
	"AC-07-twenty-four-hour-source-orphan-cleanup",
	"AC-08-concept-failure-isolation",
	"AC-09-safe-logging",
];
const EXPECTED_HOSTED_IDS = [
	"hosted-fresh",
	"hosted-upgrade",
	"hosted-failure",
	"hosted-real-integration",
	"hosted-real-e2e",
	"hosted-resource",
	"hosted-deno",
];

export async function readReleaseFiles(input = {}) {
	const contractPath = input.contractPath ?? new URL("../../.codex/release-contract.json", import.meta.url);
	const evidencePath = input.evidencePath ?? new URL("../../.codex/release-evidence.json", import.meta.url);
	const [contract, evidence] = await Promise.all([
		readReleaseContract({ contractPath }),
		readJson(evidencePath, "release evidence"),
	]);
	return { contract, evidence };
}

export async function readReleaseContract(input = {}) {
	const contractPath = input.contractPath ?? new URL("../../.codex/release-contract.json", import.meta.url);
	return await readJson(contractPath, "release contract");
}

export function validateReleaseContractDefinition(contract, options = {}) {
	const failures = [];
	if (!isRecord(contract)) return ["release contract must be an object"];
	check(contract.schemaVersion === 1, "unknown release contract schema", failures);
	check(
		createHash("sha256").update(JSON.stringify(contract)).digest("hex") === CONTRACT_DIGEST,
		"release contract drift",
		failures
	);
	check(contract.contractVersion === CONTRACT_VERSION, "release contract version drift", failures);
	check(contract.issue === 12 && contract.story === "S-11", "release contract issue/story drift", failures);
	check(SHA_PATTERN.test(String(contract.baseSha)), "release contract base SHA is invalid", failures);
	if (options.expectedBaseSha !== undefined) {
		check(contract.baseSha === options.expectedBaseSha, "release contract base SHA drift", failures);
	}
	const scope = isRecord(contract.scope) ? contract.scope : {};
	checkExactIds(scope.acceptanceCriteria, EXPECTED_ACCEPTANCE_CRITERIA, "acceptance criteria", failures);
	check(Array.isArray(scope.outOfScope) && scope.outOfScope.length === 5, "out-of-scope contract drift", failures);
	checkGateDefinitions(contract.localGates, "local", failures);
	validateLocalGateExecutionModel(contract.localGates, failures);
	checkGateDefinitions(contract.hostedGates, "hosted", failures);
	checkExactIds(readIds(contract.hostedGates), EXPECTED_HOSTED_IDS, "hosted gates", failures);
	checkGateDefinitions(contract.secretScans, "secret scan", failures);
	validateSecretScanExecutionModel(contract.secretScans, failures);
	validateGatePlaceholders([
		...(Array.isArray(contract.localGates) ? contract.localGates : []),
		...(Array.isArray(contract.secretScans) ? contract.secretScans : []),
	], contract.baseSha, failures);
	validateReviewPolicy(contract.reviewPolicy, failures);
	const binding = isRecord(contract.evidenceBinding) ? contract.evidenceBinding : {};
	check(binding.mode === "post-candidate-evidence-chain", "release evidence binding mode drift", failures);
	check(binding.allGateRunsMustUseCandidateSha === true, "candidate binding must cover every gate", failures);
	check(binding.candidateMustBeAncestorOfHead === true, "release evidence candidate ancestry drift", failures);
	check(
		Array.isArray(binding.postCandidateCommitsMayChangeOnly)
			&& binding.postCandidateCommitsMayChangeOnly.length > 0
			&& binding.postCandidateCommitsMayChangeOnly.every((path) => typeof path === "string" && path.length > 0),
		"release evidence path allowlist drift",
		failures
	);
	const merge = isRecord(contract.mergePolicy) ? contract.mergePolicy : {};
	check(merge.hostedSevenRequired === true && merge.unresolvedStatusBlocksMerge === true, "hosted merge blocker drift", failures);
	return failures;
}


export function validateReleaseState(contract, evidence, options = {}) {
	const failures = validateReleaseContractDefinition(contract, options);
	if (!isRecord(contract) || !isRecord(evidence)) {
		return [...failures, "release contract and evidence must be objects"];
	}
	check(evidence.schemaVersion === 1, "unknown release evidence schema", failures);
	check(evidence.contractVersion === contract.contractVersion, "release evidence contract mismatch", failures);
	check(evidence.issue === contract.issue && evidence.story === contract.story, "release evidence issue/story mismatch", failures);
	check(evidence.baseSha === contract.baseSha, "release evidence base SHA mismatch", failures);
	check(SHA_PATTERN.test(String(evidence.candidateSha)), "release evidence candidate SHA is invalid", failures);
	if (options.expectedCandidateSha !== undefined) {
		check(evidence.candidateSha === options.expectedCandidateSha, "release evidence candidate SHA mismatch", failures);
	}
	validateEvidenceGates(contract.localGates, evidence.localGates, evidence.candidateSha, "local", failures);
	validateEvidenceGates(contract.hostedGates, evidence.hostedGates, evidence.candidateSha, "hosted", failures);
	validateEvidenceGates(contract.secretScans, evidence.secretScans, evidence.candidateSha, "secret scan", failures);
	const reviews = isRecord(evidence.reviews) ? evidence.reviews : {};
	for (const name of ["cumulative", "verification"]) {
		const review = reviews[name];
		check(isRecord(review) && review.status === "passed" && review.candidateSha === evidence.candidateSha, `${name} review is unresolved or mismatched`, failures);
	}
	const redaction = isRecord(evidence.redaction) ? evidence.redaction : {};
	check(redaction.containsSecrets === false && redaction.rawLogsIncluded === false, "release evidence is not redacted", failures);
	check(evidence.state === "accepted", "release evidence state is unresolved", failures);
	return failures;
}

export async function validateRepositoryEvidenceBinding(contract, evidence, cwd = process.cwd()) {
	if (!isRecord(evidence) || !SHA_PATTERN.test(String(evidence.candidateSha))) {
		return ["release evidence commit binding is unavailable"];
	}
	try {
		await execFileAsync("git", ["rev-parse", "--verify", `${evidence.candidateSha}^{commit}`], {
			cwd,
			encoding: "utf8",
		});
		let candidateIsAncestor = true;
		try {
			await execFileAsync("git", ["merge-base", "--is-ancestor", evidence.candidateSha, "HEAD"], {
				cwd,
				encoding: "utf8",
			});
		} catch (error) {
			if (!isRecord(error) || error.code !== 1) throw error;
			candidateIsAncestor = false;
		}
		if (!candidateIsAncestor) {
			return validateEvidenceCommitBinding(contract, evidence, {
				candidateIsAncestor,
				changedPaths: [],
			});
		}
		const { stdout: pathsOutput } = await execFileAsync("git", [
			"log",
			"--format=",
			"--name-only",
			"--no-renames",
			`${evidence.candidateSha}..HEAD`,
			"--",
		], { cwd, encoding: "utf8" });
		return validateEvidenceCommitBinding(contract, evidence, {
			candidateIsAncestor,
			changedPaths: [...new Set(pathsOutput.split(/\r?\n/u).filter(Boolean))],
		});
	} catch {
		return ["release evidence commit binding is unavailable"];
	}
}

export function validateEvidenceCommitBinding(contract, evidence, repositoryState) {
	const failures = [];
	const binding = isRecord(contract) && isRecord(contract.evidenceBinding)
		? contract.evidenceBinding
		: {};
	const state = isRecord(repositoryState) ? repositoryState : {};
	check(state.candidateIsAncestor === true, "release evidence candidate is not an ancestor of HEAD", failures);
	const allowed = new Set(Array.isArray(binding.postCandidateCommitsMayChangeOnly)
		? binding.postCandidateCommitsMayChangeOnly
		: []);
	const changedPaths = Array.isArray(state.changedPaths) ? state.changedPaths : [];
	check(changedPaths.length > 0, "release evidence commit has no tracked evidence", failures);
	for (const changedPath of changedPaths) {
		check(allowed.has(changedPath), `release evidence commit changed an unauthorized path: ${changedPath}`, failures);
	}
	return failures;
}

export function resolveReleaseGateCommand(gate, baseSha) {
	if (!isRecord(gate) || !Array.isArray(gate.command) || gate.command.length === 0) {
		throw new Error("Release gate command is invalid");
	}
	if (!SHA_PATTERN.test(String(baseSha))) throw new Error("Release gate base SHA is invalid");
	const placeholder = gate.id === "diff-committed"
		? "BASE...HEAD"
		: gate.id === "gitleaks-redacted"
			? "BASE..HEAD"
			: undefined;
	const placeholderCount = gate.command.filter((argument) => argument === placeholder).length;
	if (placeholder !== undefined && placeholderCount !== 1) {
		throw new Error(`Release gate ${gate.id} must contain its exact revision placeholder once`);
	}
	return gate.command.map((argument) => {
		if (argument === placeholder) {
			return placeholder === "BASE..HEAD" ? `${baseSha}..HEAD` : `${baseSha}...HEAD`;
		}
		if (typeof argument === "string" && argument.includes("BASE")) {
			throw new Error(`Release gate ${gate.id} contains an unauthorized revision placeholder`);
		}
		return argument;
	});
}

function validateEvidenceGates(definitions, evidenceEntries, candidateSha, label, failures) {
	const expected = Array.isArray(definitions) ? definitions : [];
	const actual = Array.isArray(evidenceEntries) ? evidenceEntries : [];
	checkExactIds(readIds(actual), readIds(expected), `${label} evidence gates`, failures);
	for (const definition of expected) {
		const entry = actual.find((candidate) => isRecord(candidate) && candidate.id === definition.id);
		const expectedResult = isRecord(definition.expected) ? definition.expected : {};
		check(isRecord(entry), `${label} gate ${definition.id} is missing`, failures);
		if (!isRecord(entry)) continue;
		check(entry.status === expectedResult.status && entry.exitCode === expectedResult.exitCode, `${label} gate ${definition.id} is unresolved`, failures);
		check(entry.candidateSha === candidateSha, `${label} gate ${definition.id} candidate mismatch`, failures);
	}
}

function checkGateDefinitions(value, label, failures) {
	if (!Array.isArray(value) || value.length === 0) {
		failures.push(`${label} gate definitions are missing`);
		return;
	}
	const ids = readIds(value);
	check(new Set(ids).size === ids.length, `${label} gate definitions contain duplicates`, failures);
	for (const gate of value) {
		check(isRecord(gate) && typeof gate.id === "string", `${label} gate has an invalid id`, failures);
		check(isRecord(gate) && Array.isArray(gate.command) && gate.command.every((part) => typeof part === "string" && part.length > 0), `${label} gate command is invalid`, failures);
		check(isRecord(gate) && isRecord(gate.expected) && gate.expected.status === "passed" && gate.expected.exitCode === 0, `${label} gate expected result drift`, failures);
	}
}

function validateLocalGateExecutionModel(value, failures) {
	if (!Array.isArray(value)) return;
	const phases = value.map((gate) => isRecord(gate) ? gate.phase : undefined);
	const transitions = phases.filter((phase, index) => index === 0 || phase !== phases[index - 1]);
	checkExactIds(transitions, LOCAL_GATE_PHASES, "local gate execution phases", failures);
	check(
		transitions.every((phase, index) => phase === LOCAL_GATE_PHASES[index]),
		"local gate execution phases are out of order",
		failures
	);
	for (const phase of LOCAL_GATE_PHASES) {
		check(phases.some((candidate) => candidate === phase), `local gate phase ${phase} is empty`, failures);
	}
	for (const gate of value) {
		if (!isRecord(gate)) continue;
		check(LOCAL_GATE_PHASES.includes(gate.phase), `local gate ${gate.id} has an unknown phase`, failures);
		check(LOCAL_GATE_CONTEXTS.has(gate.context), `local gate ${gate.id} has an unknown context`, failures);
		if (gate.phase === "pre-provision" || gate.phase === "post-cleanup") {
			check(gate.context === "source", `local gate ${gate.id} must use source context`, failures);
		} else if (gate.phase === "disposable") {
			check(gate.context === "disposable" || gate.context === "build", `local gate ${gate.id} must use disposable or build context`, failures);
		}
	}
}

function validateSecretScanExecutionModel(value, failures) {
	if (!Array.isArray(value)) return;
	for (const gate of value) {
		if (!isRecord(gate)) continue;
		if (gate.id === "gitleaks-redacted") {
			check(gate.executionContext === "candidate-local", "gitleaks must use candidate-local execution context", failures);
			check(Array.isArray(gate.prerequisites) && gate.prerequisites.length === 0, "gitleaks must not require hosted prerequisites", failures);
		} else if (gate.id === "forbidden-marker-scan") {
			check(gate.executionContext === "hosted-runtime", "forbidden marker scan must use hosted-runtime execution context", failures);
			checkExactIds(gate.prerequisites, ["S11_FORBIDDEN_MARKERS"], "forbidden marker prerequisites", failures);
		}
	}
}

function validateGatePlaceholders(gates, baseSha, failures) {
	if (!Array.isArray(gates)) return;
	for (const gate of gates) {
		try {
			resolveReleaseGateCommand(gate, baseSha);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : "Release gate placeholder is invalid");
		}
	}
}

function validateReviewPolicy(value, failures) {
	const policy = isRecord(value) ? value : {};
	check(policy.cumulativeReviews === 1 && policy.verificationReviews === 1, "review count policy drift", failures);
	check(policy.verificationScope === "prior-findings-plus-regressions-and-impact", "verification scope drift", failures);
	checkExactIds(policy.blockingSeverities, ["H", "M"], "blocking severities", failures);
	check(policy.askAllowedOnlyFor === "frozen-contract-ambiguity", "ASK policy drift", failures);
}

function checkExactIds(value, expected, label, failures) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		failures.push(`${label} are invalid`);
		return;
	}
	const unique = new Set(value);
	check(unique.size === value.length, `${label} contain duplicates`, failures);
	check(value.length === expected.length && expected.every((id) => unique.has(id)), `${label} contain missing or unknown entries`, failures);
}

function readIds(value) {
	return Array.isArray(value) ? value.map((entry) => isRecord(entry) ? entry.id : undefined).filter((id) => typeof id === "string") : [];
}

function check(condition, message, failures) {
	if (!condition) failures.push(message);
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path, label) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		throw new Error(`${label} is missing or invalid`);
	}
}
