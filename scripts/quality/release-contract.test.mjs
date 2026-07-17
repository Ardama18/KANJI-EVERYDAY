import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	readReleaseFiles,
	resolveReleaseGateCommand,
	validateEvidenceCommitBinding,
	validateReleaseContractDefinition,
	validateRepositoryEvidenceBinding,
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
	assert.equal(evidence.state, "pending_hosted");
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

test("release preflight rejects missing, unknown, empty, and out-of-order execution phases", async () => {
	const { contract } = await readReleaseFiles();
	for (const mutate of [
		(drifted) => { delete drifted.localGates[0].phase; },
		(drifted) => { drifted.localGates[0].phase = "unknown-phase"; },
		(drifted) => { drifted.localGates = drifted.localGates.filter((gate) => gate.phase !== "pre-provision"); },
		(drifted) => { drifted.localGates.push(drifted.localGates.shift()); },
	]) {
		const drifted = clone(contract);
		mutate(drifted);
		assert.notEqual(validateReleaseContractDefinition(drifted).length, 0);
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
	assert.equal(evidence.state, "pending_hosted");
	assert.equal(evidence.hostedGates.length, 7);
	assert.ok(evidence.hostedGates.every((gate) => gate.status === "not_run" && gate.exitCode === 2));
	assert.ok(failures.some((failure) => /unresolved/u.test(failure)));
});

test("post-candidate evidence accepts multiple allowlisted commits and rejects invalid ancestry or paths", async () => {
	const { contract } = await readReleaseFiles();
	const evidence = acceptedEvidence(contract);
	assert.deepEqual(validateEvidenceCommitBinding(contract, evidence, {
		candidateIsAncestor: true,
		changedPaths: [
			".codex/release-evidence.json",
			"specs/stories/S-11-ai-card-async-processing/tasks/remediation-cycle-19.md",
		],
	}), []);
	for (const repositoryState of [
		{ candidateIsAncestor: false, changedPaths: [".codex/release-evidence.json"] },
		{ candidateIsAncestor: true, changedPaths: ["supabase/functions/changed.ts"] },
		{ candidateIsAncestor: true, changedPaths: [] },
	]) {
		assert.notEqual(validateEvidenceCommitBinding(contract, evidence, repositoryState).length, 0);
	}
});

test("repository binding rejects an unauthorized intermediate path even after it is removed", async () => {
	const repository = await mkdtemp(path.join(tmpdir(), "kanji-release-evidence-chain-"));
	const git = async (...arguments_) => {
		assert.equal(await runExit("git", arguments_, repository), 0);
	};
	try {
		await git("init", "--quiet");
		await git("config", "user.name", "Release Contract Test");
		await git("config", "user.email", "release-contract@example.invalid");
		await writeFile(path.join(repository, "candidate.txt"), "candidate\n", "utf8");
		await git("add", "candidate.txt");
		await git("commit", "--quiet", "-m", "candidate");
		const candidateSha = await readGitHead(repository);
		const contract = {
			evidenceBinding: {
				postCandidateCommitsMayChangeOnly: [
					".codex/release-evidence.json",
					"specs/stories/S-11-ai-card-async-processing/tasks/remediation-cycle-19.md",
				],
			},
		};
		const evidence = { candidateSha };
		await mkdir(path.join(repository, ".codex"), { recursive: true });
		await writeFile(path.join(repository, ".codex/release-evidence.json"), "{}\n", "utf8");
		await git("add", ".codex/release-evidence.json");
		await git("commit", "--quiet", "-m", "first evidence");
		await mkdir(path.join(repository, "specs/stories/S-11-ai-card-async-processing/tasks"), { recursive: true });
		await writeFile(path.join(repository, "specs/stories/S-11-ai-card-async-processing/tasks/remediation-cycle-19.md"), "evidence\n", "utf8");
		await git("add", "specs/stories/S-11-ai-card-async-processing/tasks/remediation-cycle-19.md");
		await git("commit", "--quiet", "-m", "second evidence");
		assert.deepEqual(await validateRepositoryEvidenceBinding(contract, evidence, repository), []);

		await writeFile(path.join(repository, "unauthorized.txt"), "temporary\n", "utf8");
		await git("add", "unauthorized.txt");
		await git("commit", "--quiet", "-m", "unauthorized intermediate path");
		await rm(path.join(repository, "unauthorized.txt"));
		await git("add", "--all");
		await git("commit", "--quiet", "-m", "remove unauthorized path");
		assert.ok((await validateRepositoryEvidenceBinding(contract, evidence, repository)).includes(
			"release evidence commit changed an unauthorized path: unauthorized.txt"
		));
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

test("secret scan resolves only the exact candidate two-dot placeholder", async () => {
	const { contract } = await readReleaseFiles();
	const gate = contract.secretScans.find((candidate) => candidate.id === "gitleaks-redacted");
	assert.deepEqual(resolveReleaseGateCommand(gate, contract.baseSha), [
		"gitleaks",
		"git",
		"--redact",
		"--no-banner",
		"--log-opts",
		`${contract.baseSha}..HEAD`,
		".",
	]);
	for (const scope of ["BASE...HEAD", "BASE..HEAD;HEAD", "main..HEAD"]) {
		const malformed = clone(gate);
		malformed.command[malformed.command.indexOf("BASE..HEAD")] = scope;
		assert.throws(() => resolveReleaseGateCommand(malformed, contract.baseSha), /exact revision placeholder/u);
	}
});

test("candidate-scoped gitleaks ignores base history and rejects a candidate-introduced leak", async () => {
	const repository = await mkdtemp(path.join(tmpdir(), "kanji-release-secret-scope-"));
	const git = async (...arguments_) => {
		assert.equal(await runExit("git", arguments_, repository), 0);
	};
	try {
		await git("init", "--quiet");
		await git("config", "user.name", "Release Contract Test");
		await git("config", "user.email", "release-contract@example.invalid");
		await writeFile(path.join(repository, "historical.js"), generatedGenericCredentialFixture(), "utf8");
		await git("add", "historical.js");
		await git("commit", "--quiet", "-m", "historical fixture");
		const baseSha = await readGitHead(repository);
		await writeFile(path.join(repository, "candidate.js"), "export const candidate = true;\n", "utf8");
		await git("add", "candidate.js");
		await git("commit", "--quiet", "-m", "clean candidate");
		assert.notEqual(await runExit("gitleaks", ["git", "--redact", "--no-banner", "."], repository), 0);
		assert.equal(await runExit("gitleaks", ["git", "--redact", "--no-banner", "--log-opts", `${baseSha}..HEAD`, "."], repository), 0);
		await writeFile(path.join(repository, "candidate-leak.js"), generatedGenericCredentialFixture(), "utf8");
		await git("add", "candidate-leak.js");
		await git("commit", "--quiet", "-m", "candidate regression fixture");
		assert.notEqual(await runExit("gitleaks", ["git", "--redact", "--no-banner", "--log-opts", `${baseSha}..HEAD`, "."], repository), 0);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

function generatedGenericCredentialFixture() {
	const identifier = ["api", "key"].join("_");
	const value = randomBytes(32).toString("base64url");
	return `export const ${identifier} = "${value}";\n`;
}

async function readGitHead(repository) {
	return await new Promise((resolve, reject) => {
		const child = spawn("git", ["rev-parse", "HEAD"], { cwd: repository, stdio: ["ignore", "pipe", "ignore"] });
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { output += chunk; });
		child.once("error", reject);
		child.once("close", (code, signal) => code === 0 && signal === null ? resolve(output.trim()) : reject(new Error("git head failed")));
	});
}

async function runExit(program, arguments_, cwd) {
	return await new Promise((resolve) => {
		const child = spawn(program, arguments_, { cwd, stdio: "ignore" });
		child.once("error", () => resolve(127));
		child.once("close", (code, signal) => resolve(signal === null ? code ?? 1 : 1));
	});
}
