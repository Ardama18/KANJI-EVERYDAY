import type { SafeLogEvent } from "./logger.ts";
import type { WorkerOutcome } from "./worker.ts";

export interface WorkerInvocationDependencies {
	readonly execute: () => Promise<WorkerOutcome>;
	readonly log: (event: SafeLogEvent) => void;
}

export interface WorkerRequestDependencies extends WorkerInvocationDependencies {
	readonly workerSecret: () => string | undefined;
	readonly stagingSupportSecret?: () => string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STAGING_SUPPORT_HEADER = "x-s11-staging-support-secret";

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
		const candidateStagingSecret = request.headers.get(STAGING_SUPPORT_HEADER);
		if (candidateStagingSecret !== null) {
			const configuredStagingSecret = dependencies.stagingSupportSecret?.()?.trim();
			if (
				configuredStagingSecret === undefined ||
				configuredStagingSecret.length === 0 ||
				candidateStagingSecret.length === 0 ||
				!await constantTimeSecretMatch(candidateStagingSecret, configuredStagingSecret)
			) {
				return new Response(null, { status: 403 });
			}
			throw new Error("STAGING_RECOVERABLE_PROBE");
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

async function constantTimeSecretMatch(left: string, right: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [leftDigest, rightDigest] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(left)),
		crypto.subtle.digest("SHA-256", encoder.encode(right)),
	]);
	const leftBytes = new Uint8Array(leftDigest);
	const rightBytes = new Uint8Array(rightDigest);
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		difference |= leftBytes[index] ^ rightBytes[index];
	}
	return difference === 0;
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
