import type { Json } from "@/types/database";

import { decodeAiCardCursor, isPostgresTimestamp } from "./cursor";
import type { AiCardPattern, AiCardSkill, ManagedAiCard } from "./types";

export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export class AiCardValidationError extends Error {}

const requireUuid = (value: unknown, field: string): string => {
	if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
		throw new AiCardValidationError(`${field} is invalid`);
	}
	return value;
};

const parseJstDate = (value: string, field: string): string => {
	const match = DATE_PATTERN.exec(value);
	if (!match) throw new AiCardValidationError(`${field} is invalid`);
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const utc = new Date(Date.UTC(year, month - 1, day));
	if (
		utc.getUTCFullYear() !== year ||
		utc.getUTCMonth() !== month - 1 ||
		utc.getUTCDate() !== day
	) {
		throw new AiCardValidationError(`${field} is invalid`);
	}
	return value;
};

export const jstDayStartIso = (value: string): string =>
	new Date(`${parseJstDate(value, "date")}T00:00:00+09:00`).toISOString();

export const jstDayAfterIso = (value: string): string => {
	const start = new Date(jstDayStartIso(value));
	start.setUTCDate(start.getUTCDate() + 1);
	return start.toISOString();
};

export interface ParsedListFilters {
	readonly limit: number;
	readonly cursorCreatedAt: string | null;
	readonly cursorId: string | null;
	readonly deckId: string | null;
	readonly tagId: string | null;
	readonly source: "app_ai" | "remote_mcp" | null;
	readonly createdFrom: string | null;
	readonly createdTo: string | null;
}

export function parseAiCardListFilters(input: unknown): ParsedListFilters {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new AiCardValidationError("filters are invalid");
	}
	const value = input as Record<string, unknown>;
	const limit = value.limit ?? 20;
	if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new AiCardValidationError("limit is invalid");
	}
	if (value.cursor !== undefined && typeof value.cursor !== "string") {
		throw new AiCardValidationError("cursor is invalid");
	}
	const cursor = value.cursor === undefined ? null : decodeAiCardCursor(value.cursor as string);
	if (value.cursor !== undefined && cursor === null)
		throw new AiCardValidationError("cursor is invalid");
	if (value.source !== undefined && value.source !== "app_ai" && value.source !== "remote_mcp") {
		throw new AiCardValidationError("source is invalid");
	}
	if (value.createdFrom !== undefined && typeof value.createdFrom !== "string") {
		throw new AiCardValidationError("createdFrom is invalid");
	}
	if (value.createdTo !== undefined && typeof value.createdTo !== "string") {
		throw new AiCardValidationError("createdTo is invalid");
	}
	const from =
		value.createdFrom === undefined
			? null
			: parseJstDate(value.createdFrom as string, "createdFrom");
	const to =
		value.createdTo === undefined ? null : parseJstDate(value.createdTo as string, "createdTo");
	if (from !== null && to !== null && from > to)
		throw new AiCardValidationError("date range is invalid");
	return {
		limit,
		cursorCreatedAt: cursor?.createdAt ?? null,
		cursorId: cursor?.id ?? null,
		deckId: value.deckId === undefined ? null : requireUuid(value.deckId, "deckId"),
		tagId: value.tagId === undefined ? null : requireUuid(value.tagId, "tagId"),
		source: (value.source as "app_ai" | "remote_mcp" | undefined) ?? null,
		createdFrom: from === null ? null : jstDayStartIso(from),
		createdTo: to === null ? null : jstDayAfterIso(to),
	};
}

