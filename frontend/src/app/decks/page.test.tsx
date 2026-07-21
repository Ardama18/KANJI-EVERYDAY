import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDecksWithCountsMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/deck-actions", () => ({
	getDecksWithCounts: getDecksWithCountsMock,
}));

vi.mock("@/components/deck/CreateDeckForm", () => ({
	CreateDeckForm: () => <form aria-label="新しいデッキ作成" data-testid="create-deck-form" />,
}));

import DecksPage, { DECKS_EMPTY_MESSAGE, DECKS_PAGE_TITLE } from "../../../app/(auth)/decks/page";

describe("frontend/app/(auth)/decks/page.tsx", () => {
	beforeEach(() => {
		getDecksWithCountsMock.mockReset();
	});

	it("一覧データが0件のとき空状態メッセージを表示する", async () => {
		getDecksWithCountsMock.mockResolvedValue([]);

		const html = renderToStaticMarkup(await DecksPage());

		expect(html).toContain(DECKS_PAGE_TITLE);
		expect(html).toContain('aria-label="新しいデッキ作成"');
		expect(html).toContain(DECKS_EMPTY_MESSAGE);
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
			},
		]);

		const html = renderToStaticMarkup(await DecksPage());

		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain('aria-label="新しいデッキ作成"');
		expect(html).toContain('href="/decks/deck-1"');
		expect(html).toContain("New");
		expect(html).toContain("Learn");
		expect(html).toContain("Due");
		expect(html).toContain(">10<");
		expect(html).toContain(">3<");
		expect(html).toContain(">5<");
		expect(html).toContain("カード 18枚");
		expect(html).toContain("学習済み 8枚");
	});
});
