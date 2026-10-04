import { generateMnemonicOutcomes } from "@/lib/ai-card-generation/mnemonic-generation";
import { deriveKanjiTargetFromItem } from "@/lib/ai-card-generation/mnemonic-generation";
import {
	type MnemonicOutcome,
	isMnemonicErrorCode,
} from "@/lib/ai-card-generation/mnemonic-outcomes";
import { getMcpAutoMnemonicConfig, getOpenAiCardGenerationConfig } from "@/lib/env";
import type { z } from "zod";
import { createMnemonicRecoveryServices } from "./mnemonic-recovery";

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
	 * testable. Missing or invalid results become explicit blocked outcomes;
	 * only non-Han targets can complete without a mnemonic.
	 * The MCP client can never reach this: the tool schema is `.strict()`, so only
	 * the server itself supplies mnemonics.
	 */
	readonly generateMnemonics?: (
		request: McpImportRequest
	) => Promise<readonly (MnemonicOutcome | CommitMnemonicEntry)[] | undefined>;
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
		...createMnemonicRecoveryServices(
			client,
			actor,
			() => getOpenAiCardGenerationConfig(),
			() => isAiCardImportEnabled() && (getMcpAutoMnemonicConfig()?.maxConcepts ?? 0) > 0
		),
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
			const mnemonicOutcomes = await generateSanitizedMnemonics(dependencies, input.request);
			const mnemonics = mnemonicOutcomes.flatMap((outcome) =>
				outcome.status === "approved" ? [{ conceptId: outcome.conceptId, ...outcome.mnemonic }] : []
			);
			return await commitCardImport({
				actor: { userId: actor.userId, clientId: actor.clientId, kind: "remote_mcp" },
				input: { ...input, mnemonics, mnemonicOutcomes },
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
 * Validate each concept independently so one malformed draft does not erase
 * other successes. Every required concept keeps an explicit approved or blocked
 * outcome; missing outcomes are never interpreted as completed work (S-30).
 */
async function generateSanitizedMnemonics(
	dependencies: McpToolServiceDependencies,
	request: McpImportRequest
): Promise<readonly MnemonicOutcome[]> {
	const aiItems = request.items.filter((item) => item.image.mode === "ai");
	const ids = new Set(aiItems.map((item) => item.conceptId));
	const fallback = await generateMnemonicOutcomes({
		items: aiItems,
		limits: { maxConcepts: 0, budgetMs: 0 },
	});
	if (ids.size === 0) return [];
	let generated: readonly (MnemonicOutcome | CommitMnemonicEntry)[] | undefined;
	try {
		generated = await dependencies.generateMnemonics?.(request);
	} catch {
		return fallback.map((entry) =>
			entry.status === "not_required"
				? entry
				: { conceptId: entry.conceptId, status: "blocked", code: "MNEMONIC_INTERNAL_ERROR" }
		);
	}
	const accepted = new Map<string, MnemonicOutcome>();
	for (const entry of generated ?? []) {
		if (!ids.has(entry.conceptId) || accepted.has(entry.conceptId)) continue;
		if ("status" in entry && entry.status === "blocked" && isMnemonicErrorCode(entry.code)) {
			accepted.set(entry.conceptId, entry);
			continue;
		}
		if ("status" in entry && entry.status === "not_required") continue; // necessity is derived, never supplied
		const candidate =
			"status" in entry
				? entry.status === "approved"
					? { conceptId: entry.conceptId, ...entry.mnemonic }
					: undefined
				: entry;
		const sanitized =
			candidate === undefined ? undefined : sanitizeMnemonics([candidate], ids)?.[0];
		const item =
			aiItems.find((item) => item.conceptId === entry.conceptId && item.pattern === "R1") ??
			aiItems.find((item) => item.conceptId === entry.conceptId);
		const target = item === undefined ? null : deriveKanjiTargetFromItem(item);
		accepted.set(
			entry.conceptId,
			sanitized !== undefined &&
				target !== null &&
				sanitized.slots.kanji === target.kanji &&
				sanitized.slots.isSingleKanji === target.isSingleKanji
				? {
						conceptId: entry.conceptId,
						status: "approved",
						mnemonic: { slots: sanitized.slots, explanation: sanitized.explanation },
					}
				: { conceptId: entry.conceptId, status: "blocked", code: "MNEMONIC_VALIDATION_FAILED" }
		);
	}
	return fallback.map((entry) =>
		entry.status === "not_required" ? entry : (accepted.get(entry.conceptId) ?? entry)
	);
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
