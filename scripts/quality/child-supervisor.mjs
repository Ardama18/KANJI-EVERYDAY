import { spawn } from "node:child_process";

export const DEFAULT_CHILD_KILL_GRACE_MS = 250;
export const DEFAULT_CHILD_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

export class ChildSupervisorError extends Error {
	constructor(message) {
		super(message);
		this.name = "ChildSupervisorError";
	}
}

/**
 * Spawn one child behind a wall-clock deadline and a bounded output budget.
 * Timeout, abort, and output overflow all settle through SIGTERM -> SIGKILL -> close;
 * the returned promise never resolves while the child is still alive.
 */
export async function runSupervisedChild(input) {
	validatePositiveInteger(input.timeoutMs, "child timeout");
	const killGraceMs = input.killGraceMs ?? DEFAULT_CHILD_KILL_GRACE_MS;
	const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_CHILD_OUTPUT_LIMIT_BYTES;
	validatePositiveInteger(killGraceMs, "child kill grace");
	validatePositiveInteger(maxOutputBytes, "child output limit");
	return await new Promise((resolve, reject) => {
		const child = spawn(input.program, [...input.arguments], {
			stdio: [input.standardInput === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			env: input.environment,
			cwd: input.cwd,
		});
		input.onSpawn?.(child);
		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		let terminationReason;
		let closed = false;
		let killTimer;
		const timeout = setTimeout(() => requestTermination("timeout"), input.timeoutMs);
		const onAbort = () => requestTermination("aborted");
		input.signal?.addEventListener("abort", onAbort, { once: true });

		const append = (target, chunk) => {
			const text = String(chunk);
			outputBytes += Buffer.byteLength(text);
			if (outputBytes > maxOutputBytes) {
				requestTermination("output_limit");
				return target;
			}
			return target + text;
		};
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
		child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
		child.stdin?.on("error", () => undefined);
		if (input.standardInput !== undefined) child.stdin?.end(input.standardInput);

		child.once("error", () => {
			finish();
			reject(new ChildSupervisorError("Child process unavailable"));
		});
		child.once("close", (exitCode, signal) => {
			if (closed) return;
			finish();
			resolve({ stdout, stderr, exitCode, signal, terminationReason });
		});

		if (input.signal?.aborted === true) requestTermination("aborted");

		function requestTermination(reason) {
			if (closed || terminationReason !== undefined) return;
			terminationReason = reason;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (!closed && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, killGraceMs);
		}

		function finish() {
			if (closed) return;
			closed = true;
			clearTimeout(timeout);
			if (killTimer !== undefined) clearTimeout(killTimer);
			input.signal?.removeEventListener("abort", onAbort);
		}
	});
}

/** Attach the same TERM -> KILL settlement fence to a child whose stdin must
 * remain open (for example, an advisory-lock lease). */
export function superviseSpawnedChild(child, input) {
	const killGraceMs = input.killGraceMs ?? DEFAULT_CHILD_KILL_GRACE_MS;
	validatePositiveInteger(killGraceMs, "child kill grace");
	let closed = false;
	let terminationReason;
	let deadlineTimer;
	let killTimer;
	let settle;
	let fail;
	const settled = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
	child.once("error", () => {
		finish();
		fail(new ChildSupervisorError("Child process unavailable"));
	});
	child.once("close", (exitCode, signal) => {
		if (closed) return;
		finish();
		settle({ exitCode, signal, terminationReason });
	});
	const onAbort = () => terminate("aborted");
	input.signal?.addEventListener("abort", onAbort, { once: true });
	if (input.timeoutMs !== undefined) armDeadline(input.timeoutMs);
	if (input.signal?.aborted === true) terminate("aborted");
	return { settled, terminate, armDeadline, clearDeadline: () => clearTimeout(deadlineTimer) };

	function armDeadline(timeoutMs) {
		validatePositiveInteger(timeoutMs, "child timeout");
		clearTimeout(deadlineTimer);
		deadlineTimer = setTimeout(() => terminate("timeout"), timeoutMs);
	}

	function terminate(reason = "requested") {
		if (closed || terminationReason !== undefined) return;
		terminationReason = reason;
		child.kill("SIGTERM");
		killTimer = setTimeout(() => {
			if (!closed && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		}, killGraceMs);
	}

	function finish() {
		if (closed) return;
		closed = true;
		clearTimeout(deadlineTimer);
		clearTimeout(killTimer);
		input.signal?.removeEventListener("abort", onAbort);
	}
}

function validatePositiveInteger(value, label) {
	if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}
