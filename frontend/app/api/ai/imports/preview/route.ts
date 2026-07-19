import { NextResponse } from "next/server";

import { mapAiImportError } from "@/lib/ai-import/errors";
import { PreviewValidationError, createImportPreview } from "@/lib/ai-import/preview-service";
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
	if (
		!isRecord(body) ||
		typeof body.cardReservationKey !== "string" ||
		body.cardReservationKey.length < 1 ||
		body.cardReservationKey.length > 128
	)
		return safeError("VALIDATION_ERROR", 400);
	const secret = getAiPreviewHmacSecret();
	if (secret === undefined) return safeError("INTERNAL_ERROR", 500);
	const service = createServiceRoleClient();
	try {
		const preview = await createImportPreview(
			authData.user.id,
			body.request,
			body.cardReservationKey,
			{
				secret,
				nowSeconds: Math.floor(Date.now() / 1_000),
				validateDatabase: async (value) => {
					const { error } = await service.rpc("validate_ai_import_preview", {
						p_owner_user_id: authData.user.id,
						p_deck_id: value.deckId,
						p_reservation_key: value.reservationKey,
						p_import_request_hash: value.importRequestHash,
						p_upload_ids: [...value.uploadIds],
						p_items: value.items.map((item) => ({ ...item })),
					});
					if (error !== null) {
						const mapped = mapAiImportError(error, crypto.randomUUID());
						throw new PreviewValidationError(mapped.code, mapped.httpStatus);
					}
				},
			}
		);
		return NextResponse.json(preview);
	} catch (error) {
		if (error instanceof PreviewValidationError) return safeError(error.code, error.httpStatus);
		return safeError("INTERNAL_ERROR", 500);
	}
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
