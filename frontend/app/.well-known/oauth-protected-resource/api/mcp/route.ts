import { getMcpEnvConfig, isMcpEnabled } from "@/lib/env";
import { getMcpMetadataConfig, getMcpProtectedResourceMetadata } from "@/lib/mcp/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
	if (!isMcpEnabled()) return new Response(null, { status: 404 });
	let env: ReturnType<typeof getMcpEnvConfig>;
	try {
		env = getMcpEnvConfig();
	} catch {
		return new Response(null, { status: 404 });
	}
	if (!env.enabled) return new Response(null, { status: 404 });
	const metadata = getMcpProtectedResourceMetadata(getMcpMetadataConfig(env));
	return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
}
