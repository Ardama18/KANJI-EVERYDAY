// S-16D component + client-state tests (AC-1 / AC-3 / AC-4).
// Design: specs/stories/S-16D-approval-ui/design.md §6.1.
// No jsdom is available, so the controlled component is exercised via static
// server rendering; interaction logic is covered through the exported pure
// helpers (validity gate, draft parsing, commit-body assembly).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	buildApprovedMnemonics,
	conceptViews,
	parseGeneratedResult,
	seedMnemonicApprovals,
} from "../../../../frontend/app/(auth)/decks/[deckId]/ai/new/AiCardImportClient";
import MnemonicApprovalList, {
	type MnemonicApprovalEntry,
	type MnemonicConceptView,
	isMnemonicEntryValid,
} from "../../../../frontend/src/components/ai-card-import/MnemonicApprovalList";
import type { ClientImportItemInput } from "../../../../frontend/src/lib/ai-import/schema";

function slots(overrides: Partial<MnemonicApprovalEntry["slots"]> = {}): MnemonicApprovalEntry["slots"] {
	return {
		kanji: "山",
		isSingleKanji: true,
		shapeHint: { part: "三つの峰", picture: "そびえ立つ山並み" },
		meaningHint: "たかい土地",
		story: "峰が三つ並ぶ風景。",
		...overrides,
	};
}

function explanation(
	overrides: Partial<MnemonicApprovalEntry["explanation"]> = {}
): MnemonicApprovalEntry["explanation"] {
	return {
		summary: "三つの峰が山を表す。",
		mappings: [
			{ part: "左", meaning: "やま" },
			{ part: "中央", meaning: "たかい" },
		],
		...overrides,
	};
}

function entry(overrides: Partial<MnemonicApprovalEntry> = {}): MnemonicApprovalEntry {
	return { slots: slots(), explanation: explanation(), approved: false, ...overrides };
}

function render(
	concepts: readonly MnemonicConceptView[],
	entries: ReadonlyMap<string, MnemonicApprovalEntry>
): string {
	return renderToStaticMarkup(
		createElement(MnemonicApprovalList, {
			concepts,
			entries,
			onEntryChange: () => undefined,
			disabled: false,
		})
	);
}

function item(conceptId: string, mode: "none" | "ai" | "upload"): ClientImportItemInput {
	return {
		clientItemId: `c-${conceptId}`,
		conceptId,
		pattern: "R1",
		front: "山",
		back: "やま",
		tags: [],
		image: mode === "upload" ? { mode, uploadId: "11111111-1111-4111-8111-111111111111" } : { mode },
	};
}

describe("S-16D MnemonicApprovalList render (AC-1 / AC-4)", () => {
	it("C-01 shows the concept id and seeded slot values", () => {
		const html = render([{ conceptId: "concept-1", image: "ai" }], new Map([["concept-1", entry()]]));
		expect(html).toContain("concept-1");
		expect(html).toContain('value="山"');
		expect(html).toContain("この内容を承認する");
	});

	it("C-02 warns that image='ai' unapproved concepts get no illustration", () => {
		const html = render([{ conceptId: "concept-1", image: "ai" }], new Map([["concept-1", entry()]]));
		expect(html).toContain("ニーモニック未承認：画像は生成されません");
	});

	it("C-03 hides the warning once the concept is approved", () => {
		const html = render(
			[{ conceptId: "concept-1", image: "ai" }],
			new Map([["concept-1", entry({ approved: true })]])
		);
		expect(html).not.toContain("ニーモニック未承認：画像は生成されません");
	});

	it("C-04 disables the approve checkbox when the entry is invalid", () => {
		const html = render(
			[{ conceptId: "concept-1", image: "ai" }],
			new Map([["concept-1", entry({ slots: slots({ story: "" }) })]])
		);
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/u);
	});

	it("C-05 disables the add button at 4 mappings and the remove button at 2 mappings", () => {
		const atFour = render(
			[{ conceptId: "concept-1", image: "ai" }],
			new Map([
				[
					"concept-1",
					entry({
						explanation: explanation({
							mappings: [
								{ part: "a", meaning: "1" },
								{ part: "b", meaning: "2" },
								{ part: "c", meaning: "3" },
								{ part: "d", meaning: "4" },
							],
						}),
					}),
				],
			])
		);
		expect(atFour).toMatch(/<button[^>]*disabled=""[^>]*>対応を追加<\/button>/u);
		const atTwo = render([{ conceptId: "concept-1", image: "ai" }], new Map([["concept-1", entry()]]));
		expect(atTwo).toMatch(/<button[^>]*disabled=""[^>]*>対応を削除<\/button>/u);
		expect(atTwo).toMatch(/<button type="button" class[^>]*>対応を追加<\/button>/u);
	});

	it("C-06 renders nothing when no concept has a draft entry", () => {
		expect(render([{ conceptId: "concept-1", image: "ai" }], new Map())).toBe("");
	});
});

