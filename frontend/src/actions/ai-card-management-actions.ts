"use server";

import {
	createAppAiCardManagementRepository,
	createAppAiCardMnemonicRepository,
} from "@/lib/ai-card-management/app-ai-repository";
import { mapAiCardManagementError } from "@/lib/ai-card-management/errors";
import {
	AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS,
	attachIllustrationUrls,
} from "@/lib/ai-card-management/illustration-urls";
import {
	deleteAiCards,
	listAiCards,
	setAiCardDecks,
	setAiCardTagNames,
	setAiCardTags,
	undoAiImportBatch,
	updateAiCardContent,
	updateAiCardMnemonic,
} from "@/lib/ai-card-management/service";
import type {
	AiCardActionResult,
	AiCardListPage,
	AiCardManagementOptions,
} from "@/lib/ai-card-management/types";
import { isAiCardManagementEnabled } from "@/lib/env";
import { getSignedUrl } from "@/lib/illustration/storage";
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

/**
 * Owner-scoped lookup of the storage paths behind ready illustrations of one
 * page.  Authentication, the explicit `owner_user_id` filter, and the
 * `illustrations_select_owner` RLS policy keep other owners out.  A failure
 * degrades to "no signed URL" (AC-4) and never surfaces a storage path.
 */
async function loadReadyIllustrationPaths(
	supabase: ReturnType<typeof createServerClient>,
	userId: string,
	illustrationIds: readonly string[]
): Promise<ReadonlyMap<string, string>> {
	const paths = new Map<string, string>();
	const { data, error } = await supabase
		.from("illustrations")
		.select("id, storage_path")
		.in("id", [...illustrationIds])
		.eq("owner_user_id", userId)
		.eq("status", "ready")
		.not("storage_path", "is", null);
	if (error || data === null) {
		// Degradation is silent for the user, so a permanent grant/RLS regression
		// would otherwise leave no trace at all.  Only the Supabase error code and
		// message are logged; ids, storage paths, and signed URLs never are.
		console.error("S-18 illustration path lookup failed", {
			code: error?.code,
			message: error?.message,
		});
		return paths;
	}
	for (const row of data) {
		// `status='ready'` with `storage_path IS NULL` exists in production, so the
		// row is skipped instead of being signed with an empty path.
		if (row.storage_path) paths.set(row.id, row.storage_path);
	}
	return paths;
}

export async function getAiCardListAction(
	input: unknown
): Promise<AiCardActionResult<AiCardListPage>> {
	noStore();
	const boundary = await createAuthenticatedBoundary<AiCardListPage>();
	if (!boundary.ok) return boundary.result;
	const { supabase, userId } = boundary;
	const result = await listAiCards(createAppAiCardManagementRepository(supabase), input);
	if (!result.ok) return result;
	// Signing lives here, not in the shared service: Remote MCP uses the same
	// service and must not receive signed URLs or storage paths.
	const data = await attachIllustrationUrls(result.data, {
		loadPaths: async (illustrationIds) =>
			await loadReadyIllustrationPaths(supabase, userId, illustrationIds),
		sign: async (storagePath) =>
			await getSignedUrl(storagePath, AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS),
	});
	return { ok: true, data };
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
		return {
			ok: true,
			data: {
				decks: (decks ?? []).map((deck) => ({ id: deck.id, name: deck.name })),
				tags: (tags ?? []).map((tag) => ({ id: tag.id, name: tag.display_name })),
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

/**
 * Mnemonic edits are not routed through `mutationResult`: the repository is bound
 * to the session user id (ADR-013 decision 1), which the shared factory does not
 * carry.  Flag evaluation, authentication and `revalidatePath` stay identical.
 */
export async function updateAiCardMnemonicAction(
	input: unknown
): Promise<AiCardActionResult<Json>> {
	const boundary = await createAuthenticatedBoundary<Json>();
	if (!boundary.ok) return boundary.result;
	const result = await updateAiCardMnemonic(
		createAppAiCardMnemonicRepository(boundary.supabase, boundary.userId),
		input
	);
	if (result.ok) {
		revalidatePath("/ai/cards");
	}
	return result;
}

export async function deleteAiCardsAction(input: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await deleteAiCards(repository, input));
}

export async function undoAiImportBatchAction(batchId: unknown): Promise<AiCardActionResult<Json>> {
	return await mutationResult(async (repository) => await undoAiImportBatch(repository, batchId));
}
