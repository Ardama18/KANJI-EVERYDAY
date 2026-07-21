import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeckOverviewMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn<() => never>());

vi.mock("@/actions/deck-actions", () => ({
	getDeckOverview: getDeckOverviewMock,
}));

vi.mock("@/components/deck/DeckStudyLimitForm", () => ({
	DeckStudyLimitForm: ({
		deckId,
		dailyStudyLimit,
		newLimitPerDay,
	}: {
		deckId: string;
		dailyStudyLimit: number;
		newLimitPerDay: number;
	}) => (
		<form data-testid="study-limit-form">
			<input name="deckId" value={deckId} readOnly />
			<input name="dailyStudyLimit" value={dailyStudyLimit} readOnly />
			<span>新規カード上限: {newLimitPerDay}枚</span>
		</form>
	),
}));

vi.mock("next/navigation", () => ({
	notFound: notFoundMock,
}));

import DeckOverviewPage, {
	DECK_OVERVIEW_EMPTY_MESSAGE,
	DECK_OVERVIEW_LIMIT_REACHED_MESSAGE,
	DECK_OVERVIEW_NO_CARDS_MESSAGE,
	DECK_OVERVIEW_SCHEDULED_MESSAGE,
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
			dailyStudyLimit: 25,
			studiedToday: 3,
			remainingToday: 22,
			totalCards: 12,
			learnedCards: 5,
			scheduledCards: 2,
			counts: {
				new: 4,
				learn: 2,
				due: 1,
				total: 7,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain("今日の学習");
		expect(html).toContain("今日のカード: 7枚 / 残り枠: 22枚");
		expect(html).toContain("全体状態");
		expect(html).toContain("カード総数");
		expect(html).toContain("学習済み");
		expect(html).toContain("将来予定");
		expect(html).toContain("一日最大 25枚 / 今日の学習済み 3枚");
		expect(html).toContain('data-testid="study-limit-form"');
		expect(html).toContain(DECK_OVERVIEW_START_LABEL);
		expect(html).toContain('href="/decks/deck-1/study"');
		expect(html).not.toContain(DECK_OVERVIEW_EMPTY_MESSAGE);
	});

	it("total = 0 ならボタンを非活性化し完了メッセージを表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-2",
			name: "小学4年生の漢字",
			newLimitPerDay: 20,
			dailyStudyLimit: 20,
			studiedToday: 0,
			remainingToday: 20,
			totalCards: 0,
			learnedCards: 0,
			scheduledCards: 0,
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-2" } }));

		expect(html).toContain(DECK_OVERVIEW_NO_CARDS_MESSAGE);
		expect(html).toContain("disabled");
	});

	it("total = 0 かつ将来予定ありなら次の予定カードがある文言を表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-3",
			name: "テスt",
			newLimitPerDay: 10,
			dailyStudyLimit: 20,
			studiedToday: 0,
			remainingToday: 20,
			totalCards: 12,
			learnedCards: 12,
			scheduledCards: 12,
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-3" } }));

		expect(html).toContain(DECK_OVERVIEW_SCHEDULED_MESSAGE);
		expect(html).toContain("カード総数");
		expect(html).toContain("学習済み");
		expect(html).toContain("将来予定");
		expect(html).toContain("disabled");
		expect(html).not.toContain(DECK_OVERVIEW_EMPTY_MESSAGE);
	});

	it("今日の対象カードがあっても残り枠0なら開始導線を非活性化する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-limit",
			name: "今日の上限デッキ",
			newLimitPerDay: 10,
			dailyStudyLimit: 2,
			studiedToday: 2,
			remainingToday: 0,
			totalCards: 5,
			learnedCards: 5,
			scheduledCards: 0,
			counts: {
				new: 0,
				learn: 1,
				due: 2,
				total: 3,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-limit" } }));

		expect(html).toContain(DECK_OVERVIEW_LIMIT_REACHED_MESSAGE);
		expect(html).toContain("disabled");
		expect(html).not.toContain('href="/decks/deck-limit/study"');
	});

	it("対象デッキがないとき notFound を呼ぶ", async () => {
		getDeckOverviewMock.mockResolvedValue(null);

		await expect(DeckOverviewPage({ params: { deckId: "missing" } })).rejects.toThrowError(
			"NEXT_NOT_FOUND"
		);
		expect(notFoundMock).toHaveBeenCalledTimes(1);
	});
});
