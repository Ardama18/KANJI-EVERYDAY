import { NextResponse } from "next/server";

import { createAppAiImportRepository } from "@/lib/ai-import/app-ai-repository";
import { getImportStatus } from "@/lib/ai-import/service";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
	const authClient = createServerClient();
	const { data: authData } = await authClient.auth.getUser();
	if (authData.user === null)
		return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
	const url = new URL(request.url);
	const result = await getImportStatus({
		input: {
			...(url.searchParams.has("batchId") ? { batchId: url.searchParams.get("batchId") } : {}),
			...(url.searchParams.has("idempotencyKey")
				? { idempotencyKey: url.searchParams.get("idempotencyKey") }
				: {}),
		},
		repository: createAppAiImportRepository(createServiceRoleClient(), authData.user.id),
		correlationId: crypto.randomUUID(),
	});
	return result.ok
		? NextResponse.json(result.data)
		: NextResponse.json(
				{ error: { code: result.error.code } },
				{ status: result.error.httpStatus }
			);
}
