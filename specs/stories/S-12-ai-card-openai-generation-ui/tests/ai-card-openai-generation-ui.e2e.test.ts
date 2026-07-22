import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AiCardForm from "../../../../frontend/src/components/ai-card-import/AiCardForm";
import WarningConfirmation from "../../../../frontend/src/components/ai-card-import/WarningConfirmation";
import { generateCardDraft } from "../../../../frontend/src/lib/ai-card-generation/generation-service";
import { mapConceptsToImportRequest } from "../../../../frontend/src/lib/ai-card-generation/output-mapper";
import { parseImportStatusResponse } from "../../../../frontend/src/lib/ai-import/async-contract";
import { createImportPreview } from "../../../../frontend/src/lib/ai-import/preview-service";
import {
	batchPointerKey,
	parseBatchPointer,
	serializeBatchPointer,
} from "../../../../frontend/src/lib/ai-import/status-poller";

const deckId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const input = {
	deckId,
	instruction: "小学一年生の漢字",
	pattern: "both" as const,
	requestedCardCount: 2,
	tags: ["一年生"],
	illustration: "none" as const,
	generationReservationKey: "workflow-1",
};

describe("S-12 user-flow E2E contracts", () => {
	it("E2E-01 AC-01/04: text generation can be edited, re-previewed, confirmed, and bound for commit", async () => {
		const generated = await generateCardDraft(input, [], {
			moderateText: async () => undefined,
			moderateImage: async () => undefined,
			reserveUsage: async () => undefined,
			requestConcepts: async () => [
				{
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
							summary: "三つの峰が並ぶ形が山を表す。",
							mappings: [
								{ part: "左の峰", meaning: "やま" },
								{ part: "中央の峰", meaning: "たかい" },
							],
						},
					},
				},
			],
			createPreview: async (request, reservationKey) =>
				await createImportPreview(userId, request, reservationKey, {
					secret: "secret",
					nowSeconds: 100,
					validateDatabase: async () => undefined,
				}),
		});
		expect("previewToken" in generated).toBe(true);
		const edited = {
			...generated.request,
			items: generated.request.items.map((item) =>
				item.pattern === "R1" ? { ...item, back: "やま（山）" } : { ...item, front: "やま（山）" }
			),
		};
		const reviewed = await createImportPreview(userId, edited, input.generationReservationKey, {
			secret: "secret",
			nowSeconds: 101,
			validateDatabase: async () => undefined,
		});
		expect(reviewed.request.items[0]?.back).toBe("やま(山)");
		expect(reviewed.warnings).toEqual(["accuracy", "privacy", "copyright"]);
	});

	it("E2E-02 AC-01/02/04/06: image both generation preserves pair semantics and source terminal release contract", async () => {
		const request = await mapConceptsToImportRequest(input, [
			{ kanjiSide: "川", counterpartSide: "かわ" },
		]);
		expect(request.items.map((item) => [item.front, item.back])).toEqual([
			["川", "かわ"],
			["かわ", "川"],
		]);
		const route = await readFile(
			new URL("../../../../frontend/app/api/ai/card-drafts/generate/route.ts", import.meta.url),
			"utf8"
		);
		expect(route).toContain("loadGenerationSources");
		expect(route).toContain("finally");
		expect(route).toContain("releaseGenerationSources");
	});

	it("E2E-03: queued/processing reload restores only the same batch pointer", () => {
		const pointer = {
			version: 1 as const,
			deckId,
			batchId: "33333333-3333-4333-8333-333333333333",
		};
		expect(batchPointerKey(deckId)).toBe(`kanji-everyday:ai-card-import:v1:${deckId}`);
		expect(parseBatchPointer(serializeBatchPointer(pointer), deckId)).toEqual(pointer);
		expect(serializeBatchPointer(pointer)).not.toMatch(
			/token|front|back|instruction|reservation/iu
		);
	});

	it("E2E-04: partial batch distinguishes succeeded cards from safe failed items", () => {
		const parsed = parseImportStatusResponse({
			batchId: "33333333-3333-4333-8333-333333333333",
			status: "partial",
			counts: { total: 2, succeeded: 1, failed: 1 },
			items: [
				{
					itemId: "44444444-4444-4444-8444-444444444444",
					conceptId: "concept-001",
					status: "succeeded",
					cardId: "55555555-5555-4555-8555-555555555555",
					errorCode: null,
				},
				{
					itemId: "66666666-6666-4666-8666-666666666666",
					conceptId: "concept-002",
					status: "failed",
					cardId: null,
					errorCode: "PROVIDER_TRANSIENT_ERROR",
				},
			],
		});
		expect(parsed?.status).toBe("partial");
		expect(parsed?.items[0]?.cardId).toBeDefined();
		expect(parsed?.items[1]?.errorCode).toBe("PROVIDER_TRANSIENT_ERROR");
	});

	it("E2E-05 AC-03: schema, refusal, moderation, and provider failures have separate safe UI text", async () => {
		const client = (
			await Promise.all([
				readFile(
					new URL(
						"../../../../frontend/app/(auth)/decks/[deckId]/ai/new/AiCardImportClient.tsx",
						import.meta.url
					),
					"utf8"
				),
				readFile(
					new URL(
						"../../../../frontend/src/lib/ai-card-generation/safe-code-message.ts",
						import.meta.url
					),
					"utf8"
				),
			])
		).join("\n");
		for (const code of [
			"OPENAI_OUTPUT_SCHEMA_MISMATCH",
			"OPENAI_REFUSAL",
			"OPENAI_INPUT_TEXT_MODERATION",
			"OPENAI_INPUT_IMAGE_MODERATION",
			"OPENAI_OUTPUT_MODERATION",
			"OPENAI_PROVIDER_TRANSIENT",
			"IMAGE_FORMAT_INVALID",
			"IMAGE_DIMENSIONS_INVALID",
			"SOURCE_WRITE_FAILED",
			"SOURCE_FINALIZE_FAILED",
		])
			expect(client).toContain(code);
		expect(client).not.toContain("raw provider response");
	});

	it("E2E-06 AC-07: 360px baseline uses responsive controls, visible labels, errors, and confirmation", () => {
		const form = renderToStaticMarkup(
			createElement(AiCardForm, {
				deckId,
				disabled: false,
				onSubmit: async () => undefined,
				onCancel: async () => undefined,
			})
		);
		const warning = renderToStaticMarkup(
			createElement(WarningConfirmation, {
				confirmed: false,
				onChange: () => undefined,
				previewValid: true,
				committing: false,
				onPreview: async () => undefined,
				onCommit: async () => undefined,
			})
		);
		for (const label of [
			"作りたいカードの指示",
			"教材source画像",
			"カード形式",
			"作成する枚数",
			"タグ",
			"カード画像",
		])
			expect(form).toContain(label);
		expect(form).toContain("min-h-11");
		expect(form).toContain("aria-describedby");
		expect(warning).toContain("全カードと上記注意事項を確認しました");
	});

	it("E2E-07 AC-08: rollback hides new AI creation while keeping deck study and status contracts", async () => {
		const deck = await readFile(
			new URL("../../../../frontend/app/(auth)/decks/[deckId]/page.tsx", import.meta.url),
			"utf8"
		);
		const status = await readFile(
			new URL("../../../../frontend/app/api/ai/imports/status/route.ts", import.meta.url),
			"utf8"
		);
		expect(deck).toContain("isAiCardImportEnabled");
		expect(deck).toContain("AIでカードを作る");
		expect(deck).toContain("studyHref");
		expect(status).not.toContain("isAiCardImportEnabled");
	});
});
