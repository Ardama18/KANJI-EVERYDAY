"use server";

import { encodeAiCardCursor } from "@/lib/ai-card-management/cursor";
import { mapAiCardManagementError } from "@/lib/ai-card-management/errors";
import type {
	AiCardActionResult,
	AiCardListPage,
	AiCardManagementOptions,
} from "@/lib/ai-card-management/types";
import {
	AiCardValidationError,
	UUID_PATTERN,
	parseAiCardListFilters,
	parseBulkDeleteInput,
	parseContentInput,
	parseManagedAiCards,
	parseUuidList,
} from "@/lib/ai-card-management/validation";
import { isAiCardManagementEnabled } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { unstable_noStore as noStore, revalidatePath } from "next/cache";

const disabledResult = <T>(): AiCardActionResult<T> => ({
	ok: false,
	error: { code: "DISABLED", status: 404, message: "対象が見つかりません。" },
});

const validationResult = <T>(): AiCardActionResult<T> => ({
	ok: false,
	error: { code: "VALIDATION_ERROR", status: 400, message: "入力内容を確認してください。" },
});

async function createAuthenticatedBoundary<T>(): Promise<
	| { ok: true; supabase: ReturnType<typeof createServerClient>; userId: string }
	| { ok: false; result: AiCardActionResult<T> }
> {
	if (!isAiCardManagementEnabled()) return { ok: false, result: disabledResult<T>() };
	const supabase = createServerClient();
	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user) {
		return {
			ok: false,
			result: {
				ok: false,
				error: { code: "UNAUTHORIZED", status: 401, message: "ログインが必要です。" },
			},
		};
	}
	return { ok: true, supabase, userId: data.user.id };
}

export async function getAiCardListAction(
	input: unknown
): Promise<AiCardActionResult<AiCardListPage>> {
	noStore();
	const boundary = await createAuthenticatedBoundary<AiCardListPage>();
	if (!boundary.ok) return boundary.result;
	try {
		const filters = parseAiCardListFilters(input);
		const { data, error } = await boundary.supabase.rpc("list_ai_managed_cards", {
			p_limit: filters.limit,
			p_cursor_created_at: filters.cursorCreatedAt,
			p_cursor_id: filters.cursorId,
			p_deck_id: filters.deckId,
			p_tag_id: filters.tagId,
			p_source: filters.source,
			p_created_from: filters.createdFrom,
			p_created_to: filters.createdTo,
		});
		if (error) return { ok: false, error: mapAiCardManagementError(error) };
		const parsed = parseManagedAiCards(data);
		const last = parsed.items.at(-1);
		return {
			ok: true,
			data: {
				items: parsed.items,
				nextCursor:
					parsed.hasMore && last
						? encodeAiCardCursor({ createdAt: last.createdAt, id: last.id })
						: null,
			},
		};
	} catch (error) {
		if (error instanceof AiCardValidationError) return validationResult();
		return { ok: false, error: mapAiCardManagementError(error) };
	}
}

export async function getAiCardManagementOptionsAction(): Promise<
	AiCardActionResult<AiCardManagementOptions>
> {
	noStore();
	const boundary = await createAuthenticatedBoundary<AiCardManagementOptions>();
	if (!boundary.ok) return boundary.result;
	const { data: decks, error: deckError } = await boundary.supabase
		.from("decks")
		.select("id, name")
		.eq("owner_user_id", boundary.userId)
		.order("name", { ascending: true });
	if (deckError) return { ok: false, error: mapAiCardManagementError(deckError) };
	const { data: tags, error: tagError } = await boundary.supabase
		.from("tags")
		.select("id, display_name")
		.eq("owner_user_id", boundary.userId)
		.order("display_name", { ascending: true });
	if (tagError) return { ok: false, error: mapAiCardManagementError(tagError) };
	const { data: illustrations, error: illustrationError } = await boundary.supabase
		.from("illustrations")
		.select("id, status")
		.eq("owner_user_id", boundary.userId)
		.eq("status", "ready")
		.not("storage_path", "is", null)
		.order("created_at", { ascending: false });
	if (illustrationError) return { ok: false, error: mapAiCardManagementError(illustrationError) };
	return {
		ok: true,
		data: {
			decks: (decks ?? []).map((deck) => ({ id: deck.id, name: deck.name })),
			tags: (tags ?? []).map((tag) => ({ id: tag.id, name: tag.display_name })),
			illustrations: illustrations ?? [],
		},
	};
}

