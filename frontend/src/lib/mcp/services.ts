import type { z } from "zod";

import { normalizeDeckNameInput } from "@/actions/deck-action-types";
import {
	createRemoteMcpCardManagementRepository,
	updateRemoteMcpAiCard,
} from "@/lib/ai-card-management/remote-mcp-repository";
import { deleteAiCards, listAiCards, undoAiImportBatch } from "@/lib/ai-card-management/service";
import type { ManagedAiCard } from "@/lib/ai-card-management/types";
import { createRemoteMcpImportRepository } from "@/lib/ai-import/remote-mcp-repository";
import {
	type CommitMnemonicEntry,
	commitCardImport,
	getImportStatus,
	previewCardImport,
	sanitizeMnemonics,
} from "@/lib/ai-import/service";
import { getDailyStudyStatusForActor } from "@/lib/deck/daily-study-status";
import { isAiCardImportEnabled } from "@/lib/env";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import type { McpActorContext } from "./auth";
import type { McpToolServices, mcpToolInputSchemas } from "./tools";

/** The import request exactly as the static tool schema validates it. */
export type McpImportRequest = z.infer<
	(typeof mcpToolInputSchemas)["preview_card_import"]
>["request"];

export interface McpToolServiceDependencies {
	readonly client: JwtScopedSupabaseClient;
	readonly actor: McpActorContext;
	readonly previewSecret: string | undefined;
	readonly nowSeconds: number;
	readonly createReservationKey: () => string;
	readonly createCorrelationId: () => string;
	/**
	 * Server-side mnemonic generation for the `image.mode="ai"` concepts of one
	 * commit (S-21 D6).  Injected rather than imported so the tool layer stays
	 * testable and so a disabled flag or missing provider config simply leaves it
	 * out.  `undefined` (returned or omitted) means "commit without mnemonics".
	 * The MCP client can never reach this: the tool schema is `.strict()`, so only
	 * the server itself supplies mnemonics.
	 */
	readonly generateMnemonics?: (
		request: McpImportRequest
	) => Promise<readonly CommitMnemonicEntry[] | undefined>;
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
		getDailyStudyStatus: async () => await getDailyStudyStatusForActor(client, actor),
		createDeck: async ({ name }) => await createOwnerDeck(client, actor, name),
		previewCardImport: async ({ request }) => {
			const secret = dependencies.previewSecret;
			if (secret === undefined) return unavailable();
			if (rejectsAiImage(request)) return aiImageDisabled();
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
			if (rejectsAiImage(input.request)) return aiImageDisabled();
			// Generated on the server inside this same request and handed straight to
			// the shared service, so it never travels through the MCP client (AC-5).
			const mnemonics = await generateSanitizedMnemonics(dependencies, input.request);
			return await commitCardImport({
				actor: { userId: actor.userId, clientId: actor.clientId, kind: "remote_mcp" },
				input: mnemonics === undefined ? input : { ...input, mnemonics },
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
		listAiCards: async (input) => {
			const result = await listAiCards(cards, input);
			return result.ok
				? {
						ok: true as const,
						data: {
							items: result.data.items.map(toMcpAiCard),
							nextCursor: result.data.nextCursor,
						},
					}
				: result;
		},
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

/**
 * Allowlist projection for the MCP `list_ai_cards` response (S-20 AC-8).  The key
 * order mirrors the `ManagedAiCard` declaration order, so the serialized shape is
 * byte-identical to the pre-S-20 pass-through.  An allowlist — not a delete list —
 * so future `ManagedAiCard` fields never leak into the tool contract by default.
 */
function toMcpAiCard(card: ManagedAiCard) {
	return {
		id: card.id,
		frontText: card.frontText,
		backText: card.backText,
		skill: card.skill,
		pattern: card.pattern,
		createdAt: card.createdAt,
		updatedAt: card.updatedAt,
		source: card.source,
		batchId: card.batchId,
		itemId: card.itemId,
		decks: card.decks,
		tags: card.tags,
		illustration: card.illustration,
	};
}

/**
 * S-21 D0 / AC-6.  The static tool schema accepts `image.mode="ai"`, so the flag
 * decision lives here: with `AI_CARD_IMPORT_ENABLED` off, the pre-S-21 behaviour is
 * preserved and such a request is a VALIDATION_ERROR.
 */
function rejectsAiImage(request: McpImportRequest): boolean {
	return !isAiCardImportEnabled() && request.items.some((item) => item.image.mode === "ai");
}

/**
 * Generates mnemonics for the `image.mode="ai"` concepts only: `none` concepts get
 * no illustration row, so `card_mnemonics` has nothing to hang them on.
 *
 * Every failure degrades to "no mnemonic for that concept" (AC-4).  The shared
 * service's `sanitizeMnemonics` rejects the whole array when one entry is malformed,
 * which would turn the commit itself into a VALIDATION_ERROR, so each entry is
 * verified on its own here and the failures are dropped.
 */
async function generateSanitizedMnemonics(
	dependencies: McpToolServiceDependencies,
	request: McpImportRequest
): Promise<readonly CommitMnemonicEntry[] | undefined> {
	const generate = dependencies.generateMnemonics;
	if (generate === undefined) return undefined;
	const aiConceptIds = new Set(
		request.items.filter((item) => item.image.mode === "ai").map((item) => item.conceptId)
	);
	if (aiConceptIds.size === 0) return undefined;
	let generated: readonly CommitMnemonicEntry[] | undefined;
	try {
		generated = await generate(request);
	} catch {
		return undefined;
	}
	if (generated === undefined) return undefined;
	const accepted: CommitMnemonicEntry[] = [];
	const seen = new Set<string>();
	for (const entry of generated) {
		const sanitized = sanitizeMnemonics([entry], aiConceptIds)?.[0];
		if (sanitized === undefined || seen.has(sanitized.conceptId)) continue;
		seen.add(sanitized.conceptId);
		accepted.push(sanitized);
	}
	return accepted.length === 0 ? undefined : accepted;
}

async function createOwnerDeck(
	client: JwtScopedSupabaseClient,
	actor: McpActorContext,
	inputName: unknown
): Promise<unknown> {
	const validation = normalizeDeckNameInput(inputName);
	if (!validation.ok) {
		return {
			ok: false as const,
			error: { code: "VALIDATION_ERROR", message: validation.message, details: { field: "name" } },
		};
	}

	const { data, error } = await client
		.from("decks")
		.insert({ owner_user_id: actor.userId, name: validation.name })
		.select("id,name")
		.single();
	if (error !== null || !isDeckResultRow(data)) return unavailable();
	return { deck: { id: data.id, name: data.name } };
}

async function listOwnerDecks(client: JwtScopedSupabaseClient): Promise<unknown> {
	const { data, error } = await client
		.from("decks")
		.select("id,name")
		.is("deleted_at", null)
		.order("name", { ascending: true })
		.order("id", { ascending: true });
	if (error !== null || !Array.isArray(data)) return unavailable();
	const decks = data.map((deck) => ({ id: deck.id, name: deck.name }));
	if (!decks.every((deck) => typeof deck.id === "string" && typeof deck.name === "string")) {
		return unavailable();
	}
	return { decks };
}

function isDeckResultRow(value: unknown): value is Readonly<{ id: string; name: string }> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { id?: unknown }).id === "string" &&
		typeof (value as { name?: unknown }).name === "string"
	);
}

function unavailable() {
	return { ok: false as const, error: { code: "SERVICE_UNAVAILABLE" } };
}

/** Same shape the shared import service uses for its own validation failures. */
function aiImageDisabled() {
	return { ok: false as const, error: { code: "VALIDATION_ERROR", httpStatus: 400 } };
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
