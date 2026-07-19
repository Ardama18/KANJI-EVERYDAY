import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
	MCP_TOOL_NAMES,
	type McpToolName,
	type McpToolServices,
	invokeMcpTool,
	mcpToolDescriptors,
	mcpToolInputSchemas,
} from "./tools";

const MCP_SERVER_INFO = Object.freeze({ name: "kanji-everyday-ai-cards", version: "1.0.0" });

/**
 * A server is created per HTTP request.  The transport is explicitly stateless:
 * import work is persisted through the existing batch/idempotency contract, not
 * through an in-memory MCP session.
 */
export function createMcpServer(services: McpToolServices): McpServer {
	const server = new McpServer(MCP_SERVER_INFO);
	for (const name of MCP_TOOL_NAMES) registerTool(server, name, services);
	return server;
}

export async function handleMcpServerRequest(
	request: Request,
	services: McpToolServices
): Promise<Response> {
	const shouldMirrorSecuritySchemes = await isToolsListRequest(request);
	const server = createMcpServer(services);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		const response = await transport.handleRequest(request);
		return shouldMirrorSecuritySchemes ? await mirrorTopLevelSecuritySchemes(response) : response;
	} finally {
		await server.close();
	}
}

function registerTool(server: McpServer, name: McpToolName, services: McpToolServices): void {
	const descriptor = mcpToolDescriptors[name];
	server.registerTool(
		name,
		{
			description: descriptor.description,
			inputSchema: mcpToolInputSchemas[name],
			annotations: descriptor.annotations,
			_meta: { securitySchemes: descriptor._meta.securitySchemes },
		},
		async (input: unknown) =>
			(await invokeMcpTool(name, input, services)) as unknown as CallToolResult
	);
}

async function isToolsListRequest(request: Request): Promise<boolean> {
	try {
		const body = (await request.clone().json()) as unknown;
		return (
			typeof body === "object" &&
			body !== null &&
			!Array.isArray(body) &&
			(body as { method?: unknown }).method === "tools/list"
		);
	} catch {
		return false;
	}
}

async function mirrorTopLevelSecuritySchemes(response: Response): Promise<Response> {
	if (response.headers.get("content-type")?.includes("application/json") !== true) return response;
	const body = (await response.clone().json()) as unknown;
	if (!isToolsListBody(body)) return response;
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return Response.json(
		{
			...body,
			result: {
				...body.result,
				tools: body.result.tools.map((tool) => {
					const name = tool.name as McpToolName;
					return {
						...tool,
						securitySchemes: mcpToolDescriptors[name].securitySchemes,
						_meta: {
							...(tool._meta ?? {}),
							securitySchemes: mcpToolDescriptors[name]._meta.securitySchemes,
						},
					};
				}),
			},
		},
		{ status: response.status, headers }
	);
}

function isToolsListBody(value: unknown): value is Readonly<{
	result: Readonly<{
		tools: ReadonlyArray<Readonly<{ name: string; _meta?: Readonly<Record<string, unknown>> }>>;
	}>;
}> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const result = (value as { result?: unknown }).result;
	if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
	const tools = (result as { tools?: unknown }).tools;
	return (
		Array.isArray(tools) &&
		tools.every(
			(tool) =>
				typeof tool === "object" &&
				tool !== null &&
				!Array.isArray(tool) &&
				typeof (tool as { name?: unknown }).name === "string" &&
				(MCP_TOOL_NAMES as readonly string[]).includes((tool as { name: string }).name)
		)
	);
}
