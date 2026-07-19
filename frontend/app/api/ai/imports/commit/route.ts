import { NextResponse } from "next/server";

import { createAppAiImportRepository } from "@/lib/ai-import/app-ai-repository";
import { commitCardImport } from "@/lib/ai-import/service";
import { getAiPreviewHmacSecret, isAiCardImportEnabled } from "@/lib/env";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
	if (!isAiCardImportEnabled()) return safeError("FEATURE_DISABLED", 404);
	const authClient = createServerClient();
	const { data: authData } = await authClient.auth.getUser();
	if (authData.user === null) return safeError("UNAUTHORIZED", 401);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return safeError("VALIDATION_ERROR", 400);
	}
	// Preserve the established route-level confirmation boundary before any
	// repository construction; the shared service repeats this for other
	// transports such as Remote MCP.
	if (!isRecord(body) || body.confirmedWarnings !== true) return safeError("VALIDATION_ERROR", 400);
	// The legacy service.rpc("commit_generated_import_async") invocation now
	// lives behind createAppAiImportRepository after this check.
	const secret = getAiPreviewHmacSecret();
	if (secret === undefined) return safeError("INTERNAL_ERROR", 500);
	const result = await commitCardImport({
		actor: { userId: authData.user.id, kind: "app_ai" },
		input: body,
		repository: createAppAiImportRepository(createServiceRoleClient(), authData.user.id),
		secret,
		nowSeconds: Math.floor(Date.now() / 1_000),
		correlationId: crypto.randomUUID(),
	});
	return result.ok
		? NextResponse.json(result.data, { status: 202 })
		: safeError(result.error.code, result.error.httpStatus);
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
