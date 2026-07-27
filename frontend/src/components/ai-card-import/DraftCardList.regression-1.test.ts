import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ClientImportItemInput } from "@/lib/ai-import/schema";

import DraftCardList, { updateConceptPairText } from "./DraftCardList";

// Regression: ISSUE-001 — editing one side of a both pair made re-preview fail validation
// Found by /qa on 2026-07-18
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-18.md
describe("DraftCardList concept pair editing", () => {
	const pair: readonly ClientImportItemInput[] = [
		{
			clientItemId: "concept-001-r1",
			conceptId: "concept-001",
			pattern: "R1",
			front: "日",
			back: "にち",
			tags: [],
			image: { mode: "none" },
		},
		{
			clientItemId: "concept-001-w1",
			conceptId: "concept-001",
			pattern: "W1",
			front: "にち",
			back: "日",
			tags: [],
			image: { mode: "none" },
		},
	];

	it("propagates R1 back edits to the paired W1 front", () => {
		const result = updateConceptPairText(pair, 0, "back", "ひ");
		expect(result.map(({ front, back }) => [front, back])).toEqual([
			["日", "ひ"],
			["ひ", "日"],
		]);
	});

	it("propagates W1 back edits to the paired R1 front", () => {
		const result = updateConceptPairText(pair, 1, "back", "月");
		expect(result.map(({ front, back }) => [front, back])).toEqual([
			["月", "にち"],
			["にち", "月"],
		]);
	});

	it("edits a remaining unpaired card after its sibling is excluded", () => {
		const result = updateConceptPairText([pair[0] as ClientImportItemInput], 0, "back", "ひ");
		expect(result[0]).toMatchObject({ front: "日", back: "ひ" });
	});

	it("shows parent-facing confirmation order without concept identifiers as headings", () => {
		const html = renderToStaticMarkup(
			createElement(DraftCardList, {
				items: pair,
				onChange: () => undefined,
				onIllustration: async () => undefined,
				requiredIllustrationConceptIds: ["concept-001"],
				disabled: false,
			})
		);

		expect(html).toContain("上から順番に、表・裏・画像を確認してください。");
		expect(html).toContain("確認 1枚目: 読み練習カード");
		expect(html).toContain("確認 2枚目: 書き練習カード");
		expect(html).toContain("表: 日 / 裏: にち");
		expect(html).toContain("読み書きペアで使う画像（必須）");
		expect(html).toContain("同じ漢字の読みカードと書きカードに共通で使う画像です。");
		expect(html).not.toContain("concept共有画像");
		expect(html).not.toContain("R1 / concept-001");
		expect(html).not.toContain("W1 / concept-001");
		expect(html).not.toMatch(/<h3[^>]*>[^<]*concept-001/u);
	});
});
