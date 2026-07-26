import { describe, expect, it } from "vitest";

import { decodeAiCardCursor, encodeAiCardCursor } from "./cursor";
import { mapAiCardManagementError } from "./errors";
import {
	AiCardValidationError,
	jstDayAfterIso,
	jstDayStartIso,
	parseAiCardListFilters,
	parseBulkDeleteInput,
	parseManagedAiCards,
} from "./validation";

const CARD_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_ID = "223e4567-e89b-42d3-a456-426614174001";
const CREATED_AT = "2026-07-19T03:04:05.000Z";

const MNEMONIC_JSON = {
	slots: {
		kanji: "見",
		isSingleKanji: true,
		shapeHint: { part: "下の「見」", picture: "目" },
		meaningHint: "見る",
		story: "目で見る",
	},
	explanation: {
		summary: "目で見る。",
		mappings: [
			{ part: "下の「見」", meaning: "目で見る" },
			{ part: "上の光", meaning: "気づく" },
		],
	},
	status: "approved",
};

/** One raw `list_ai_managed_cards` item; `patch` overrides or adds S-20 keys. */
const listRow = (patch: Record<string, unknown> = {}) => ({
	id: CARD_ID,
	frontText: "山",
	backText: "やま",
	skill: "reading",
	pattern: "R1",
	createdAt: CREATED_AT,
	updatedAt: CREATED_AT,
	source: "app_ai",
	batchId: SECOND_ID,
	itemId: CARD_ID,
	decks: [],
	tags: [],
	illustration: null,
	...patch,
});

