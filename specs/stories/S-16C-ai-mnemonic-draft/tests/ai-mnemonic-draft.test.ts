import { describe, expect, it } from "vitest";

import type {
	MnemonicSlotsDraft,
	OpenAiConceptOutput,
	PreviewEnvelope,
} from "../../../../frontend/src/lib/ai-card-generation/contracts";
import {
	buildResponsesPayload,
	parseOpenAiResponse,
} from "../../../../frontend/src/lib/ai-card-generation/openai-adapter";
import type { MnemonicSlots } from "../../../../frontend/src/lib/illustration/prompt";

const config = {
	apiKey: "test-key",
	model: "gpt-test",
	moderationModel: "omni-moderation-latest" as const,
	imageDetail: "high" as const,
	generationTimeoutMs: 60_000,
	moderationTimeoutMs: 10_000,
};

const options = {
	deckId: "11111111-1111-4111-8111-111111111111",
	instruction: "一年生の漢字",
	pattern: "both" as const,
	requestedCardCount: 2,
	tags: ["一年生"],
	illustration: "none" as const,
	generationReservationKey: "reservation-1",
};

const validMnemonic = {
	slots: {
		kanji: "山",
		isSingleKanji: true,
		shapeHint: { part: "三つの峰", picture: "そびえ立つ山並み" },
		meaningHint: "やま",
		story: "峰が三つ並ぶ風景を思い浮かべる。",
	},
	explanation: {
		summary: "三つの峰が並ぶ形がそのまま山を表している。",
		mappings: [
			{ part: "左の峰", meaning: "やま" },
			{ part: "中央の峰", meaning: "たかい" },
		],
	},
};

const validConcept = { kanjiSide: "山", counterpartSide: "やま", mnemonic: validMnemonic };

function completed(concepts: readonly unknown[]): unknown {
	return {
		status: "completed",
		output: [
			{
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: JSON.stringify({ concepts }) }],
			},
		],
	};
}

// biome-ignore lint/suspicious/noExplicitAny: schema is intentionally loosely typed at the boundary.
type Loose = any;

function conceptWith(mutate: (concept: Loose) => void): unknown {
	const concept = structuredClone(validConcept) as Loose;
	mutate(concept);
	return concept;
}

function mappings(count: number): readonly { readonly part: string; readonly meaning: string }[] {
	return Array.from({ length: count }, (_value, index) => ({
		part: `部品${index + 1}`,
		meaning: `意味${index + 1}`,
	}));
}

describe("S-16C buildResponsesPayload strict schema (AC-1)", () => {
	it("U-01 requires mnemonic(slots+explanation) on every concept with strict object rules", () => {
		const item = buildResponsesPayload(config, options, []).text.format.schema.properties.concepts
			.items as Loose;
		expect(item.required).toEqual(["kanjiSide", "counterpartSide", "mnemonic"]);
		const mnemonic = item.properties.mnemonic;
		expect(mnemonic.type).toBe("object");
		expect(mnemonic.additionalProperties).toBe(false);
		expect(mnemonic.required).toEqual(["slots", "explanation"]);
	});

	it("U-02 fixes slots to the canonical MnemonicSlots shape with nested shapeHint", () => {
		const mnemonic = (
			buildResponsesPayload(config, options, []).text.format.schema.properties.concepts
				.items as Loose
		).properties.mnemonic;
		const slots = mnemonic.properties.slots;
		expect(slots.additionalProperties).toBe(false);
		expect(slots.required).toEqual(["kanji", "isSingleKanji", "shapeHint", "meaningHint", "story"]);
		expect(slots.properties.kanji).toMatchObject({ type: "string", minLength: 1, maxLength: 16 });
		expect(slots.properties.isSingleKanji).toEqual({ type: "boolean" });
		expect(slots.properties.shapeHint).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["part", "picture"],
		});
		expect(slots.properties.shapeHint.properties.part).toMatchObject({
			minLength: 1,
			maxLength: 100,
		});
		expect(slots.properties.meaningHint).toMatchObject({ maxLength: 100 });
		expect(slots.properties.story).toMatchObject({ maxLength: 100 });
	});

	it("U-03 bounds explanation with 2-4 mappings and required part/meaning items", () => {
		const mnemonic = (
			buildResponsesPayload(config, options, []).text.format.schema.properties.concepts
				.items as Loose
		).properties.mnemonic;
		const explanation = mnemonic.properties.explanation;
		expect(explanation.additionalProperties).toBe(false);
		expect(explanation.required).toEqual(["summary", "mappings"]);
		expect(explanation.properties.summary).toMatchObject({ maxLength: 120 });
		expect(explanation.properties.mappings.minItems).toBe(2);
		expect(explanation.properties.mappings.maxItems).toBe(4);
		expect(explanation.properties.mappings.items.additionalProperties).toBe(false);
		expect(explanation.properties.mappings.items.required).toEqual(["part", "meaning"]);
		expect(explanation.properties.mappings.items.properties.part).toMatchObject({ maxLength: 100 });
	});

	it("U-04 keeps the existing kanjiSide/counterpartSide maxLength unchanged", () => {
		const item = buildResponsesPayload(config, options, []).text.format.schema.properties.concepts
			.items as Loose;
		expect(item.properties.kanjiSide).toMatchObject({ minLength: 1, maxLength: 200 });
		expect(item.properties.counterpartSide).toMatchObject({ minLength: 1, maxLength: 200 });
	});
});

