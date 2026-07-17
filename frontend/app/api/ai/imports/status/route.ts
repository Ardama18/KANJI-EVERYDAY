import { NextResponse } from "next/server";

import { parseImportStatusResponse } from "@/lib/ai-import/async-contract";
import { mapAiImportError } from "@/lib/ai-import/errors";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export async function GET(request: Request): Promise<Response> {
	const authClient = createServerClient();
	const { data: authData } = await authClient.auth.getUser();
	if (authData.user === null)
		return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
	const url = new URL(request.url);
	const batchId = url.searchParams.get("batchId");
	const idempotencyKey = url.searchParams.get("idempotencyKey");
	if (
		(batchId === null) === (idempotencyKey === null) ||
		(batchId !== null && !UUID_PATTERN.test(batchId)) ||
		(idempotencyKey !== null &&
			(idempotencyKey.length < 1 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH))
	) {
		return NextResponse.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
	}
	const service = createServiceRoleClient();
	try {
		const { data, error } = await service.rpc("get_ai_import_status", {
			p_actor_user_id: authData.user.id,
			p_batch_id: batchId,
			p_idempotency_key: idempotencyKey,
		});
		if (error !== null) {
			const mapped = mapAiImportError(error, crypto.randomUUID());
			return NextResponse.json(
				{ error: { code: mapped.httpStatus === 404 ? "NOT_FOUND" : mapped.code } },
				{ status: mapped.httpStatus === 404 ? 404 : Math.max(500, mapped.httpStatus) }
			);
		}
		const response = parseImportStatusResponse(data);
		if (response === undefined) {
			return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 502 });
		}
		return NextResponse.json(response);
	} catch {
		return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 });
	}
}
