// S-16D unit tests — server-side mnemonic sanitizer (AC-3 / AC-5).
// Design: specs/stories/S-16D-approval-ui/design.md §6.2, ADR-012 decision 5.

import { describe, expect, it } from "vitest";

import { sanitizeMnemonics } from "../../../../frontend/src/lib/ai-import/service";

const ALLOWED = new Set(["concept-1", "concept-2"]);

function validSlots(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kanji: "山",
		isSingleKanji: true,
		shapeHint: { part: "三つの峰", picture: "そびえ立つ山並み" },
		meaningHint: "たかい土地",
		story: "峰が三つ並ぶ風景を思い浮かべる。",
		...overrides,
	};
}

function validExplanation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		summary: "三つの峰が並ぶ形がそのまま山を表している。",
		mappings: [
			{ part: "左の峰", meaning: "やま" },
			{ part: "中央の峰", meaning: "たかい" },
		],
		...overrides,
	};
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		conceptId: "concept-1",
		slots: validSlots(),
		explanation: validExplanation(),
		...overrides,
	};
}

function mappings(count: number): { part: string; meaning: string }[] {
	return Array.from({ length: count }, (_value, index) => ({
		part: `部品${index + 1}`,
		meaning: `意味${index + 1}`,
	}));
}

describe("S-16D sanitizeMnemonics (AC-3 / AC-5)", () => {
	it("U-01 accepts a well-formed entry and keeps its normalized fields", () => {
		const result = sanitizeMnemonics([entry()], ALLOWED);
		expect(result).toHaveLength(1);
		expect(result?.[0]?.conceptId).toBe("concept-1");
		expect(result?.[0]?.slots.kanji).toBe("山");
		expect(result?.[0]?.explanation.mappings).toHaveLength(2);
	});

	it("U-02 allows an empty list (legacy / non-approval commit stays unchanged)", () => {
		expect(sanitizeMnemonics([], ALLOWED)).toEqual([]);
	});

	it("U-03 rejects a conceptId outside the allowlist", () => {
		expect(sanitizeMnemonics([entry({ conceptId: "concept-unknown" })], ALLOWED)).toBeUndefined();
	});

	it("U-04 rejects a duplicate conceptId", () => {
		expect(sanitizeMnemonics([entry(), entry()], ALLOWED)).toBeUndefined();
	});

	it("U-05 applies NFKC normalization to text fields", () => {
		const result = sanitizeMnemonics(
			[entry({ slots: validSlots({ meaningHint: "ＡＢＣ１２３" }) })],
			ALLOWED
		);
		expect(result?.[0]?.slots.meaningHint).toBe("ABC123");
	});

	it("U-06 enforces the kanji length cap (16 OK / 17 NG)", () => {
		expect(sanitizeMnemonics([entry({ slots: validSlots({ kanji: "山".repeat(16) }) })], ALLOWED)).toHaveLength(1);
		expect(
			sanitizeMnemonics([entry({ slots: validSlots({ kanji: "山".repeat(17) }) })], ALLOWED)
		).toBeUndefined();
	});

	it("U-07 enforces the summary length cap (120 OK / 121 NG)", () => {
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ summary: "あ".repeat(120) }) })], ALLOWED)
		).toHaveLength(1);
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ summary: "あ".repeat(121) }) })], ALLOWED)
		).toBeUndefined();
	});

	it("U-08 enforces the 100 code-point cap on slots and mapping text (100 OK / 101 NG)", () => {
		expect(
			sanitizeMnemonics(
				[entry({ slots: validSlots({ story: "い".repeat(100) }) })],
				ALLOWED
			)
		).toHaveLength(1);
		expect(
			sanitizeMnemonics([entry({ slots: validSlots({ story: "い".repeat(101) }) })], ALLOWED)
		).toBeUndefined();
		expect(
			sanitizeMnemonics(
				[
					entry({
						explanation: validExplanation({
							mappings: [
								{ part: "う".repeat(100), meaning: "え" },
								{ part: "お", meaning: "か" },
							],
						}),
					}),
				],
				ALLOWED
			)
		).toHaveLength(1);
		expect(
			sanitizeMnemonics(
				[
					entry({
						explanation: validExplanation({
							mappings: [
								{ part: "う".repeat(101), meaning: "え" },
								{ part: "お", meaning: "か" },
							],
						}),
					}),
				],
				ALLOWED
			)
		).toBeUndefined();
	});

	it("U-09 enforces mappings 2-4 (1=NG, 2=OK, 4=OK, 5=NG)", () => {
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ mappings: mappings(1) }) })], ALLOWED)
		).toBeUndefined();
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ mappings: mappings(2) }) })], ALLOWED)
		).toHaveLength(1);
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ mappings: mappings(4) }) })], ALLOWED)
		).toHaveLength(1);
		expect(
			sanitizeMnemonics([entry({ explanation: validExplanation({ mappings: mappings(5) }) })], ALLOWED)
		).toBeUndefined();
	});

	it("U-10 rejects a non-boolean isSingleKanji", () => {
		expect(
			sanitizeMnemonics([entry({ slots: validSlots({ isSingleKanji: "true" }) })], ALLOWED)
		).toBeUndefined();
	});

	it("U-11 rejects empty (whitespace-only) required text", () => {
		expect(
			sanitizeMnemonics([entry({ slots: validSlots({ story: "   " }) })], ALLOWED)
		).toBeUndefined();
	});
});
