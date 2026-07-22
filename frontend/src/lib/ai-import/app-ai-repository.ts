import type { ServerSupabaseClient } from "@/lib/supabase/server";

import { type AiImportRepository, normalizedCommitRequest } from "./service";

/**
 * Cookie-authenticated UI adapter.  It retains the established S-10--S-12
 * service-role RPC compatibility boundary and is intentionally separate from
 * the future JWT/RLS remote MCP repository.
 */
export function createAppAiImportRepository(
	client: ServerSupabaseClient,
	actorUserId: string
): AiImportRepository {
	return {
		async validatePreview(input) {
			const { error } = await client.rpc("validate_ai_import_preview", {
				p_owner_user_id: actorUserId,
				p_deck_id: input.deckId,
				p_reservation_key: input.reservationKey,
				p_import_request_hash: input.importRequestHash,
				p_upload_ids: [...input.uploadIds],
				p_items: input.items.map((item) => ({ ...item })),
			});
			return { data: undefined, error };
		},
		async commit(input) {
			const { data, error } = await client.rpc("commit_generated_import_async", {
				p_actor_user_id: actorUserId,
				p_idempotency_key: input.idempotencyKey,
				p_import_request_hash: input.importRequestHash,
				p_request: normalizedCommitRequest(input.request),
				p_card_reservation_key: input.cardReservationKey,
				p_mnemonics:
					input.mnemonics === undefined
						? null
						: input.mnemonics.map((entry) => ({
								conceptId: entry.conceptId,
								slots: {
									kanji: entry.slots.kanji,
									isSingleKanji: entry.slots.isSingleKanji,
									shapeHint: {
										part: entry.slots.shapeHint.part,
										picture: entry.slots.shapeHint.picture,
									},
									meaningHint: entry.slots.meaningHint,
									story: entry.slots.story,
								},
								explanation: {
									summary: entry.explanation.summary,
									mappings: entry.explanation.mappings.map((mapping) => ({
										part: mapping.part,
										meaning: mapping.meaning,
									})),
								},
							})),
			});
			return { data, error };
		},
		async getStatus(input) {
			const { data, error } = await client.rpc("get_ai_import_status", {
				p_actor_user_id: actorUserId,
				p_batch_id: input.batchId,
				p_idempotency_key: input.idempotencyKey,
			});
			return { data, error };
		},
	};
}