describe("S-16D isMnemonicEntryValid (AC-3)", () => {
	it("C-07 accepts a well-formed entry and rejects empties / bad mapping counts", () => {
		expect(isMnemonicEntryValid(entry())).toBe(true);
		expect(isMnemonicEntryValid(entry({ slots: slots({ kanji: "" }) }))).toBe(false);
		expect(
			isMnemonicEntryValid(entry({ explanation: explanation({ mappings: [{ part: "a", meaning: "1" }] }) }))
		).toBe(false);
		expect(
			isMnemonicEntryValid(
				entry({
					explanation: explanation({
						mappings: [
							{ part: "a", meaning: "1" },
							{ part: "b", meaning: "2" },
							{ part: "c", meaning: "3" },
							{ part: "d", meaning: "4" },
							{ part: "e", meaning: "5" },
						],
					}),
				})
			)
		).toBe(false);
	});
});

describe("S-16D client draft/commit helpers (AC-1 / AC-4)", () => {
	it("C-08 preserves mnemonicDraft from a generation envelope and seeds unapproved state", () => {
		const generated = parseGeneratedResult({
			request: { deck: { id: "d1" }, items: [{ clientItemId: "c", conceptId: "concept-1", pattern: "R1", front: "山", back: "やま", tags: [], image: { mode: "ai" } }] },
			previewToken: "t",
			importRequestHash: "a".repeat(64),
			previewExpiresAt: 1,
			cardReservationKey: "k",
			mnemonicDraft: [{ conceptId: "concept-1", slots: slots(), explanation: explanation() }],
		});
		expect(generated?.mnemonicDraft).toHaveLength(1);
		const seeded = seedMnemonicApprovals(generated?.mnemonicDraft);
		expect(seeded.get("concept-1")?.approved).toBe(false);
		expect(seeded.get("concept-1")?.slots.kanji).toBe("山");
	});

	it("C-09 leaves mnemonicDraft undefined on a re-preview response so approval state is not overwritten", () => {
		const rePreview = parseGeneratedResult({
			request: { deck: { id: "d1" }, items: [{ clientItemId: "c", conceptId: "concept-1", pattern: "R1", front: "山", back: "やま", tags: [], image: { mode: "ai" } }] },
			previewToken: "t",
			importRequestHash: "a".repeat(64),
			previewExpiresAt: 1,
			cardReservationKey: "k",
		});
		expect(rePreview?.mnemonicDraft).toBeUndefined();
	});

	it("C-10 sends only approved concepts that still exist in the request items", () => {
		const items = [item("concept-1", "ai"), item("concept-2", "none"), item("concept-3", "ai")];
		const approvals = new Map<string, MnemonicApprovalEntry>([
			["concept-1", entry({ approved: true })],
			["concept-2", entry({ approved: true })],
			["concept-3", entry({ approved: false })],
			["concept-removed", entry({ approved: true })],
		]);
		const body = buildApprovedMnemonics(items, approvals);
		expect(body.map((mnemonic) => mnemonic.conceptId).sort()).toEqual(["concept-1", "concept-2"]);
	});

	it("C-11 derives one concept view per conceptId with its image mode", () => {
		const views = conceptViews([item("concept-1", "ai"), item("concept-1", "ai"), item("concept-2", "none")]);
		expect(views).toEqual([
			{ conceptId: "concept-1", image: "ai" },
			{ conceptId: "concept-2", image: "none" },
		]);
	});
});
