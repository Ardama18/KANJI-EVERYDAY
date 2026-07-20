import {
	type McpEnvConfig,
	getAiPreviewHmacSecret,
	getMcpEnvConfig,
	isMcpEnabled,
} from "@/lib/env";
import { type JwtScopedSupabaseClient, createJwtScopedClient } from "@/lib/supabase/server";

import {
	type McpActorContext,
	authenticateMcpRequest,
	createDefaultMcpAuthDependencies,
	createMcpUnauthorizedResponse,
	parseBearerToken,
} from "./auth";
import { getMcpMetadataConfig } from "./metadata";
import { handleMcpServerRequest } from "./server";
import { createMcpToolServices } from "./services";
import { MCP_TOOL_NAMES, type McpToolServices } from "./tools";

const MAX_MCP_PAYLOAD_BYTES = 1_048_576;

export interface McpRouteDependencies {
	readonly isEnabled: () => boolean;
	readonly getEnv: typeof getMcpEnvConfig;
	readonly authenticate: (authorization: readonly string[]) => Promise<McpActorContext>;
	readonly createClient: (accessToken: string) => JwtScopedSupabaseClient;
	readonly createServices: (
		client: JwtScopedSupabaseClient,
		actor: McpActorContext
	) => McpToolServices;
	readonly handleTransport: (request: Request, services: McpToolServices) => Promise<Response>;
}

export function createDefaultMcpRouteDependencies(): McpRouteDependencies {
	return {
		isEnabled: isMcpEnabled,
		getEnv: getMcpEnvConfig,
		authenticate: async (authorization) =>
			await authenticateMcpRequest(authorization, createDefaultMcpAuthDependencies()),
		createClient: createJwtScopedClient,
		createServices: (client, actor) =>
			createMcpToolServices({
				client,
				actor,
				previewSecret: getAiPreviewHmacSecret(),
				nowSeconds: Math.floor(Date.now() / 1_000),
				createReservationKey: () => crypto.randomUUID(),
				createCorrelationId: () => crypto.randomUUID(),
			}),
		handleTransport: handleMcpServerRequest,
	};
}

export async function handleMcpRoute(
	request: Request,
	dependencies: McpRouteDependencies = createDefaultMcpRouteDependencies()
): Promise<Response> {
	if (!dependencies.isEnabled()) return unavailableResponse();

	let env: McpEnvConfig;
	try {
		env = dependencies.getEnv();
	} catch {
		return unavailableResponse();
	}
	if (!env.enabled) return unavailableResponse();

	const requestBoundary = validateHttpBoundary(request, env.publicOrigin, env.allowedOrigin);
	if (requestBoundary !== undefined) return requestBoundary;
	if (request.method === "OPTIONS") return optionsResponse(env.allowedOrigin);
	if (request.method !== "POST") return methodNotAllowedResponse();

	const parsedBody = await inspectMcpPayload(request);
	if (parsedBody instanceof Response) return parsedBody;

	const authorization = request.headers.get("authorization");
	let token: string;
	let actor: McpActorContext;
	try {
		token = parseBearerToken(authorization === null ? [] : [authorization]);
		actor = await dependencies.authenticate(authorization === null ? [] : [authorization]);
	} catch {
		return createMcpUnauthorizedResponse(getMcpMetadataConfig(env));
	}
	if (isUnknownToolCall(parsedBody)) return protocolError(parsedBody);
	try {
		const client = dependencies.createClient(token);
		return await dependencies.handleTransport(request, dependencies.createServices(client, actor));
	} catch {
		return internalServerErrorResponse();
	}
}

function validateHttpBoundary(
	request: Request,
	publicOrigin: string,
	allowedOrigin: string
): Response | undefined {
	const host = request.headers.get("host");
	if (host === null || host !== new URL(publicOrigin).host) return forbiddenResponse();
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== allowedOrigin) return forbiddenResponse();
	if (request.method === "POST") {
		if (!isJsonContentType(request.headers.get("content-type")))
			return unsupportedMediaTypeResponse();
		if (!acceptsMcpJson(request.headers.get("accept"))) return notAcceptableResponse();
		const contentLength = request.headers.get("content-length");
		if (contentLength !== null && !isAcceptableContentLength(contentLength)) {
			return payloadTooLargeResponse();
		}
	}
	return undefined;
}

async function inspectMcpPayload(request: Request): Promise<unknown | Response> {
	try {
		const bytes = await request.clone().arrayBuffer();
		if (bytes.byteLength > MAX_MCP_PAYLOAD_BYTES) return payloadTooLargeResponse();
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return protocolError(undefined, -32700);
	}
}

function isJsonContentType(value: string | null): boolean {
	const mediaType = parseMediaType(value);
	return (
		mediaType === null ||
		mediaType === "" ||
		mediaType === "application/json" ||
		mediaType === "application/json-rpc" ||
		mediaType === "text/plain"
	);
}

function acceptsMcpJson(value: string | null): boolean {
	if (value === null) return true;
	return value
		.split(",")
		.map((part) => part.trim().split(";", 1)[0]?.toLowerCase())
		.some((part) => part === "application/json" || part === "text/event-stream" || part === "*/*");
}

function parseMediaType(value: string | null): string | null {
	if (value === null) return null;
	return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isAcceptableContentLength(value: string): boolean {
	return /^\d+$/u.test(value) && Number(value) <= MAX_MCP_PAYLOAD_BYTES;
}

function isUnknownToolCall(value: unknown): value is Readonly<{ id?: unknown }> {
	if (!isRecord(value) || value.method !== "tools/call" || !isRecord(value.params)) return false;
	return (
		typeof value.params.name !== "string" ||
		!(MCP_TOOL_NAMES as readonly string[]).includes(value.params.name)
	);
}

function protocolError(value: unknown, code = -32602): Response {
	const id =
		isRecord(value) && (typeof value.id === "string" || typeof value.id === "number")
			? value.id
			: null;
	return Response.json(
		{ jsonrpc: "2.0", id, error: { code, message: "Invalid Request" } },
		{ status: 400, headers: noStoreHeaders() }
	);
}

function unavailableResponse(): Response {
	return new Response(null, { status: 404, headers: noStoreHeaders() });
}

function forbiddenResponse(): Response {
	return Response.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
}

function unsupportedMediaTypeResponse(): Response {
	return Response.json(
		{ error: "unsupported_media_type" },
		{ status: 415, headers: noStoreHeaders() }
	);
}

function notAcceptableResponse(): Response {
	return Response.json({ error: "not_acceptable" }, { status: 406, headers: noStoreHeaders() });
}

function payloadTooLargeResponse(): Response {
	return Response.json({ error: "payload_too_large" }, { status: 413, headers: noStoreHeaders() });
}

function internalServerErrorResponse(): Response {
	return Response.json(
		{ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
		{ status: 500, headers: noStoreHeaders() }
	);
}

function methodNotAllowedResponse(): Response {
	return new Response(null, {
		status: 405,
		headers: { ...noStoreHeaders(), Allow: "POST, OPTIONS" },
	});
}

function optionsResponse(allowedOrigin: string): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...noStoreHeaders(),
			"Access-Control-Allow-Origin": allowedOrigin,
			"Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
		},
	});
}

function noStoreHeaders(): Record<string, string> {
	return { "Cache-Control": "no-store" };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