describe("S-13 management pure contracts", () => {
	it("round-trips only a strict versioned cursor", () => {
		const encoded = encodeAiCardCursor({ id: CARD_ID, createdAt: CREATED_AT });
		expect(decodeAiCardCursor(encoded)).toEqual({ id: CARD_ID, createdAt: CREATED_AT });
		expect(decodeAiCardCursor(`${encoded}x`)).toBeNull();
		expect(decodeAiCardCursor(Buffer.from('{"v":2}', "utf8").toString("base64url"))).toBeNull();
	});

	it.each([
		"2026-07-19T03:04:05+00:00",
		"2026-07-19T03:04:05.123456+00:00",
		"2026-07-19T12:04:05.000001+09:00",
	])("preserves PostgreSQL timestamptz precision and representation: %s", (createdAt) => {
		const encoded = encodeAiCardCursor({ id: CARD_ID, createdAt });
		expect(decodeAiCardCursor(encoded)).toEqual({ id: CARD_ID, createdAt });
	});

	it("rejects a structurally valid but impossible PostgreSQL calendar timestamp", () => {
		const encoded = encodeAiCardCursor({ id: CARD_ID, createdAt: "2026-02-30T03:04:05+00:00" });
		expect(decodeAiCardCursor(encoded)).toBeNull();
	});

	it("uses a JST calendar half-open interval", () => {
		expect(jstDayStartIso("2026-07-19")).toBe("2026-07-18T15:00:00.000Z");
		expect(jstDayAfterIso("2026-07-19")).toBe("2026-07-19T15:00:00.000Z");
		expect(() => jstDayStartIso("2026-02-30")).toThrow(AiCardValidationError);
	});

	it("validates pagination bounds, source, owner filter ids, and date order", () => {
		expect(parseAiCardListFilters({})).toMatchObject({ limit: 20 });
		expect(() => parseAiCardListFilters(null)).toThrow(AiCardValidationError);
		expect(() => parseAiCardListFilters([])).toThrow(AiCardValidationError);
		expect(parseAiCardListFilters({ limit: 1 }).limit).toBe(1);
		expect(parseAiCardListFilters({ limit: 100 }).limit).toBe(100);
		expect(() => parseAiCardListFilters({ limit: 0 })).toThrow(AiCardValidationError);
		expect(() => parseAiCardListFilters({ limit: 101 })).toThrow(AiCardValidationError);
		expect(() => parseAiCardListFilters({ deckId: "other-owner" })).toThrow(AiCardValidationError);
		expect(() =>
			parseAiCardListFilters({ createdFrom: "2026-07-20", createdTo: "2026-07-19" })
		).toThrow(AiCardValidationError);
	});

	it("rejects duplicate bulk ids before the RPC", () => {
		expect(
			parseBulkDeleteInput([
				{ cardId: CARD_ID, expectedUpdatedAt: CREATED_AT },
				{ cardId: SECOND_ID, expectedUpdatedAt: CREATED_AT },
			])
		).toHaveLength(2);
		expect(() =>
			parseBulkDeleteInput([
				{ cardId: CARD_ID, expectedUpdatedAt: CREATED_AT },
				{ cardId: CARD_ID, expectedUpdatedAt: CREATED_AT },
			])
		).toThrow(AiCardValidationError);
		expect(() =>
			parseBulkDeleteInput([{ cardId: CARD_ID, expectedUpdatedAt: "not-a-timestamp" }])
		).toThrow(AiCardValidationError);
	});

	it("accepts only the safe list DTO and never needs a storage path", () => {
		const parsed = parseManagedAiCards({
			hasMore: false,
			items: [
				{
					id: CARD_ID,
					frontText: "山",
					backText: "やま",
					skill: "reading",
					pattern: "R1",
					createdAt: CREATED_AT,
					updatedAt: CREATED_AT,
					source: "app_ai",
					batchId: SECOND_ID,
					itemId: CARD_ID,
					decks: [],
					tags: [],
					illustration: null,
				},
			],
		});
		expect(parsed.items[0]).not.toHaveProperty("storagePath");
	});

	it("S-18: never adopts an illustration url coming from the RPC contract", () => {
		const parsed = parseManagedAiCards({
			hasMore: false,
			items: [
				{
					id: CARD_ID,
					frontText: "山",
					backText: "やま",
					skill: "reading",
					pattern: "R1",
					createdAt: CREATED_AT,
					updatedAt: CREATED_AT,
					source: "app_ai",
					batchId: SECOND_ID,
					itemId: CARD_ID,
					decks: [],
					tags: [],
					illustration: {
						id: SECOND_ID,
						status: "ready",
						url: "https://leaked.example/x.png",
						storage_path: "other-owner/x.png",
					},
				},
			],
		});

		// default-deny: only the Server Action layer may fill url, so the shared
		// service (and therefore Remote MCP) always emits null.
		expect(parsed.items[0].illustration).toEqual({
			id: SECOND_ID,
			status: "ready",
			url: null,
		});
		expect(JSON.stringify(parsed)).not.toContain("leaked.example");
		expect(JSON.stringify(parsed)).not.toContain("storage_path");
	});

	it("S-20: defaults the mnemonic fields when the RPC does not project them", () => {
		// Deployment skew tolerance (ADR-013 implementation guidance): an app running
		// ahead of 20260726000000 must still render the page.
		const parsed = parseManagedAiCards({ hasMore: false, items: [listRow()] });

		expect(parsed.items[0]).toMatchObject({
			illustrationKey: null,
			mnemonic: null,
			mnemonicSharedCardCount: 0,
		});
	});

	it("S-20: adopts a well-formed mnemonic projection as-is", () => {
		const parsed = parseManagedAiCards({
			hasMore: false,
			items: [
				listRow({
					illustrationKey: "見",
					mnemonic: {
						slots: {
							kanji: "見",
							isSingleKanji: true,
							shapeHint: { part: "下の「見」", picture: "目" },
							meaningHint: "見る",
							story: "目で見る",
						},
						explanation: {
							summary: "目で見る。",
							mappings: [
								{ part: "下の「見」", meaning: "目で見る" },
								{ part: "上の光", meaning: "気づく" },
							],
						},
						status: "approved",
					},
					mnemonicSharedCardCount: 2,
				}),
			],
		});

		expect(parsed.items[0].illustrationKey).toBe("見");
		expect(parsed.items[0].mnemonicSharedCardCount).toBe(2);
		expect(parsed.items[0].mnemonic).toMatchObject({
			status: "approved",
			slots: { kanji: "見", isSingleKanji: true },
			explanation: { summary: "目で見る。" },
		});
	});

	it.each([
		["a mnemonic with an unknown status", { mnemonic: { ...MNEMONIC_JSON, status: "published" } }],
		[
			"a mnemonic whose slots are incomplete",
			{ mnemonic: { ...MNEMONIC_JSON, slots: { kanji: "見" } } },
		],
		[
			"a mnemonic whose mappings are not part/meaning pairs",
			{
				mnemonic: {
					...MNEMONIC_JSON,
					explanation: { summary: "目で見る。", mappings: [{ part: "下の「見」" }] },
				},
			},
		],
		["a non-string illustration key", { illustrationKey: 3 }],
		["a negative shared card count", { mnemonicSharedCardCount: -1 }],
		["a fractional shared card count", { mnemonicSharedCardCount: 1.5 }],
	])("S-20: rejects %s instead of silently defaulting", (_label, patch) => {
		expect(() => parseManagedAiCards({ hasMore: false, items: [listRow(patch)] })).toThrow();
	});

	it("allowlists active detail and hides unexpected database failures", () => {
		expect(
			mapAiCardManagementError({
				code: "P1006",
				details: JSON.stringify({ sessionId: CARD_ID, deckId: SECOND_ID }),
			})
		).toMatchObject({
			code: "ACTIVE_SESSION",
			detail: { sessionId: CARD_ID, deckId: SECOND_ID },
		});
		expect(
			mapAiCardManagementError({
				code: "P1006",
				details: JSON.stringify({ sessionId: "unsafe", deckId: SECOND_ID }),
			})
		).not.toHaveProperty("detail");
		expect(mapAiCardManagementError({ code: "XX000", message: "raw sql" })).toEqual({
			code: "INTERNAL_ERROR",
			status: 500,
			message: "処理に失敗しました。時間をおいて再試行してください。",
		});
	});
});
