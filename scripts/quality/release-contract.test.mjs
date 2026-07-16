import assert from "node:assert/strict";
import test from "node:test";

import {
	readReleaseFiles,
	validateEvidenceCommitBinding,
	validateReleaseContractDefinition,
	validateReleaseState,
} from "./release-contract.mjs";

const CANDIDATE = "1234567890abcdef1234567890abcdef12345678";

function clone(value) {
	return structuredClone(value);
}

function acceptedEvidence(contract) {
	const evidenceFor = (definitions) => definitions.map(({ id, expected }) => ({
		id,
		status: expected.status,
		exitCode: expected.exitCode,
		candidateSha: CANDIDATE,
	}));
	return {
		schemaVersion: 1,
		contractVersion: contract.contractVersion,
		issue: contract.issue,
		story: contract.story,
		baseSha: contract.baseSha,
		candidateSha: CANDIDATE,
		state: "accepted",
		localGates: evidenceFor(contract.localGates),
		hostedGates: evidenceFor(contract.hostedGates),
		secretScans: evidenceFor(contract.secretScans),
		reviews: {
			cumulative: { status: "passed", candidateSha: CANDIDATE },
			verification: { status: "passed", candidateSha: CANDIDATE },
		},
		redaction: { containsSecrets: false, rawLogsIncluded: false },
	};
}

test("release contract accepts one complete candidate-bound evidence set", async () => {
	const { contract } = await readReleaseFiles();
	assert.deepEqual(validateReleaseState(contract, acceptedEvidence(contract), {
		expectedBaseSha: contract.baseSha,
		expectedCandidateSha: CANDIDATE,
	}), []);
});

test("pending RC1 evidence passes immutable contract-definition preflight", async () => {
	const { contract, evidence } = await readReleaseFiles();
	assert.equal(evidence.state, "pending_rc1");
	assert.deepEqual(validateReleaseContractDefinition(contract, {
		expectedBaseSha: contract.baseSha,
	}), []);
});

test("pending RC1 evidence still fails final accepted-evidence validation", async () => {
	const { contract, evidence } = await readReleaseFiles();
	assert.ok(validateReleaseState(contract, evidence).some((failure) => /unresolved/u.test(failure)));
});

test("release contract fails closed for missing, duplicate, and unknown gates", async () => {
	const { contract } = await readReleaseFiles();
	for (const mutate of [
		(evidence) => evidence.hostedGates.pop(),
		(evidence) => evidence.hostedGates.push(clone(evidence.hostedGates[0])),
		(evidence) => { evidence.hostedGates[0].id = "hosted-unknown"; },
	]) {
		const evidence = acceptedEvidence(contract);
		mutate(evidence);
		assert.ok(validateReleaseState(contract, evidence).some((failure) => /hosted evidence gates/u.test(failure)));
	}
});

test("release contract fails closed for contract drift and bad identities", async () => {
	const { contract } = await readReleaseFiles();
	for (const mutate of [
		(drifted) => drifted.hostedGates[0].command.push("--drift"),
		(drifted) => drifted.localGates.push(clone(drifted.localGates[0])),
		(drifted) => { drifted.localGates[0].id = "unknown-local-gate"; },
	]) {
		const drifted = clone(contract);
		mutate(drifted);
		assert.ok(validateReleaseContractDefinition(drifted).includes("release contract drift"));
	}
	for (const field of ["baseSha", "candidateSha"]) {
		const evidence = acceptedEvidence(contract);
		evidence[field] = "not-a-sha";
		assert.ok(validateReleaseState(contract, evidence).some((failure) => failure.includes("SHA")));
	}
});

test("release contract rejects unresolved gates, reviews, redaction, and candidate mismatch", async () => {
	const { contract } = await readReleaseFiles();
	for (const mutate of [
		(evidence) => { evidence.localGates[0].status = "not_run"; evidence.localGates[0].exitCode = 2; },
		(evidence) => { evidence.hostedGates[0].status = "not_run"; evidence.hostedGates[0].exitCode = 2; },
		(evidence) => { evidence.secretScans = []; },
		(evidence) => { evidence.reviews.verification = null; },
		(evidence) => { evidence.redaction.containsSecrets = true; },
		(evidence) => { evidence.hostedGates[0].candidateSha = contract.baseSha; },
	]) {
		const evidence = acceptedEvidence(contract);
		mutate(evidence);
		assert.notEqual(validateReleaseState(contract, evidence).length, 0);
	}
});

test("repository evidence remains an explicit Hosted7 merge blocker during RC1", async () => {
	const { contract, evidence } = await readReleaseFiles();
	const failures = validateReleaseState(contract, evidence);
	assert.equal(evidence.state, "pending_rc1");
	assert.equal(evidence.hostedGates.length, 7);
	assert.ok(evidence.hostedGates.every((gate) => gate.status === "not_run" && gate.exitCode === 2));
	assert.ok(failures.some((failure) => /unresolved/u.test(failure)));
});

test("post-commit evidence must bind its parent candidate and change only allowlisted evidence paths", async () => {
	const { contract } = await readReleaseFiles();
	const evidence = acceptedEvidence(contract);
	assert.deepEqual(validateEvidenceCommitBinding(contract, evidence, {
		parentSha: CANDIDATE,
		changedPaths: [".codex/release-evidence.json"],
	}), []);
	for (const repositoryState of [
		{ parentSha: contract.baseSha, changedPaths: [".codex/release-evidence.json"] },
		{ parentSha: CANDIDATE, changedPaths: ["supabase/functions/changed.ts"] },
		{ parentSha: CANDIDATE, changedPaths: [] },
	]) {
		assert.notEqual(validateEvidenceCommitBinding(contract, evidence, repositoryState).length, 0);
	}
});
