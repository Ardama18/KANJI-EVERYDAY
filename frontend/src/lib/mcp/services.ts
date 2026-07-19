import {
	createRemoteMcpCardManagementRepository,
	updateRemoteMcpAiCard,
} from "@/lib/ai-card-management/remote-mcp-repository";
import { deleteAiCards, listAiCards, undoAiImportBatch } from "@/lib/ai-card-management/service";
import { createRemoteMcpImportRepository } from "@/lib/ai-import/remote-mcp-repository";
import { commitCardImport, getImportStatus, previewCardImport } from "@/lib/ai-import/service";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import type { McpActorContext } from "./auth";
import type { McpToolServices } from "./tools";

export interface McpToolServiceDependencies {
	readonly client: JwtScopedSupabaseClient;
	readonly actor: McpActorContext;
	readonly previewSecret: string | undefined;
	readonly nowSeconds: number;
	readonly createReservationKey: () => string;
	readonly createCorrelationId: () => string;
}

/**
 * This is the only place where a verified MCP actor selects remote repositories.
 * It intentionally never accepts an owner, client, source, or service-role client
 * from a tool argument.
 */
export function createMcpToolServices(dependencies: McpToolServiceDependencies): McpToolServices {
	const { actor, client } = dependencies;
	const imports = createRemoteMcpImportRepository(client, actor);
	const cards = createRemoteMcpCardManagementRepository(client, actor);
	return {
		listDecks: async () => await listOwnerDecks(client),
		previewCardImport: async ({ request }) => {
			const secret = dependencies.previewSecret;
			if (secret === undefined) return unavailable();
			return await previewCardImport({
				actor: { userId: actor.userId, clientId: actor.clientId, kind: "remote_mcp" },
				request,
				cardReservationKey: dependencies.createReservationKey(),
				repository: imports,
				secret,
				nowSeconds: dependencies.nowSeconds,
			});
		},
		commitCardImport: async (input) => {
			const secret = dependencies.previewSecret;
			if (secret === undefined) return unavailable();
			return await commitCardImport({
				actor: { userId: actor.userId, clientId: actor.clientId, kind: "remote_mcp" },
				input,
				repository: imports,
				secret,
				nowSeconds: dependencies.nowSeconds,
				correlationId: dependencies.createCorrelationId(),
			});
		},
		getImportStatus: async (input) =>
			await getImportStatus({
				input,
				repository: imports,
				correlationId: dependencies.createCorrelationId(),
			}),
		listAiCards: async (input) => await listAiCards(cards, input),
		updateAiCard: async ({ cardId, expectedUpdatedAt, patch }) => {
			const result = await updateRemoteMcpAiCard(client, actor, {
				cardId,
				expectedUpdatedAt,
				patch: patch as Json,
			});
			return result.error === null
				? { ok: true as const, data: result.data }
				: { ok: false as const, error: mapCardRepositoryFailure(result.error) };
		},
		deleteAiCards: async ({ cards: targetCards }) => await deleteAiCards(cards, targetCards),
		undoImportBatch: async ({ batchId }) => await undoAiImportBatch(cards, batchId),
	};
}

async function listOwnerDecks(client: JwtScopedSupabaseClient): Promise<unknown> {
	const { data, error } = await client
		.from("decks")
		.select("id,name")
		.order("name", { ascending: true })
		.order("id", { ascending: true });
	if (error !== null || !Array.isArray(data)) return unavailable();
	const decks = data.map((deck) => ({ id: deck.id, name: deck.name }));
	if (!decks.every((deck) => typeof deck.id === "string" && typeof deck.name === "string")) {
		return unavailable();
	}
	return { decks };
}

function unavailable() {
	return { ok: false as const, error: { code: "SERVICE_UNAVAILABLE" } };
}

function mapCardRepositoryFailure(error: unknown) {
	if (isRecord(error) && error.code === "P1000") return { code: "VALIDATION_ERROR" };
	if (isRecord(error) && error.code === "P1003") return { code: "NOT_FOUND" };
	if (isRecord(error) && error.code === "P1006") return { code: "ACTIVE_SESSION" };
	if (isRecord(error) && error.code === "P1007") return { code: "CARD_MODIFIED" };
	if (isRecord(error) && error.code === "P1008") return { code: "CONFLICT" };
	return { code: "INTERNAL_ERROR" };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
