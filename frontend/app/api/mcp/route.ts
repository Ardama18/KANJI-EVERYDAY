import { handleMcpRoute } from "@/lib/mcp/route-handler";

export const runtime = "nodejs";

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
