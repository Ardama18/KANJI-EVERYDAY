import type { SafeLogEvent } from "./logger.ts";
import type { WorkerOutcome } from "./worker.ts";

export interface WorkerInvocationDependencies {
	readonly execute: () => Promise<WorkerOutcome>;
	readonly log: (event: SafeLogEvent) => void;
}

export interface WorkerRequestDependencies extends WorkerInvocationDependencies {
	readonly workerSecret: () => string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Actual HTTP boundary. Configuration lookup is intentionally lazy so missing,
 * blank, or unreadable secrets are observed inside the same safe fault fence as
 * the rest of worker setup. Authentication denials are not infrastructure faults.
 */
export async function handleWorkerRequest(
	request: Request,
	dependencies: WorkerRequestDependencies
): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const candidateInvocationId = request.headers.get("x-ai-worker-invocation-id")?.trim();
	const invocationId =
		candidateInvocationId !== undefined && UUID_PATTERN.test(candidateInvocationId)
			? candidateInvocationId
			: undefined;
	if (candidateInvocationId !== undefined && invocationId === undefined) {
		return Response.json({ errorCode: "VALIDATION_ERROR" }, { status: 400 });
	}
	try {
		const configuredSecret = dependencies.workerSecret()?.trim();
		if (configuredSecret === undefined || configuredSecret.length === 0) {
			throw new Error("WORKER_CONFIG_ERROR");
		}
		if (request.headers.get("x-ai-worker-secret") !== configuredSecret) {
			return new Response(null, { status: 401 });
		}
		return Response.json({ outcome: await dependencies.execute(), ...(invocationId === undefined ? {} : { invocationId }) });
	} catch {
		dependencies.log({
			event: "worker_recoverable",
			errorCode: "INTERNAL_ERROR",
			invocationId,
		});
		return Response.json(
			{ errorCode: "INTERNAL_ERROR", ...(invocationId === undefined ? {} : { invocationId }) },
			{ status: 500 }
		);
	}
}

/**
 * Invocation-level faults have no proof that a business failure was persisted.
 * They remain recoverable under Queue visibility/fencing and must never be
 * represented as a terminal worker failure.
 */
export async function handleWorkerInvocation(
	dependencies: WorkerInvocationDependencies
): Promise<Response> {
	try {
		return Response.json({ outcome: await dependencies.execute() });
	} catch {
		dependencies.log({ event: "worker_recoverable", errorCode: "INTERNAL_ERROR" });
		return Response.json({ errorCode: "INTERNAL_ERROR" }, { status: 500 });
	}
}
