import { handleMcpRoute } from "@/lib/mcp/route-handler";

export const runtime = "nodejs";

/**
 * S-21 D7: commit now generates mnemonics inside the request. The wall-clock budget
 * `MCP_AUTO_MNEMONIC_BUDGET_MS` (45s by default) must fit inside this limit.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
	return await handleMcpRoute(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
	return await handleMcpRoute(request);
}

export async function GET(request: Request): Promise<Response> {
	return await handleMcpRoute(request);
}

export async function DELETE(request: Request): Promise<Response> {
	return await handleMcpRoute(request);
}
