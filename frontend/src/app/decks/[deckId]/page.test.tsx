import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeckOverviewMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn<() => never>());

vi.mock("@/actions/deck-actions", () => ({
	getDeckOverview: getDeckOverviewMock,
}));

vi.mock("next/navigation", () => ({
	notFound: notFoundMock,
}));

import DeckOverviewPage, {
	DECK_OVERVIEW_EMPTY_MESSAGE,
	DECK_OVERVIEW_START_LABEL,
} from "../../../../app/(auth)/decks/[deckId]/page";

class NotFoundSignal extends Error {
	constructor() {
		super("NEXT_NOT_FOUND");
	}
}

describe("frontend/app/(auth)/decks/[deckId]/page.tsx", () => {
	beforeEach(() => {
		getDeckOverviewMock.mockReset();
		notFoundMock.mockReset();
		notFoundMock.mockImplementation(() => {
			throw new NotFoundSignal();
		});
	});

	it("total > 0 ならはじめる導線リンクを表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-1",
			name: "小学3年生の漢字",
			newLimitPerDay: 20,
			counts: {
				new: 4,
				learn: 2,
				due: 1,
				total: 7,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain("今日のカード: 7枚");
		expect(html).toContain(DECK_OVERVIEW_START_LABEL);
		expect(html).toContain('href="/decks/deck-1/study"');
		expect(html).not.toContain(DECK_OVERVIEW_EMPTY_MESSAGE);
	});

	it("total = 0 ならボタンを非活性化し完了メッセージを表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-2",
			name: "小学4年生の漢字",
			newLimitPerDay: 20,
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-2" } }));

		expect(html).toContain(DECK_OVERVIEW_EMPTY_MESSAGE);
		expect(html).toContain("disabled");
	});

	it("対象デッキがないとき notFound を呼ぶ", async () => {
		getDeckOverviewMock.mockResolvedValue(null);

		await expect(DeckOverviewPage({ params: { deckId: "missing" } })).rejects.toThrowError(
			"NEXT_NOT_FOUND"
		);
		expect(notFoundMock).toHaveBeenCalledTimes(1);
	});
});