describe("S-16C parseOpenAiResponse mnemonic validation (AC-2)", () => {
	it("U-05 returns a mnemonic-carrying concept for compliant output", () => {
		const result = parseOpenAiResponse(completed([validConcept]), 1);
		expect(result.concepts).toHaveLength(1);
		expect(result.concepts[0]).toEqual(validConcept);
	});

	it("U-06 rejects a missing mnemonic (concept key count must be 3)", () => {
		const concept = conceptWith((value) => {
			// biome-ignore lint/performance/noDelete: exercising the missing-key path.
			delete value.mnemonic;
		});
		expect(() => parseOpenAiResponse(completed([concept]), 1)).toThrow(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
	});

	it("U-07 rejects an extra top-level concept key", () => {
		const concept = conceptWith((value) => {
			value.extra = "x";
		});
		expect(() => parseOpenAiResponse(completed([concept]), 1)).toThrow(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
	});

	it("U-08 rejects slots key excess/shortage and a non-boolean isSingleKanji", () => {
		const missingKey = conceptWith((value) => {
			// biome-ignore lint/performance/noDelete: exercising the missing-key path.
			delete value.mnemonic.slots.story;
		});
		const extraKey = conceptWith((value) => {
			value.mnemonic.slots.extra = "x";
		});
		const badBoolean = conceptWith((value) => {
			value.mnemonic.slots.isSingleKanji = "true";
		});
		for (const concept of [missingKey, extraKey, badBoolean])
			expect(() => parseOpenAiResponse(completed([concept]), 1)).toThrow(
				"OPENAI_OUTPUT_SCHEMA_MISMATCH"
			);
	});

	it("U-09 rejects a missing/malformed shapeHint", () => {
		const missing = conceptWith((value) => {
			// biome-ignore lint/performance/noDelete: exercising the missing-key path.
			delete value.mnemonic.slots.shapeHint;
			value.mnemonic.slots.story2 = "keep-key-count";
		});
		const extraShapeKey = conceptWith((value) => {
			value.mnemonic.slots.shapeHint.extra = "x";
		});
		for (const concept of [missing, extraShapeKey])
			expect(() => parseOpenAiResponse(completed([concept]), 1)).toThrow(
				"OPENAI_OUTPUT_SCHEMA_MISMATCH"
			);
	});

	it("U-10 enforces the mappings 2-4 boundary (1=NG, 2=OK, 4=OK, 5=NG)", () => {
		const withMappings = (count: number) =>
			conceptWith((value) => {
				value.mnemonic.explanation.mappings = mappings(count);
			});
		expect(() => parseOpenAiResponse(completed([withMappings(1)]), 1)).toThrow(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
		expect(parseOpenAiResponse(completed([withMappings(2)]), 1).concepts).toHaveLength(1);
		expect(parseOpenAiResponse(completed([withMappings(4)]), 1).concepts).toHaveLength(1);
		expect(() => parseOpenAiResponse(completed([withMappings(5)]), 1)).toThrow(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
	});

	it("U-11 rejects overlong strings across slots and explanation", () => {
		const longKanji = conceptWith((value) => {
			value.mnemonic.slots.kanji = "山".repeat(17);
		});
		const longPart = conceptWith((value) => {
			value.mnemonic.slots.shapeHint.part = "あ".repeat(101);
		});
		const longSummary = conceptWith((value) => {
			value.mnemonic.explanation.summary = "x".repeat(121);
		});
		const longMapping = conceptWith((value) => {
			value.mnemonic.explanation.mappings[0].meaning = "い".repeat(101);
		});
		for (const concept of [longKanji, longPart, longSummary, longMapping])
			expect(() => parseOpenAiResponse(completed([concept]), 1)).toThrow(
				"OPENAI_OUTPUT_SCHEMA_MISMATCH"
			);
	});

	it("U-12 rejects empty strings (minLength 1) in mnemonic fields", () => {
		const emptyStory = conceptWith((value) => {
			value.mnemonic.slots.story = "";
		});
		expect(() => parseOpenAiResponse(completed([emptyStory]), 1)).toThrow(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
	});
});

describe("S-16C mnemonic draft types (AC-5)", () => {
	it("U-13 keeps MnemonicSlotsDraft assignable both ways with the canonical MnemonicSlots", () => {
		const draft: MnemonicSlotsDraft = validMnemonic.slots;
		const toCanonical: MnemonicSlots = draft;
		const fromCanonical: MnemonicSlotsDraft = toCanonical as Readonly<MnemonicSlots>;
		expect(fromCanonical.kanji).toBe("山");
	});

	it("U-14 treats mnemonicDraft as optional on PreviewEnvelope (backward compatible)", () => {
		const withoutDraft: PreviewEnvelope = {
			request: { deck: { id: options.deckId }, items: [] },
			importRequestHash: "a".repeat(64),
			previewToken: "token",
			previewExpiresAt: 1_800,
			cardReservationKey: "key",
			warnings: ["accuracy", "privacy", "copyright"],
		};
		expect(withoutDraft.mnemonicDraft).toBeUndefined();
		const concept: OpenAiConceptOutput = validConcept;
		const withDraft: PreviewEnvelope = {
			...withoutDraft,
			mnemonicDraft: [
				{
					conceptId: "concept-001",
					slots: concept.mnemonic.slots,
					explanation: concept.mnemonic.explanation,
				},
			],
		};
		expect(withDraft.mnemonicDraft).toHaveLength(1);
	});
});
