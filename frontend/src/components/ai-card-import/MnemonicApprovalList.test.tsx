import { describe, expect, it } from "vitest";

import { MNEMONIC_LIMITS, isMnemonicEntryValid } from "./MnemonicApprovalList";

const VALID_ENTRY = {
	slots: {
		kanji: "見",
		isSingleKanji: true,
		shapeHint: { part: "下の「見」", picture: "目" },
		meaningHint: "見る・気づく",
		story: "目で見たものが頭の中で光って記憶に残る",
	},
	explanation: {
		summary: "目で見たものが、頭の中で光って記憶に残る。",
		mappings: [
			{ part: "下の「見」", meaning: "目で見る" },
			{ part: "上の光", meaning: "頭の中で気づく" },
		],
	},
} as const;

const mapping = (index: number) => ({ part: `部品${index}`, meaning: `意味${index}` });
const mappings = (count: number) => Array.from({ length: count }, (_, index) => mapping(index));

describe("S-20 mnemonic limits shared with the /ai/cards editor", () => {
	it("exposes the canonical client-side limits", () => {
		expect(MNEMONIC_LIMITS).toEqual({
			kanjiMax: 16,
			textMax: 100,
			summaryMax: 120,
			mappingsMin: 2,
			mappingsMax: 4,
		});
	});

	it("accepts a well-formed entry at the boundaries", () => {
		expect(isMnemonicEntryValid(VALID_ENTRY)).toBe(true);
		expect(
			isMnemonicEntryValid({
				slots: { ...VALID_ENTRY.slots, kanji: "見".repeat(MNEMONIC_LIMITS.kanjiMax) },
				explanation: {
					summary: "あ".repeat(MNEMONIC_LIMITS.summaryMax),
					mappings: mappings(MNEMONIC_LIMITS.mappingsMax),
				},
			})
		).toBe(true);
	});

	// AC-5: each over-limit shape is rejected before any save can be attempted.
	it("AC-5: rejects a kanji of 17 code points", () => {
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				slots: { ...VALID_ENTRY.slots, kanji: "見".repeat(17) },
			})
		).toBe(false);
	});

	it("AC-5: rejects a text field of 101 code points", () => {
		const overLimit = "あ".repeat(101);
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				slots: { ...VALID_ENTRY.slots, story: overLimit },
			})
		).toBe(false);
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				slots: { ...VALID_ENTRY.slots, shapeHint: { part: overLimit, picture: "目" } },
			})
		).toBe(false);
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				explanation: {
					...VALID_ENTRY.explanation,
					mappings: [{ part: overLimit, meaning: "意味" }, mapping(1)],
				},
			})
		).toBe(false);
	});

	it("AC-5: rejects a summary of 121 code points", () => {
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				explanation: { ...VALID_ENTRY.explanation, summary: "あ".repeat(121) },
			})
		).toBe(false);
	});

	it("AC-5: rejects a single mapping", () => {
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				explanation: { ...VALID_ENTRY.explanation, mappings: mappings(1) },
			})
		).toBe(false);
	});

	it("AC-5: rejects five mappings", () => {
		expect(
			isMnemonicEntryValid({
				...VALID_ENTRY,
				explanation: { ...VALID_ENTRY.explanation, mappings: mappings(5) },
			})
		).toBe(false);
	});
});
