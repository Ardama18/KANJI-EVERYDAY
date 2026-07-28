import type { CardBackData, CardFrontData } from "@/actions/session-actions";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CardBack } from "./CardBack";

const baseCard: CardFrontData = {
	sessionId: "session-1",
	cardId: "card-1",
	skill: "reading",
	pattern: "R1",
	frontText: "温かい",
	progress: {
		current: 3,
		total: 18,
		remaining: 16,
	},
};

const baseBackData: CardBackData = {
	cardId: "card-1",
	skill: "reading",
	pattern: "R1",
	frontText: "温かい",
	backText: "あたたかい",
	illustrationUrl: null,
	illustrationStatus: "pending",
	explanation: null,
	intervalPreview: {
		again: { label: "今日さいご + 明日" },
		hard: { interval: 2, label: "2日後" },
		good: { interval: 3, label: "3日後" },
	},
};

const countByTestId = (html: string, testId: string): number =>
	html.match(new RegExp(`data-testid="${testId}"`, "g"))?.length ?? 0;

const renderCardBack = (backDataOverrides: Partial<CardBackData> = {}): string =>
	renderToStaticMarkup(
		<CardBack
			deckId="deck-1"
			deckName="小学3年生の漢字"
			card={baseCard}
			backData={{ ...baseBackData, ...backDataOverrides }}
			onRate={vi.fn()}
		/>
	);

describe("frontend/src/components/study/CardBack.tsx", () => {
	it("UT-AC17: illustrationStatus=none のときイラスト関連DOMを描画しない", () => {
		const html = renderCardBack({
			illustrationStatus: "none",
			illustrationUrl: null,
		});

		expect(countByTestId(html, "illustration-region")).toBe(0);
		expect(countByTestId(html, "illustration-loading")).toBe(0);
		expect(countByTestId(html, "illustration-failed")).toBe(0);
		expect(countByTestId(html, "illustration-image")).toBe(0);
		expect(countByTestId(html, "illustration-fallback")).toBe(0);
		expect(html).not.toContain("イラスト準備中");
	});

	it("裏面表示で IllustrationDisplay の pending 描画を連携する", () => {
		const html = renderCardBack({
			illustrationStatus: "pending",
			illustrationUrl: null,
		});

		expect(html).toContain("温かい");
		expect(html).toContain("あたたかい");
		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-loading")).toBe(1);
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
	});

	it("fallback表示中でも評価導線を維持する", () => {
		const html = renderCardBack({
			illustrationStatus: "ready",
			illustrationUrl: null,
		});

		expect(countByTestId(html, "illustration-fallback")).toBe(1);
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
	});

	it("評価ボタンをviewport下部で押せるsticky領域として描画する", () => {
		const html = renderCardBack({
			illustrationStatus: "ready",
			illustrationUrl: "https://signed.example/image.png",
			explanation: {
				summary: "目で見たものが、頭の中で光って記憶に残る。",
				mappings: [
					{ part: "下の「見」", meaning: "目で見る" },
					{ part: "上の光", meaning: "頭の中で気づき、記憶する" },
				],
			},
		});

		expect(html).toContain("h-[calc(100dvh-5rem)]");
		expect(html).toContain("overflow-y-auto");
		expect(html).toContain("min-h-full");
		expect(html).toContain('data-testid="study-rating-actions"');
		expect(html).toContain("sticky bottom-0");
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
	});

	it("UT-S16F-AC01: ready + explanation で summary と mappings 行を表示する", () => {
		const html = renderCardBack({
			illustrationStatus: "ready",
			illustrationUrl: "https://signed.example/image.png",
			explanation: {
				summary: "目で見たものが、頭の中で光って記憶に残る。",
				mappings: [
					{ part: "下の「見」", meaning: "目で見る" },
					{ part: "上の光", meaning: "頭の中で気づき、記憶する" },
				],
			},
		});

		expect(countByTestId(html, "mnemonic-explanation")).toBe(1);
		expect(html).toContain("目で見たものが、頭の中で光って記憶に残る。");
		expect(html).toContain("下の「見」：目で見る");
		expect(html).toContain("上の光：頭の中で気づき、記憶する");
		expect(countByTestId(html, "mnemonic-explanation-mapping")).toBe(2);
	});

	it("UT-S16F-AC02: explanation=null では説明ブロックを描画しない", () => {
		const html = renderCardBack({
			illustrationStatus: "ready",
			illustrationUrl: "https://signed.example/image.png",
			explanation: null,
		});

		expect(countByTestId(html, "mnemonic-explanation")).toBe(0);
	});

	it("UT-S16F-AC03: illustration が ready 以外なら explanation があっても描画しない", () => {
		const html = renderCardBack({
			illustrationStatus: "pending",
			illustrationUrl: null,
			explanation: {
				summary: "目で見たものが、頭の中で光って記憶に残る。",
				mappings: [{ part: "下の「見」", meaning: "目で見る" }],
			},
		});

		expect(countByTestId(html, "mnemonic-explanation")).toBe(0);
		expect(html).not.toContain("目で見たものが、頭の中で光って記憶に残る。");
	});
});
