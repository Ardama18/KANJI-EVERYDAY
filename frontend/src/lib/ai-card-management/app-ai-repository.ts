import type {
	MnemonicExplanationDraft,
	MnemonicSlotsDraft,
} from "@/lib/ai-card-generation/contracts";
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import type { AiCardManagementRepository, AiCardManagementRepositoryResult } from "./service";

/**
 * The existing cookie/RLS UI adapter.  Remote MCP obtains a different,
 * JWT-scoped repository in Phase 4 and never receives this client.
 */
export function createAppAiCardManagementRepository(
	client: ServerSupabaseClient
): AiCardManagementRepository {
	return {
		async list(input) {
			const { data, error } = await client.rpc("list_ai_managed_cards", {
				p_limit: input.limit,
				p_cursor_created_at: input.cursorCreatedAt,
				p_cursor_id: input.cursorId,
				p_deck_id: input.deckId,
				p_tag_id: input.tagId,
				p_source: input.source,
				p_created_from: input.createdFrom,
				p_created_to: input.createdTo,
			});
			return { data, error };
		},
		async updateContent(input) {
			const { data, error } = await client.rpc("update_imported_card", {
				p_card_id: input.cardId,
				p_patch: input.patch,
				p_expected_updated_at: input.expectedUpdatedAt,
			});
			return { data, error };
		},
		async setDecks(input) {
			const { data, error } = await client.rpc("set_card_decks", {
				p_card_id: input.cardId,
				p_deck_ids: [...input.deckIds],
			});
			return { data, error };
		},
		async setTags(input) {
			const { data, error } = await client.rpc("set_card_tags", {
				p_card_id: input.cardId,
				p_tag_ids: [...input.tagIds],
			});
			return { data, error };
		},
		async setTagNames(input) {
			const { data, error } = await client.rpc("set_card_tag_names", {
				p_card_id: input.cardId,
				p_tag_names: [...input.tagNames],
			});
			return { data, error };
		},
		async setIllustration(input) {
			const { data, error } = await client.rpc("set_card_illustration", {
				p_card_id: input.cardId,
				p_illustration_id: input.illustrationId,
			});
			return { data, error };
		},
		async deleteCards(input) {
			const { data, error } = await client.rpc("bulk_delete_imported_cards", { p_cards: input });
			return { data, error };
		},
		async undoImport(input) {
			const { data, error } = await client.rpc("undo_import", { p_batch_id: input.batchId });
			return { data, error };
		},
	};
}

export type AppAiCardManagementRepositoryResult = Readonly<{ data: Json; error: unknown | null }>;

/**
 * The post-commit mnemonic edit path (ADR-013).  It is deliberately NOT part of
 * `AiCardManagementRepository`: keeping it separate means the Remote MCP
 * repository cannot implement it, so "MCP never writes mnemonics" is expressed
 * in the types instead of in a comment.
 */
export interface AiCardMnemonicRepository {
	/** The caller's card whose `illustration_key` equals the given one, or null. */
	findOwnedCardByIllustrationKey(
		input: Readonly<{ cardId: string; illustrationKey: string }>
	): Promise<AiCardManagementRepositoryResult<{ id: string } | null>>;
	upsertMnemonic(
		input: Readonly<{
			illustrationKey: string;
			slots: MnemonicSlotsDraft;
			explanation: MnemonicExplanationDraft;
		}>
	): Promise<AiCardManagementRepositoryResult<Json>>;
}

/**
 * `ownerUserId` is bound here from the authenticated session, never from a
 * command argument, and the owner-scoped `card_mnemonics` RLS policies stay the
 * last line of defence (ADR-013 decisions 1 and 6).
 */
export function createAppAiCardMnemonicRepository(
	client: ServerSupabaseClient,
	ownerUserId: string
): AiCardMnemonicRepository {
	return {
		async findOwnedCardByIllustrationKey(input) {
			const { data, error } = await client
				.from("cards")
				.select("id")
				.eq("id", input.cardId)
				.eq("owner_user_id", ownerUserId)
				.eq("illustration_key", input.illustrationKey)
				.maybeSingle();
			return { data, error };
		},
		async upsertMnemonic(input) {
			// `updated_at` is maintained by the set_card_mnemonics_updated_at trigger.
			const { data, error } = await client.from("card_mnemonics").upsert(
				{
					owner_user_id: ownerUserId,
					illustration_key: input.illustrationKey,
					slots: input.slots as unknown as Json,
					explanation: input.explanation as unknown as Json,
					status: "approved",
				},
				{ onConflict: "owner_user_id,illustration_key" }
			);
			return { data, error };
		},
	};
}
