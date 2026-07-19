"use server";

import { createAppAiCardManagementRepository } from "@/lib/ai-card-management/app-ai-repository";
import { mapAiCardManagementError } from "@/lib/ai-card-management/errors";
import {
	deleteAiCards,
	listAiCards,
	setAiCardDecks,
	setAiCardIllustration,
	setAiCardTagNames,
	setAiCardTags,
	undoAiImportBatch,
	updateAiCardContent,
} from "@/lib/ai-card-management/service";
import type {
	AiCardActionResult,
	AiCardListPage,
	AiCardManagementOptions,
} from "@/lib/ai-card-management/types";
import { isAiCardManagementEnabled } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { unstable_noStore as noStore, revalidatePath } from "next/cache";

const disabledResult = <T>(): AiCardActionResult<T> => ({
	ok: false,
	error: { code: "DISABLED", status: 404, message: "対象が見つかりません。" },
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
	return await listAiCards(createAppAiCardManagementRepository(boundary.supabase), input);
}

export async function getAiCardManagementOptionsAction(): Promise<
	AiCardActionResult<AiCardManagementOptions>
> {
	noStore();
	const boundary = await createAuthenticatedBoundary<AiCardManagementOptions>();
	if (!boundary.ok) return boundary.result;
	try {
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
		if (illustrationError) {
			return { ok: false, error: mapAiCardManagementError(illustrationError) };
		}
		return {
			ok: true,
			data: {
				decks: (decks ?? []).map((deck) => ({ id: deck.id, name: deck.name })),
				tags: (tags ?? []).map((tag) => ({ id: tag.id, name: tag.display_name })),
				illustrations: illustrations ?? [],
			},
		};
	} catch (error) {
		return { ok: false, error: mapAiCardManagementError(error) };
	}
}

const mutationResult = async (
	call: (
		repository: ReturnType<typeof createAppAiCardManagementRepository>
	) => Promise<AiCardActionResult<Json>>
): Promise<AiCardActionResult<Json>> => {
	const boundary = await createAuthenticatedBoundary<Json>();
	if (!boundary.ok) return boundary.result;
	const result = await call(createAppAiCardManagementRepository(boundary.supabase));
	if (result.ok) {
		revalidatePath("/ai/cards");
	}
	return result;
};

export async function updateAiCardContentAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await updateAiCardContent(repository, input));
}

export async function setAiCardDecksAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await setAiCardDecks(repository, input));
}

export async function setAiCardTagsAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await setAiCardTags(repository, input));
}

export async function setAiCardTagNamesAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await setAiCardTagNames(repository, input));
}

export async function setAiCardIllustrationAction(
	input: unknown
): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await setAiCardIllustration(repository, input));
}

export async function deleteAiCardsAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await deleteAiCards(repository, input));
}

export async function undoAiImportBatchAction(batchId: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await undoAiImportBatch(repository, batchId));
}
