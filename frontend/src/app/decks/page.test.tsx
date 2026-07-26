import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDecksWithCountsMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/deck-actions", () => ({
	getDecksWithCounts: getDecksWithCountsMock,
}));

vi.mock("@/components/deck/CreateDeckForm", () => ({
	CreateDeckForm: () => <form aria-label="新しいデッキ作成" data-testid="create-deck-form" />,
}));

import { DECK_STUDY_DONE_MESSAGE } from "@/lib/deck/study-status";

/**
 * CountBadge の値がラベルへ正しく結線されているかを検証する（FR-07）。
 * 両方の数値の存在だけを見ると あたらしい / ふくしゅう の入れ替えを検出できない。
 */
const readBadgeValue = (html: string, label: string): string | null =>
	new RegExp(`<span>${label}</span><span>(\\d+)</span>`).exec(html)?.[1] ?? null;

import DecksPage, {
	DECKS_EMPTY_MESSAGE,
	DECKS_EMPTY_NEXT_ACTION_MESSAGE,
	DECKS_PAGE_TITLE,
} from "../../../app/(auth)/decks/page";

// JST 2026-02-24 00:30。page が渡す `today` の妥当性を実行日に依存させない。
const FIXED_NOW = new Date("2026-02-23T15:30:00.000Z");

describe("frontend/app/(auth)/decks/page.tsx", () => {
	beforeEach(() => {
		getDecksWithCountsMock.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("一覧データが0件のとき空状態メッセージを表示する", async () => {
		getDecksWithCountsMock.mockResolvedValue([]);

		const html = renderToStaticMarkup(await DecksPage());

		expect(html).toContain(DECKS_PAGE_TITLE);
		expect(html).toContain('aria-label="新しいデッキ作成"');
		expect(html).toContain(DECKS_EMPTY_MESSAGE);
		expect(html).toContain(DECKS_EMPTY_NEXT_ACTION_MESSAGE);
	});

	it("一覧データがあるときデッキ行リンクとカウントを表示する", async () => {
		getDecksWithCountsMock.mockResolvedValue([
			{
				id: "deck-1",
				name: "小学3年生の漢字",
				counts: { new: 10, learn: 3, due: 5 },
				totalCards: 18,
				learnedCards: 8,
				scheduledCards: 2,
				dailyStudyLimit: 20,
				studiedToday: 3,
				nextDueDate: "2999-01-01",
			},
			{
				// 今日やること 0 枚 + 次回予定が「固定した今日の翌日」。
				// page が getTodayJST() を評価して DeckCard へ渡す `today` が正しいときだけ
				// 「つぎは あした」になる（NFR-03）。
				id: "deck-2",
				name: "あしたデッキ",
				counts: { new: 0, learn: 0, due: 0 },
				totalCards: 6,
				learnedCards: 6,
				scheduledCards: 6,
				dailyStudyLimit: 20,
				studiedToday: 4,
				nextDueDate: "2026-02-25",
			},
		]);

		const html = renderToStaticMarkup(await DecksPage());

		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain('aria-label="新しいデッキ作成"');
		expect(html).toContain('href="/decks/deck-1"');
		expect(html).toContain("あたらしい");
		expect(html).toContain("ふくしゅう");
		expect(html).toContain("きょうやった");
		expect(readBadgeValue(html, "あたらしい")).toBe("10");
		// ふくしゅう は learn + due の合算値
		expect(readBadgeValue(html, "ふくしゅう")).toBe("8");
		expect(html).toContain("3枚");
		expect(html).toContain("カード 18枚");
		expect(html).toContain("学習した 8枚");
		expect(html).not.toContain(DECKS_EMPTY_NEXT_ACTION_MESSAGE);
		// 完了デッキは page が渡した today を基準に「あした」と判定される（NFR-03）
		expect(html).toContain("あしたデッキ");
		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain("つぎは あした");
		expect(html).not.toContain("New");
		expect(html).not.toContain("Learn");
		expect(html).not.toContain("Due");
	});
});
