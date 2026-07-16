import type { SafeLogEvent } from "./logger.ts";

export interface CleanupResult {
	readonly claimed: number;
	readonly deleted: number;
	readonly retry: number;
}

export interface CleanupRequestDependencies {
	readonly workerSecret: () => string | undefined;
	readonly execute: () => Promise<CleanupResult>;
	readonly log: (event: SafeLogEvent) => void;
}

export async function handleCleanupRequest(
	request: Request,
	dependencies: CleanupRequestDependencies
): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405 });
	try {
		const configuredSecret = dependencies.workerSecret()?.trim();
		if (configuredSecret === undefined || configuredSecret.length === 0) {
			throw new Error("CLEANUP_CONFIG_ERROR");
		}
		if (request.headers.get("x-ai-worker-secret") !== configuredSecret) {
			return new Response(null, { status: 401 });
		}
		return Response.json(await dependencies.execute());
	} catch {
		dependencies.log({ event: "cleanup", errorCode: "INTERNAL_ERROR" });
		return Response.json({ errorCode: "INTERNAL_ERROR" }, { status: 500 });
	}
}
