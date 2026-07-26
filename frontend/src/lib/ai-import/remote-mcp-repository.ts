import type { McpActorContext } from "@/lib/mcp/auth";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";

import { deriveRemoteGenerationRequestHash } from "./canonical-request";
import { type AiImportRepository, normalizedCommitRequest } from "./service";

/**
 * This adapter is constructed after HTTP authentication and owns the verified
 * client/session context.  Tool inputs never select an owner, source, client,
 * or quota policy.
 */
export function createRemoteMcpImportRepository(
	client: JwtScopedSupabaseClient,
	actor: McpActorContext
): AiImportRepository {
	return {
		async validatePreview(input) {
			const { error } = await client.rpc("s14_remote_validate_import_preview", {
				p_client_id: actor.clientId,
				p_session_id: actor.sessionId,
				p_deck_id: input.deckId,
				p_reservation_key: input.reservationKey,
				p_import_request_hash: input.importRequestHash,
				p_upload_ids: [...input.uploadIds],
				p_items: input.items.map((item) => ({ ...item })),
			});
			return { data: undefined, error };
		},
		async commit(input) {
			const generationRequestHash = await deriveRemoteGenerationRequestHash(
				input.importRequestHash,
				actor.clientId
			);
			const { data, error } = await client.rpc("s14_remote_commit_import", {
				p_client_id: actor.clientId,
				p_session_id: actor.sessionId,
				p_idempotency_key: input.idempotencyKey,
				p_import_request_hash: input.importRequestHash,
				p_generation_request_hash: generationRequestHash,
				p_preview_token: input.previewToken,
				p_request: normalizedCommitRequest(input.request),
				p_card_reservation_key: input.cardReservationKey,
				// The RPC derives the owner from the verified JWT claims, so the payload
				// carries only the concept and its text (ADR-012 decisions 2 and 4).
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
			const { data, error } = await client.rpc("s14_remote_get_import_status", {
				p_client_id: actor.clientId,
				p_session_id: actor.sessionId,
				p_batch_id: input.batchId,
				p_idempotency_key: input.idempotencyKey,
			});
			return { data, error };
		},
	};
}