export function parseContentInput(input: unknown): {
	cardId: string;
	expectedUpdatedAt: string;
	patch: { frontText: string; backText: string; skill: AiCardSkill; pattern: AiCardPattern };
} {
	if (typeof input !== "object" || input === null)
		throw new AiCardValidationError("input is invalid");
	const value = input as Record<string, unknown>;
	const skill = value.skill;
	const pattern = value.pattern;
	if (skill !== "reading" && skill !== "writing")
		throw new AiCardValidationError("skill is invalid");
	if (pattern !== "R1" && pattern !== "W1") throw new AiCardValidationError("pattern is invalid");
	if ((pattern === "R1" && skill !== "reading") || (pattern === "W1" && skill !== "writing")) {
		throw new AiCardValidationError("skill and pattern do not match");
	}
	const frontText =
		typeof value.frontText === "string" ? value.frontText.normalize("NFKC").trim() : "";
	const backText =
		typeof value.backText === "string" ? value.backText.normalize("NFKC").trim() : "";
	if (
		frontText.length < 1 ||
		frontText.length > 200 ||
		backText.length < 1 ||
		backText.length > 200
	) {
		throw new AiCardValidationError("content length is invalid");
	}
	const expectedUpdatedAt =
		typeof value.expectedUpdatedAt === "string" ? value.expectedUpdatedAt : "";
	if (!isPostgresTimestamp(expectedUpdatedAt))
		throw new AiCardValidationError("updatedAt is invalid");
	return {
		cardId: requireUuid(value.cardId, "cardId"),
		expectedUpdatedAt,
		patch: { frontText, backText, skill, pattern },
	};
}

export function parseUuidList(value: unknown, field: string, maximum = 100): string[] {
	if (!Array.isArray(value) || value.length > maximum)
		throw new AiCardValidationError(`${field} is invalid`);
	const ids = value.map((item) => requireUuid(item, field));
	if (new Set(ids).size !== ids.length)
		throw new AiCardValidationError(`${field} contains duplicates`);
	return ids;
}

export function parseBulkDeleteInput(value: unknown): Json {
	if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
		throw new AiCardValidationError("cards is invalid");
	}
	const ids = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null)
			throw new AiCardValidationError("card is invalid");
		const record = item as Record<string, unknown>;
		const cardId = requireUuid(record.cardId, "cardId");
		if (ids.has(cardId)) throw new AiCardValidationError("cards contains duplicates");
		ids.add(cardId);
		if (
			typeof record.expectedUpdatedAt !== "string" ||
			!isPostgresTimestamp(record.expectedUpdatedAt)
		) {
			throw new AiCardValidationError("updatedAt is invalid");
		}
		return { cardId, expectedUpdatedAt: record.expectedUpdatedAt };
	});
}

const isRelation = (value: unknown): value is { id: string; name: string } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Record<string, unknown>).id === "string" &&
	typeof (value as Record<string, unknown>).name === "string";

export function parseManagedAiCards(value: Json): { items: ManagedAiCard[]; hasMore: boolean } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid management list contract");
	}
	const record = value as Record<string, Json | undefined>;
	if (!Array.isArray(record.items) || typeof record.hasMore !== "boolean") {
		throw new Error("Invalid management list contract");
	}
	const items = record.items.map((raw): ManagedAiCard => {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			throw new Error("Invalid card contract");
		const row = raw as Record<string, Json | undefined>;
		if (
			typeof row.id !== "string" ||
			typeof row.frontText !== "string" ||
			typeof row.backText !== "string" ||
			(row.skill !== "reading" && row.skill !== "writing") ||
			(row.pattern !== "R1" && row.pattern !== "W1") ||
			typeof row.createdAt !== "string" ||
			typeof row.updatedAt !== "string" ||
			(row.source !== "app_ai" && row.source !== "remote_mcp") ||
			typeof row.batchId !== "string" ||
			typeof row.itemId !== "string" ||
			!Array.isArray(row.decks) ||
			!row.decks.every(isRelation) ||
			!Array.isArray(row.tags) ||
			!row.tags.every(isRelation)
		)
			throw new Error("Invalid card contract");
		const illustration = row.illustration;
		if (
			illustration !== null &&
			(typeof illustration !== "object" ||
				Array.isArray(illustration) ||
				typeof illustration.id !== "string" ||
				typeof illustration.status !== "string")
		) {
			throw new Error("Invalid illustration contract");
		}
		return {
			id: row.id,
			frontText: row.frontText,
			backText: row.backText,
			skill: row.skill,
			pattern: row.pattern,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			source: row.source,
			batchId: row.batchId,
			itemId: row.itemId,
			decks: row.decks,
			tags: row.tags,
			illustration:
				illustration === null
					? null
					: { id: illustration.id as string, status: illustration.status as string },
		};
	});
	return { items, hasMore: record.hasMore };
}