const mutationResult = async (
	call: (
		supabase: ReturnType<typeof createServerClient>
	) => PromiseLike<{ data: Json; error: unknown }>
): Promise<AiCardActionResult<Json>> => {
	const boundary = await createAuthenticatedBoundary<Json>();
	if (!boundary.ok) return boundary.result;
	try {
		const { data, error } = await call(boundary.supabase);
		if (error) return { ok: false, error: mapAiCardManagementError(error) };
		revalidatePath("/ai/cards");
		return { ok: true, data };
	} catch (error) {
		if (error instanceof AiCardValidationError) return validationResult();
		return { ok: false, error: mapAiCardManagementError(error) };
	}
};

export async function updateAiCardContentAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		const value = parseContentInput(input);
		return supabase.rpc("update_imported_card", {
			p_card_id: value.cardId,
			p_patch: value.patch,
			p_expected_updated_at: value.expectedUpdatedAt,
		});
	});
}

export async function setAiCardDecksAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		if (typeof input !== "object" || input === null)
			throw new AiCardValidationError("input is invalid");
		const value = input as Record<string, unknown>;
		if (typeof value.cardId !== "string" || !UUID_PATTERN.test(value.cardId))
			throw new AiCardValidationError("cardId is invalid");
		return supabase.rpc("set_card_decks", {
			p_card_id: value.cardId,
			p_deck_ids: parseUuidList(value.deckIds, "deckIds"),
		});
	});
}

export async function setAiCardTagsAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		if (typeof input !== "object" || input === null)
			throw new AiCardValidationError("input is invalid");
		const value = input as Record<string, unknown>;
		if (typeof value.cardId !== "string" || !UUID_PATTERN.test(value.cardId))
			throw new AiCardValidationError("cardId is invalid");
		return supabase.rpc("set_card_tags", {
			p_card_id: value.cardId,
			p_tag_ids: parseUuidList(value.tagIds, "tagIds", 10),
		});
	});
}

export async function setAiCardTagNamesAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		if (typeof input !== "object" || input === null)
			throw new AiCardValidationError("input is invalid");
		const value = input as Record<string, unknown>;
		if (typeof value.cardId !== "string" || !UUID_PATTERN.test(value.cardId))
			throw new AiCardValidationError("cardId is invalid");
		if (!Array.isArray(value.tagNames) || value.tagNames.length > 10)
			throw new AiCardValidationError("tagNames is invalid");
		const tagNames = value.tagNames.map((name) => {
			if (typeof name !== "string") throw new AiCardValidationError("tagNames is invalid");
			const normalized = name.normalize("NFKC").trim();
			if (normalized.length < 1 || normalized.length > 30)
				throw new AiCardValidationError("tagNames is invalid");
			return normalized;
		});
		if (new Set(tagNames.map((name) => name.toLowerCase())).size !== tagNames.length)
			throw new AiCardValidationError("tagNames contains duplicates");
		return supabase.rpc("set_card_tag_names", { p_card_id: value.cardId, p_tag_names: tagNames });
	});
}

export async function setAiCardIllustrationAction(
	input: unknown
): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		if (typeof input !== "object" || input === null)
			throw new AiCardValidationError("input is invalid");
		const value = input as Record<string, unknown>;
		if (typeof value.cardId !== "string" || !UUID_PATTERN.test(value.cardId))
			throw new AiCardValidationError("cardId is invalid");
		if (
			value.illustrationId !== null &&
			(typeof value.illustrationId !== "string" || !UUID_PATTERN.test(value.illustrationId))
		) {
			throw new AiCardValidationError("illustrationId is invalid");
		}
		return supabase.rpc("set_card_illustration", {
			p_card_id: value.cardId,
			p_illustration_id: value.illustrationId as string | null,
		});
	});
}

export async function deleteAiCardsAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) =>
		supabase.rpc("bulk_delete_imported_cards", { p_cards: parseBulkDeleteInput(input) })
	);
}

export async function undoAiImportBatchAction(batchId: unknown): Promise<AiCardActionResult<Json>> {
	return mutationResult((supabase) => {
		if (typeof batchId !== "string" || !UUID_PATTERN.test(batchId))
			throw new AiCardValidationError("batchId is invalid");
		return supabase.rpc("undo_import", { p_batch_id: batchId });
	});
}
