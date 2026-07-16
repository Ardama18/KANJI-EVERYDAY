import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CONTRACT_VERSION = "S11-RC1-1.0.0";
const CONTRACT_DIGEST = "164f23b2a0f69da74c7e3ba5817c7ea49b03d0b0f7cb626fef31c37da5bc431a";
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
		readJson(contractPath, "release contract"),
		readJson(evidencePath, "release evidence"),
	]);
	return { contract, evidence };
}

export function validateReleaseState(contract, evidence, options = {}) {
	const failures = [];
	if (!isRecord(contract) || !isRecord(evidence)) return ["release contract and evidence must be objects"];
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
	checkGateDefinitions(contract.hostedGates, "hosted", failures);
	checkExactIds(readIds(contract.hostedGates), EXPECTED_HOSTED_IDS, "hosted gates", failures);
	checkGateDefinitions(contract.secretScans, "secret scan", failures);
	validateReviewPolicy(contract.reviewPolicy, failures);
	const binding = isRecord(contract.evidenceBinding) ? contract.evidenceBinding : {};
	check(binding.mode === "post-commit-evidence", "release evidence binding mode drift", failures);
	check(binding.allGateRunsMustUseCandidateSha === true, "candidate binding must cover every gate", failures);
	const merge = isRecord(contract.mergePolicy) ? contract.mergePolicy : {};
	check(merge.hostedSevenRequired === true && merge.unresolvedStatusBlocksMerge === true, "hosted merge blocker drift", failures);

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
	try {
		const [{ stdout: parentOutput }, { stdout: pathsOutput }] = await Promise.all([
			execFileAsync("git", ["rev-parse", "--verify", "HEAD^"], { cwd, encoding: "utf8" }),
			execFileAsync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
				cwd,
				encoding: "utf8",
			}),
		]);
		return validateEvidenceCommitBinding(contract, evidence, {
			parentSha: parentOutput.trim(),
			changedPaths: pathsOutput.split(/\r?\n/u).filter(Boolean),
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
	check(repositoryState.parentSha === evidence.candidateSha, "release evidence commit parent does not match candidate SHA", failures);
	const allowed = new Set(Array.isArray(binding.evidenceCommitMayChangeOnly)
		? binding.evidenceCommitMayChangeOnly
		: []);
	check(repositoryState.changedPaths.length > 0, "release evidence commit has no tracked evidence", failures);
	for (const changedPath of repositoryState.changedPaths) {
		check(allowed.has(changedPath), `release evidence commit changed an unauthorized path: ${changedPath}`, failures);
	}
	return failures;
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
