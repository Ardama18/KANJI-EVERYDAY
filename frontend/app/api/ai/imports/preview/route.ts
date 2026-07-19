import { NextResponse } from "next/server";

import { createAppAiImportRepository } from "@/lib/ai-import/app-ai-repository";
import { previewCardImport } from "@/lib/ai-import/service";
import { getAiPreviewHmacSecret, isAiCardImportEnabled } from "@/lib/env";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
	if (!isAiCardImportEnabled()) return safeError("FEATURE_DISABLED", 404);
	const auth = createServerClient();
	const { data: authData } = await auth.auth.getUser();
	if (authData.user === null) return safeError("UNAUTHORIZED", 401);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return safeError("VALIDATION_ERROR", 400);
	}
	if (!isRecord(body)) return safeError("VALIDATION_ERROR", 400);
	const secret = getAiPreviewHmacSecret();
	if (secret === undefined) return safeError("INTERNAL_ERROR", 500);
	const result = await previewCardImport({
		actor: { userId: authData.user.id, kind: "app_ai" },
		request: body.request,
		cardReservationKey: body.cardReservationKey,
		repository: createAppAiImportRepository(createServiceRoleClient(), authData.user.id),
		secret,
		nowSeconds: Math.floor(Date.now() / 1_000),
	});
	return result.ok
		? NextResponse.json(result.data)
		: safeError(result.error.code, result.error.httpStatus);
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
