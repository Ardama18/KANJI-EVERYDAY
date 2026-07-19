import { NextResponse } from "next/server";

import {
	parseGenerationSourceUploadIds,
	releaseGenerationSources,
} from "@/lib/ai-card-generation/generation-source-service";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
	const auth = createServerClient();
	const { data: authData } = await auth.auth.getUser();
	if (authData.user === null) return safeError("UNAUTHORIZED", 401);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return safeError("VALIDATION_ERROR", 400);
	}
	const uploadIds = isRecord(body) ? parseGenerationSourceUploadIds(body.uploadIds) : undefined;
	if (uploadIds === undefined || uploadIds.length === 0) return safeError("VALIDATION_ERROR", 400);
	const service = createServiceRoleClient();
	const result = await releaseGenerationSources(service, authData.user.id, uploadIds);
	if (result.notFound) return safeError("NOT_FOUND", 404);
	return NextResponse.json({ released: result.released, cleanupPending: result.cleanupPending });
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
