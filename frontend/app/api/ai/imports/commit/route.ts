import { NextResponse } from "next/server";

import { normalizedRequestToJson, parseCommitAsyncResponse } from "@/lib/ai-import/async-contract";
import { hashImportRequest } from "@/lib/ai-import/canonical-request";
import { mapAiImportError } from "@/lib/ai-import/errors";
import { PreviewTokenError, verifyPreviewToken } from "@/lib/ai-import/preview-token";
import { validateImportRequest } from "@/lib/ai-import/schema";
import { getAiPreviewHmacSecret, isAiCardImportEnabled } from "@/lib/env";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
	if (!isAiCardImportEnabled()) return safeError("FEATURE_DISABLED", 404);
	const correlationId = crypto.randomUUID();
	try {
		const authClient = createServerClient();
		const { data: authData } = await authClient.auth.getUser();
		if (authData.user === null) return safeError("UNAUTHORIZED", 401);
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return safeError("VALIDATION_ERROR", 400);
		}
		if (!isRecord(body)) return safeError("VALIDATION_ERROR", 400);
		if (body.confirmedWarnings !== true) return safeError("CONFIRMATION_REQUIRED", 400);
		const idempotencyKey = boundedString(body.idempotencyKey, 128);
		const importRequestHash = hexHash(body.importRequestHash);
		const cardReservationKey = boundedString(body.cardReservationKey, 128);
		const previewToken = boundedString(body.previewToken, 4096);
		if (
			idempotencyKey === undefined ||
			importRequestHash === undefined ||
			cardReservationKey === undefined ||
			previewToken === undefined
		) {
			return safeError("VALIDATION_ERROR", 400);
		}
		const validated = await validateImportRequest(body.request);
		if (!validated.success)
			return safeError(validated.code, validated.code === "DUPLICATE_IN_REQUEST" ? 409 : 400);
		if ((await hashImportRequest(validated.data)) !== importRequestHash)
			return safeError("VALIDATION_ERROR", 400);
		const secret = getAiPreviewHmacSecret();
		if (secret === undefined) return safeError("INTERNAL_ERROR", 500);
		try {
			await verifyPreviewToken(
				previewToken,
				{ userId: authData.user.id, reservationKey: cardReservationKey, importRequestHash },
				secret,
				Math.floor(Date.now() / 1000)
			);
		} catch (error) {
			if (error instanceof PreviewTokenError) return safeError("UNAUTHORIZED", 401);
			throw error;
		}
		const service = createServiceRoleClient();
		let result: Awaited<ReturnType<typeof service.rpc>>;
		try {
			result = await service.rpc("commit_import_async", {
				p_actor_user_id: authData.user.id,
				p_source: "app_ai",
				p_idempotency_key: idempotencyKey,
				p_import_request_hash: importRequestHash,
				p_request: normalizedRequestToJson(validated.data),
				p_card_reservation_key: cardReservationKey,
			});
		} catch {
			return safeError("SERVICE_UNAVAILABLE", 503);
		}
		const { data, error } = result;
		if (error !== null) {
			const mapped = mapAiImportError(error, correlationId);
			if (mapped.code === "INTERNAL_ERROR") return safeError("SERVICE_UNAVAILABLE", 503);
			return safeError(mapped.code, mapped.httpStatus);
		}
		const response = parseCommitAsyncResponse(data);
		if (response === undefined) return safeError("INTERNAL_ERROR", 500);
		return NextResponse.json(response, { status: 202 });
	} catch (error) {
		const mapped = mapAiImportError(error, correlationId);
		return safeError(mapped.code, mapped.httpStatus);
	}
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function boundedString(value: unknown, maxLength: number): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= maxLength
		? value
		: undefined;
}

function hexHash(value: unknown): string | undefined {
	return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
