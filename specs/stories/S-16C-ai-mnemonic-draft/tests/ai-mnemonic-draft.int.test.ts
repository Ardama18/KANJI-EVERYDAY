import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import type { OpenAiConceptOutput } from "../../../../frontend/src/lib/ai-card-generation/contracts";
import { AiCardGenerationError } from "../../../../frontend/src/lib/ai-card-generation/errors";
import {
	type GenerationServiceDependencies,
	generateCardDraft,
} from "../../../../frontend/src/lib/ai-card-generation/generation-service";
import { requestOpenAiConcepts } from "../../../../frontend/src/lib/ai-card-generation/openai-adapter";

const config = {
	apiKey: "mock-key",
	model: "gpt-mocked",
	moderationModel: "omni-moderation-latest" as const,
	imageDetail: "high" as const,
	generationTimeoutMs: 60_000,
	moderationTimeoutMs: 10_000,
};

const input = {
	deckId: "11111111-1111-4111-8111-111111111111",
	instruction: "一年生の漢字",
	pattern: "both" as const,
	requestedCardCount: 2,
	tags: ["一年生"],
	illustration: "none" as const,
	generationReservationKey: "reservation-1",
};

const concept: OpenAiConceptOutput = {
	kanjiSide: "山",
	counterpartSide: "やま",
	mnemonic: {
		slots: {
			kanji: "山",
			isSingleKanji: true,
			shapeHint: { part: "三つの峰", picture: "そびえ立つ山並み" },
			meaningHint: "たかい土地",
			story: "峰が三つ並ぶ風景を思い浮かべる。",
		},
		explanation: {
			summary: "三つの峰が並ぶ形がそのまま山を表している。",
			mappings: [
				{ part: "左の峰", meaning: "やま" },
				{ part: "中央の峰", meaning: "たかい" },
			],
		},
	},
};

function createPreviewMock(): GenerationServiceDependencies["createPreview"] {
	return async (request, cardReservationKey) => ({
		request,
		importRequestHash: "a".repeat(64),
		previewToken: "token",
		previewExpiresAt: 1_800,
		cardReservationKey,
		warnings: ["accuracy", "privacy", "copyright"],
	});
}

function baseDependencies(
	overrides: Partial<GenerationServiceDependencies> = {}
): GenerationServiceDependencies {
	return {
		moderateText: async () => undefined,
		moderateImage: async () => undefined,
		reserveUsage: async () => undefined,
		requestConcepts: async () => [concept],
		createPreview: createPreviewMock(),
		...overrides,
	};
}

describe("S-16C generateCardDraft integrates mnemonic drafts (AC-3/AC-4/AC-5)", () => {
	it("INT-01 attaches a 1:1 mnemonicDraft keyed by conceptId to the preview envelope", async () => {
		const preview = await generateCardDraft(input, [], baseDependencies());
		expect("mnemonicDraft" in preview).toBe(true);
		expect(preview.mnemonicDraft).toHaveLength(1);
		expect(preview.mnemonicDraft?.[0]).toEqual({
			conceptId: "concept-001",
			slots: concept.mnemonic.slots,
			explanation: concept.mnemonic.explanation,
		});
		const requestConceptIds = new Set(preview.request.items.map((item) => item.conceptId));
		for (const entry of preview.mnemonicDraft ?? [])
			expect(requestConceptIds.has(entry.conceptId)).toBe(true);
	});

	it("INT-02 folds every mnemonic free-text field into the single output moderation call", async () => {
		const outputTexts: string[] = [];
		const stages: string[] = [];
		await generateCardDraft(
			input,
			[],
			baseDependencies({
				moderateText: async (text, stage) => {
					stages.push(stage);
					if (stage === "output") outputTexts.push(text);
				},
			})
		);
		expect(stages).toEqual(["input", "output"]);
		expect(outputTexts).toHaveLength(1);
		const text = outputTexts[0] ?? "";
		for (const fragment of [
			concept.mnemonic.slots.shapeHint.part,
			concept.mnemonic.slots.shapeHint.picture,
			concept.mnemonic.slots.meaningHint,
			concept.mnemonic.slots.story,
			concept.mnemonic.explanation.summary,
			"左の峰 -> やま",
		])
			expect(text).toContain(fragment);
	});

	it("INT-03 reserves usage exactly once with the unchanged card_generation units", async () => {
		const reserveUsage = vi.fn(async () => undefined);
		await generateCardDraft(input, [], baseDependencies({ reserveUsage }));
		expect(reserveUsage).toHaveBeenCalledOnce();
		expect(reserveUsage.mock.calls[0]?.[0]).toMatchObject({ units: 2 });
		const route = await readFile(
			new URL("../../../../frontend/app/api/ai/card-drafts/generate/route.ts", import.meta.url),
			"utf8"
		);
		expect(route.match(/reserve_provider_usage/gu)).toHaveLength(1);
		expect(route).toContain('p_kind: "card_generation"');
	});

	it("INT-04 also attaches mnemonicDraft on the upload DraftEnvelope path", async () => {
		const draft = await generateCardDraft(
			{ ...input, illustration: "upload" },
			[],
			baseDependencies({
				createPreview: async () => {
					throw new Error("upload path must not build a preview");
				},
			})
		);
		expect("requiresIllustrationUploads" in draft).toBe(true);
		expect(draft.mnemonicDraft).toHaveLength(1);
		expect(draft.mnemonicDraft?.[0]?.conceptId).toBe("concept-001");
	});

	it("INT-05 surfaces a flagged output as 422 OPENAI_OUTPUT_MODERATION", async () => {
		const promise = generateCardDraft(
			input,
			[],
			baseDependencies({
				moderateText: async (_text, stage) => {
					if (stage === "output") throw new AiCardGenerationError("OPENAI_OUTPUT_MODERATION");
				},
			})
		);
		await expect(promise).rejects.toThrow("OPENAI_OUTPUT_MODERATION");
		await promise.catch((error) => {
			expect(error).toBeInstanceOf(AiCardGenerationError);
			expect((error as AiCardGenerationError).httpStatus).toBe(422);
		});
	});

	it("INT-06 maps a mnemonic schema deviation to OPENAI_OUTPUT_SCHEMA_MISMATCH through the adapter", async () => {
		const body = JSON.stringify({
			status: "completed",
			output: [
				{
					type: "message",
					role: "assistant",
					status: "completed",
					content: [
						{
							type: "output_text",
							// mnemonic omitted: the second defence line must reject it.
							text: JSON.stringify({ concepts: [{ kanjiSide: "山", counterpartSide: "やま" }] }),
						},
					],
				},
			],
		});
		await expect(
			requestOpenAiConcepts({
				config,
				input,
				images: [],
				fetcher: async () => new Response(body, { status: 200 }),
			})
		).rejects.toThrow("OPENAI_OUTPUT_SCHEMA_MISMATCH");
	});
});
