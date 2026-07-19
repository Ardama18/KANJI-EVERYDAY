import type { McpActorContext } from "@/lib/mcp/auth";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import type { AiCardManagementRepository } from "./service";

export interface RemoteMcpAiCardPatch {
	readonly cardId: string;
	readonly expectedUpdatedAt: string;
	readonly patch: Json;
}

/**
 * All calls use the authenticated JWT-scoped client.  S-13 public wrappers
 * derive `auth.uid()` from that JWT; the new composite update also rechecks the
 * verified OAuth client/session against packed JWT claims.
 */
export function createRemoteMcpCardManagementRepository(
	client: JwtScopedSupabaseClient,
	actor: McpActorContext
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
			const { data, error } = await client.rpc("s14_remote_update_imported_card", {
				p_client_id: actor.clientId,
				p_session_id: actor.sessionId,
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
			const { data, error } = await client.rpc("bulk_delete_imported_cards", {
				p_cards: input as Json,
			});
			return { data, error };
		},
		async undoImport(input) {
			const { data, error } = await client.rpc("undo_import", { p_batch_id: input.batchId });
			return { data, error };
		},
	};
}

export async function updateRemoteMcpAiCard(
	client: JwtScopedSupabaseClient,
	actor: McpActorContext,
	input: RemoteMcpAiCardPatch
): Promise<Readonly<{ data: Json; error: unknown | null }>> {
	const { data, error } = await client.rpc("s14_remote_update_ai_card", {
		p_client_id: actor.clientId,
		p_session_id: actor.sessionId,
		p_card_id: input.cardId,
		p_expected_updated_at: input.expectedUpdatedAt,
		p_patch: input.patch,
	});
	return { data, error };
}
