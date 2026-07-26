import type {
	MnemonicExplanationDraft,
	MnemonicSlotsDraft,
} from "@/lib/ai-card-generation/contracts";
import {
	sanitizeMnemonicExplanation,
	sanitizeMnemonicSlots,
} from "@/lib/ai-card-generation/mnemonic-sanitize";
import type { Json } from "@/types/database";
import type { AiCardMnemonicRepository } from "./app-ai-repository";
import { encodeAiCardCursor } from "./cursor";
import { mapAiCardManagementError } from "./errors";
import type { AiCardActionResult, AiCardListPage } from "./types";
import {
	AiCardValidationError,
	UUID_PATTERN,
	parseAiCardListFilters,
	parseBulkDeleteInput,
	parseContentInput,
	parseManagedAiCards,
	parseUuidList,
} from "./validation";

export interface AiCardManagementRepositoryResult<T> {
	readonly data: T;
	readonly error: unknown | null;
}

/**
 * Adapter factories bind the authenticated actor before they create this
 * repository.  Commands never carry an owner, source, or authorization claim.
 */
export interface AiCardManagementRepository {
	list(
		input: ReturnType<typeof parseAiCardListFilters>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	updateContent(
		input: ReturnType<typeof parseContentInput>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	setDecks(
		input: Readonly<{ cardId: string; deckIds: readonly string[] }>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	setTags(
		input: Readonly<{ cardId: string; tagIds: readonly string[] }>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	setTagNames(
		input: Readonly<{ cardId: string; tagNames: readonly string[] }>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	setIllustration(
		input: Readonly<{ cardId: string; illustrationId: string | null }>
	): Promise<AiCardManagementRepositoryResult<Json>>;
	deleteCards(input: Json): Promise<AiCardManagementRepositoryResult<Json>>;
	undoImport(input: Readonly<{ batchId: string }>): Promise<AiCardManagementRepositoryResult<Json>>;
}

export async function listAiCards(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<AiCardListPage>> {
	try {
		const filters = parseAiCardListFilters(input);
		const result = await repository.list(filters);
		if (result.error !== null) return errorResult(result.error);
		const parsed = parseManagedAiCards(result.data);
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
		return caughtError<AiCardListPage>(error);
	}
}

export async function updateAiCardContent(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.updateContent(parseContentInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export async function setAiCardDecks(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.setDecks(parseCardDeckInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export async function setAiCardTags(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.setTags(parseCardTagInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export async function setAiCardTagNames(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.setTagNames(parseCardTagNamesInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export async function setAiCardIllustration(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.setIllustration(parseCardIllustrationInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

/**
 * Post-commit mnemonic edit (ADR-013).  The order is fixed:
 *   1. parse + server-side re-sanitize (shared with the commit path, decision 4)
 *   2. verify that `cardId` is owned by the caller and carries `illustrationKey`
 *      (decision 2) — on a miss it returns NOT_FOUND without touching the table
 *   3. upsert with `status='approved'`; conflicts are last-write-wins (decision 3)
 */
export async function updateAiCardMnemonic(
	repository: AiCardMnemonicRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const parsed = parseMnemonicUpdateInput(input);
		const owned = await repository.findOwnedCardByIllustrationKey({
			cardId: parsed.cardId,
			illustrationKey: parsed.illustrationKey,
		});
		if (owned.error !== null) return errorResult(owned.error);
		if (owned.data === null) {
			return {
				ok: false,
				error: { code: "NOT_FOUND", status: 404, message: "対象が見つかりません。" },
			};
		}
		const result = await repository.upsertMnemonic({
			illustrationKey: parsed.illustrationKey,
			slots: parsed.slots,
			explanation: parsed.explanation,
		});
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export function parseMnemonicUpdateInput(input: unknown): Readonly<{
	cardId: string;
	illustrationKey: string;
	slots: MnemonicSlotsDraft;
	explanation: MnemonicExplanationDraft;
}> {
	const value = requireRecord(input);
	const cardId = requireCardId(value);
	if (typeof value.illustrationKey !== "string") {
		throw new AiCardValidationError("illustrationKey is invalid");
	}
	const illustrationKey = value.illustrationKey.trim();
	if (illustrationKey.length < 1 || illustrationKey.length > 512) {
		throw new AiCardValidationError("illustrationKey is invalid");
	}
	const slots = sanitizeMnemonicSlots(value.slots);
	const explanation = sanitizeMnemonicExplanation(value.explanation);
	if (slots === undefined || explanation === undefined) {
		throw new AiCardValidationError("mnemonic is invalid");
	}
	return { cardId, illustrationKey, slots, explanation };
}

export async function deleteAiCards(
	repository: AiCardManagementRepository,
	input: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		const result = await repository.deleteCards(parseBulkDeleteInput(input));
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

export async function undoAiImportBatch(
	repository: AiCardManagementRepository,
	batchId: unknown
): Promise<AiCardActionResult<Json>> {
	try {
		if (typeof batchId !== "string" || !UUID_PATTERN.test(batchId)) {
			throw new AiCardValidationError("batchId is invalid");
		}
		const result = await repository.undoImport({ batchId });
		return result.error === null ? { ok: true, data: result.data } : errorResult(result.error);
	} catch (error) {
		return caughtError<Json>(error);
	}
}

function parseCardDeckInput(
	input: unknown
): Readonly<{ cardId: string; deckIds: readonly string[] }> {
	const value = requireRecord(input);
	return { cardId: requireCardId(value), deckIds: parseUuidList(value.deckIds, "deckIds") };
}

function parseCardTagInput(
	input: unknown
): Readonly<{ cardId: string; tagIds: readonly string[] }> {
	const value = requireRecord(input);
	return { cardId: requireCardId(value), tagIds: parseUuidList(value.tagIds, "tagIds", 10) };
}

function parseCardTagNamesInput(
	input: unknown
): Readonly<{ cardId: string; tagNames: readonly string[] }> {
	const value = requireRecord(input);
	if (!Array.isArray(value.tagNames) || value.tagNames.length > 10) {
		throw new AiCardValidationError("tagNames is invalid");
	}
	const tagNames = value.tagNames.map((name) => {
		if (typeof name !== "string") throw new AiCardValidationError("tagNames is invalid");
		const normalized = name.normalize("NFKC").trim();
		if (normalized.length < 1 || normalized.length > 30) {
			throw new AiCardValidationError("tagNames is invalid");
		}
		return normalized;
	});
	if (new Set(tagNames.map((name) => name.toLowerCase())).size !== tagNames.length) {
		throw new AiCardValidationError("tagNames contains duplicates");
	}
	return { cardId: requireCardId(value), tagNames };
}

function parseCardIllustrationInput(
	input: unknown
): Readonly<{ cardId: string; illustrationId: string | null }> {
	const value = requireRecord(input);
	const illustrationId = value.illustrationId;
	if (
		illustrationId !== null &&
		(typeof illustrationId !== "string" || !UUID_PATTERN.test(illustrationId))
	) {
		throw new AiCardValidationError("illustrationId is invalid");
	}
	return { cardId: requireCardId(value), illustrationId };
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new AiCardValidationError("input is invalid");
	}
	return value as Readonly<Record<string, unknown>>;
}

function requireCardId(value: Readonly<Record<string, unknown>>): string {
	if (typeof value.cardId !== "string" || !UUID_PATTERN.test(value.cardId)) {
		throw new AiCardValidationError("cardId is invalid");
	}
	return value.cardId;
}

function errorResult<T>(error: unknown): AiCardActionResult<T> {
	return { ok: false, error: mapAiCardManagementError(error) };
}

function caughtError<T>(error: unknown): AiCardActionResult<T> {
	if (error instanceof AiCardValidationError) {
		return {
			ok: false,
			error: { code: "VALIDATION_ERROR", status: 400, message: "入力内容を確認してください。" },
		};
	}
	return errorResult<T>(error);
}
