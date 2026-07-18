import { NextResponse } from "next/server";

import type { GenerateCardDraftInput } from "@/lib/ai-card-generation/contracts";
import { AiCardGenerationError } from "@/lib/ai-card-generation/errors";
import { generateCardDraft } from "@/lib/ai-card-generation/generation-service";
import {
	GenerationSourceError,
	loadGenerationSources,
	parseGenerationSourceUploadIds,
	releaseGenerationSources,
} from "@/lib/ai-card-generation/generation-source-service";
import { moderate } from "@/lib/ai-card-generation/moderation";
import { requestOpenAiConcepts } from "@/lib/ai-card-generation/openai-adapter";
import { validateGenerationInput } from "@/lib/ai-card-generation/output-mapper";
import { mapAiImportError } from "@/lib/ai-import/errors";
import { PreviewValidationError, createImportPreview } from "@/lib/ai-import/preview-service";
import {
	getAiPreviewHmacSecret,
	getOpenAiCardGenerationConfig,
	isAiCardImportEnabled,
} from "@/lib/env";
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
	const parsed = parseGenerateRequest(body);
	if (parsed === undefined) return safeError("VALIDATION_ERROR", 400);
	const checked = validateGenerationInput(parsed.input);
	if (!checked.success) return safeError("VALIDATION_ERROR", 400);
	const config = getOpenAiCardGenerationConfig();
	if (config === undefined) return safeError("OPENAI_PROVIDER_CONFIG", 503);
	const secret = getAiPreviewHmacSecret();
	if (secret === undefined) return safeError("INTERNAL_ERROR", 500);
	const service = createServiceRoleClient();
	const { data: deck, error: deckError } = await service
		.from("decks")
		.select("id")
		.eq("id", checked.data.deckId)
		.eq("owner_user_id", authData.user.id)
		.maybeSingle();
	if (deckError !== null || deck === null) return safeError("DECK_NOT_FOUND", 404);
	const releaseIds = parsed.sourceUploadIds;
	try {
		const sources = await loadGenerationSources(service, authData.user.id, releaseIds);
		const preview = await generateCardDraft(checked.data, sources, {
			moderateText: async (text, stage) =>
				await moderate({
					config,
					input: { kind: "text", text },
					flaggedCode:
						stage === "input" ? "OPENAI_INPUT_TEXT_MODERATION" : "OPENAI_OUTPUT_MODERATION",
				}),
			moderateImage: async (image) =>
				await moderate({
					config,
					input: { kind: "image", image },
					flaggedCode: "OPENAI_INPUT_IMAGE_MODERATION",
				}),
			reserveUsage: async (value) => {
				const { error } = await service.rpc("reserve_provider_usage", {
					p_owner_user_id: authData.user.id,
					p_reservation_key: value.reservationKey,
					p_kind: "card_generation",
					p_source: "app_ai",
					p_generation_request_hash: value.generationRequestHash,
					p_units: value.units,
				});
				if (error !== null) throw mappedPreviewError(error);
			},
			requestConcepts: async (input, images) =>
				await requestOpenAiConcepts({ config, input, images }),
			createPreview: async (importRequest, reservationKey) =>
				await createImportPreview(authData.user.id, importRequest, reservationKey, {
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
						if (error !== null) throw mappedPreviewError(error);
					},
				}),
		});
		return NextResponse.json(preview);
	} catch (error) {
		if (error instanceof AiCardGenerationError) return safeError(error.code, error.httpStatus);
		if (error instanceof GenerationSourceError)
			return safeError(error.code, error.code === "DECK_NOT_FOUND" ? 404 : 503);
		if (error instanceof PreviewValidationError) return safeError(error.code, error.httpStatus);
		return safeError("INTERNAL_ERROR", 500);
	} finally {
		if (releaseIds.length > 0)
			await releaseGenerationSources(service, authData.user.id, releaseIds);
	}
}

function mappedPreviewError(error: unknown): PreviewValidationError {
	const mapped = mapAiImportError(error, crypto.randomUUID());
	return new PreviewValidationError(mapped.code, mapped.httpStatus);
}

function parseGenerateRequest(
	value: unknown
):
	| { readonly input: GenerateCardDraftInput; readonly sourceUploadIds: readonly string[] }
	| undefined {
	if (
		!isRecord(value) ||
		typeof value.deckId !== "string" ||
		typeof value.instruction !== "string" ||
		(value.pattern !== "R1" && value.pattern !== "W1" && value.pattern !== "both") ||
		typeof value.requestedCardCount !== "number" ||
		!Array.isArray(value.tags) ||
		value.tags.some((tag) => typeof tag !== "string") ||
		(value.illustration !== "none" &&
			value.illustration !== "ai" &&
			value.illustration !== "upload") ||
		typeof value.generationReservationKey !== "string"
	)
		return undefined;
	const sourceUploadIds = parseGenerationSourceUploadIds(value.sourceUploadIds);
	if (sourceUploadIds === undefined) return undefined;
	return {
		input: {
			deckId: value.deckId,
			instruction: value.instruction,
			pattern: value.pattern,
			requestedCardCount: value.requestedCardCount,
			tags: value.tags,
			illustration: value.illustration,
			generationReservationKey: value.generationReservationKey,
		},
		sourceUploadIds,
	};
}

function safeError(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
