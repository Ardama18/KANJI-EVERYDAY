import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeckLearningMetricsMock = vi.hoisted(() => vi.fn());
const getDeckOverviewMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn<() => never>());

vi.mock("@/actions/deck-actions", () => ({
	getDeckLearningMetrics: getDeckLearningMetricsMock,
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

import {
	DECK_LABEL_NEW,
	DECK_STUDY_DONE_MESSAGE,
	DECK_STUDY_LIMIT_REACHED_MESSAGE,
	DECK_STUDY_NO_CARDS_MESSAGE,
	DECK_STUDY_NO_NEXT_DUE_MESSAGE,
} from "@/lib/deck/study-status";

import DeckOverviewPage, {
	DECK_OVERVIEW_START_LABEL,
} from "../../../../app/(auth)/decks/[deckId]/page";

class NotFoundSignal extends Error {
	constructor() {
		super("NEXT_NOT_FOUND");
	}
}

// JST 2026-02-24 00:30。「あした」判定を実行日に依存させない。
const FIXED_NOW = new Date("2026-02-23T15:30:00.000Z");

const WHOLE_STUDY_HEADING = "これまでの記録";
const LEARNING_METRICS_HEADING = "最近の学習メモ";
const defaultMetrics = {
	contractVersion: 1,
	today: "2026-02-24",
	windowStart: "2026-02-18",
	windowEnd: "2026-02-24",
	activeDays: 2,
	recentDays: [
		{ date: "2026-02-18", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-19", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-20", completedSessions: 1, reviewedCards: 1 },
		{ date: "2026-02-21", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-22", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-23", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-24", completedSessions: 1, reviewedCards: 2 },
	],
	latestRatings: {
		total: 3,
		again: 1,
		hard: 1,
		good: 1,
		againRate: 33,
		hardRate: 33,
		goodRate: 33,
	},
	mnemonicTrend: {
		withMnemonic: {
			total: 0,
			again: 0,
			hard: 0,
			good: 0,
			againRate: null,
			hardRate: null,
			goodRate: null,
		},
		withoutMnemonic: {
			total: 3,
			again: 1,
			hard: 1,
			good: 1,
			againRate: 33,
			hardRate: 33,
			goodRate: 33,
		},
		comparable: false,
	},
};

/**
 * StatCard の値がラベルへ正しく結線されているかを検証する（AC-1 / AC-3）。
 * StatCard は `<p>{label}</p><p>{value}</p>` の順で描画するため、ラベル直後の数値を読む。
 */
const readStatCardValue = (html: string, label: string): string | null =>
	new RegExp(`>${label}</p><p[^>]*>(\\d+)</p>`).exec(html)?.[1] ?? null;

/** disabled ボタンの `aria-describedby` が参照する id を取り出す。 */
const readDisabledButtonDescribedBy = (html: string): string | null =>
	/<button[^>]*\bdisabled\b[^>]*>/.exec(html)?.[0].match(/aria-describedby="([^"]+)"/)?.[1] ?? null;

/**
 * `aria-describedby` の参照先が実在し、期待した文言を含むことを検証する（N-3）。
 * 視覚的近接に依存せず disabled 理由が支援技術へ届くことを固定する。
 */
const expectDisabledButtonDescribedByText = (html: string, expectedText: string): void => {
	const describedBy = readDisabledButtonDescribedBy(html);
	expect(describedBy).not.toBeNull();

	const target = new RegExp(`<[^>]*\\bid="${describedBy}"[^>]*>([^<]*)</`).exec(html);
	expect(target).not.toBeNull();
	expect(target?.[1]).toContain(expectedText);
};

describe("frontend/app/(auth)/decks/[deckId]/page.tsx", () => {
	beforeEach(() => {
		getDeckLearningMetricsMock.mockReset();
		getDeckOverviewMock.mockReset();
		notFoundMock.mockReset();
		notFoundMock.mockImplementation(() => {
			throw new NotFoundSignal();
		});
		getDeckLearningMetricsMock.mockResolvedValue(defaultMetrics);
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// 値の取り違えを検知するため、描画される数値は相互に重複しない値にする。
	const todoOverview = {
		id: "deck-1",
		name: "小学3年生の漢字",
		newLimitPerDay: 20,
		dailyStudyLimit: 25,
		studiedToday: 9,
		remainingToday: 16,
		totalCards: 21,
		learnedCards: 13,
		scheduledCards: 6,
		nextDueDate: "2026-03-01",
		counts: {
			new: 4,
			learn: 2,
			due: 5,
			total: 11,
		},
	};

	it("total > 0 ならはじめる導線リンクを表示する", async () => {
		getDeckOverviewMock.mockResolvedValue(todoOverview);

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain("今日の学習");
		expect(html).toContain("今日やること 11枚 / 今日やれる残り 16枚");
		expect(html).toContain(LEARNING_METRICS_HEADING);
		expect(html).toContain("学習した日 2日 / 7日");
		expect(html).toContain(WHOLE_STUDY_HEADING);
		expect(html).toContain("一日最大 25枚 / きょうやった 9枚");
		expect(html).toContain('data-testid="study-limit-form"');
		expect(html).toContain(DECK_OVERVIEW_START_LABEL);
		expect(html).toContain('href="/decks/deck-1/study"');
		expect(html).not.toContain(DECK_STUDY_DONE_MESSAGE);
		expect(getDeckLearningMetricsMock).toHaveBeenCalledWith("deck-1");
	});

	it("最近の学習メモを 今日の学習 と これまでの記録 の間に表示する", async () => {
		getDeckOverviewMock.mockResolvedValue(todoOverview);

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(html.indexOf("今日の学習")).toBeLessThan(html.indexOf(LEARNING_METRICS_HEADING));
		expect(html.indexOf(LEARNING_METRICS_HEADING)).toBeLessThan(html.indexOf(WHOLE_STUDY_HEADING));
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
		expect(html).toContain("比較できる学習データがまだありません。");
	});

	it("今日の学習 StatCard が各指標の値を表示する", async () => {
		getDeckOverviewMock.mockResolvedValue(todoOverview);

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(readStatCardValue(html, "あたらしい")).toBe("4");
		// ふくしゅう は learn + due の合算値（FR-07）
		expect(readStatCardValue(html, "ふくしゅう")).toBe("7");
		// きょうやった は overview.studiedToday（FR-02）
		expect(readStatCardValue(html, "きょうやった")).toBe("9");
	});

	it("これまでの記録 StatCard が各指標の値を表示する", async () => {
		getDeckOverviewMock.mockResolvedValue(todoOverview);

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(readStatCardValue(html, "カード総数")).toBe("21");
		expect(readStatCardValue(html, "学習した数")).toBe("13");
		expect(readStatCardValue(html, "つぎの予定")).toBe("6");
	});

	it("英語ラベルを表示しない", async () => {
		getDeckOverviewMock.mockResolvedValue(todoOverview);

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-1" } }));

		expect(html).not.toContain("New");
		expect(html).not.toContain("Learn");
		expect(html).not.toContain("Due");
	});

	it("total = 0 ならボタンを非活性化しカード未登録メッセージを表示する", async () => {
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
			nextDueDate: null,
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-2" } }));

		expect(html).toContain(DECK_STUDY_NO_CARDS_MESSAGE);
		expect(html).not.toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
		expect(html).toContain("disabled");
	});

	it("total = 0 かつ将来予定ありなら完了メッセージと次回予定日を表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-3",
			name: "テスt",
			newLimitPerDay: 10,
			dailyStudyLimit: 20,
			studiedToday: 4,
			remainingToday: 16,
			totalCards: 12,
			learnedCards: 12,
			scheduledCards: 12,
			nextDueDate: "2026-03-01",
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-3" } }));

		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain("つぎは 3月1日");
		expect(html).toContain("これまでの記録");
		expect(html).toContain("つぎの予定");
		expect(html).toContain("disabled");
	});

	it("次回予定が翌日なら つぎは あした を表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-4",
			name: "あしたデッキ",
			newLimitPerDay: 10,
			dailyStudyLimit: 20,
			studiedToday: 6,
			remainingToday: 14,
			totalCards: 10,
			learnedCards: 10,
			scheduledCards: 10,
			nextDueDate: "2026-02-25",
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-4" } }));

		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain("つぎは あした");
	});

	it("完了かつ次回予定が無いなら予定なしメッセージを表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-5",
			name: "予定なしデッキ",
			newLimitPerDay: 10,
			dailyStudyLimit: 20,
			studiedToday: 2,
			remainingToday: 18,
			totalCards: 10,
			learnedCards: 10,
			scheduledCards: 0,
			nextDueDate: null,
			counts: {
				new: 0,
				learn: 0,
				due: 0,
				total: 0,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-5" } }));

		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
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
			nextDueDate: null,
			counts: {
				new: 0,
				learn: 1,
				due: 2,
				total: 3,
			},
		});

		const html = renderToStaticMarkup(await DeckOverviewPage({ params: { deckId: "deck-limit" } }));

		expect(html).toContain(DECK_STUDY_LIMIT_REACHED_MESSAGE);
		// 上限到達は明日やることが残っている状態なので「予定なし」を併記しない（SF-1）。
		expect(html).not.toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
		expect(html).toContain("disabled");
		expect(html).not.toContain('href="/decks/deck-limit/study"');
	});

	it("完了状態では完了メッセージを これまでの記録 より前に主表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-done-banner",
			name: "完了デッキ",
			newLimitPerDay: 10,
			dailyStudyLimit: 20,
			studiedToday: 7,
			remainingToday: 13,
			totalCards: 14,
			learnedCards: 14,
			scheduledCards: 14,
			nextDueDate: "2026-02-25",
			counts: { new: 0, learn: 0, due: 0, total: 0 },
		});

		const html = renderToStaticMarkup(
			await DeckOverviewPage({ params: { deckId: "deck-done-banner" } })
		);

		// 0 の羅列ではなく完了メッセージを主表示にする（FR-03 / AC-2）
		expect(html.indexOf(DECK_STUDY_DONE_MESSAGE)).toBeGreaterThan(-1);
		expect(html.indexOf(DECK_STUDY_DONE_MESSAGE)).toBeLessThan(html.indexOf(WHOLE_STUDY_HEADING));
		// 「これまでの記録」より前だけでは 0 の StatCard グリッドの下へ移動しても緑になるため、
		// グリッド先頭ラベルより前であることまで固定する（FR-03）。
		expect(html.indexOf(DECK_STUDY_DONE_MESSAGE)).toBeLessThan(html.indexOf(DECK_LABEL_NEW));
		expect(html.indexOf("つぎは あした")).toBeLessThan(html.indexOf(WHOLE_STUDY_HEADING));
		// 同じ文言をボタン下と二重に出さない
		expect(html.split(DECK_STUDY_DONE_MESSAGE)).toHaveLength(2);
	});

	it("上限到達では上限メッセージを これまでの記録 より前に主表示する", async () => {
		getDeckOverviewMock.mockResolvedValue({
			id: "deck-limit-banner",
			name: "上限デッキ",
			newLimitPerDay: 10,
			dailyStudyLimit: 2,
			studiedToday: 2,
			remainingToday: 0,
			totalCards: 5,
			learnedCards: 5,
			scheduledCards: 0,
			nextDueDate: null,
			counts: { new: 0, learn: 1, due: 2, total: 3 },
		});

		const html = renderToStaticMarkup(
			await DeckOverviewPage({ params: { deckId: "deck-limit-banner" } })
		);

		expect(html.indexOf(DECK_STUDY_LIMIT_REACHED_MESSAGE)).toBeGreaterThan(-1);
		expect(html.indexOf(DECK_STUDY_LIMIT_REACHED_MESSAGE)).toBeLessThan(
			html.indexOf(WHOLE_STUDY_HEADING)
		);
		// StatCard グリッドより上にあることまで固定する（FR-03）。
		expect(html.indexOf(DECK_STUDY_LIMIT_REACHED_MESSAGE)).toBeLessThan(
			html.indexOf(DECK_LABEL_NEW)
		);
		// 上限到達は明日やることが残っている状態なので「予定なし」を併記しない（SF-1）。
		expect(html).not.toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
		expect(html.split(DECK_STUDY_LIMIT_REACHED_MESSAGE)).toHaveLength(2);
	});

	it.each([
		{
			kind: "no-cards",
			overview: {
				id: "deck-a11y-no-cards",
				name: "空デッキ",
				newLimitPerDay: 10,
				dailyStudyLimit: 20,
				studiedToday: 0,
				remainingToday: 20,
				totalCards: 0,
				learnedCards: 0,
				scheduledCards: 0,
				nextDueDate: null,
				counts: { new: 0, learn: 0, due: 0, total: 0 },
			},
			expectedText: DECK_STUDY_NO_CARDS_MESSAGE,
		},
		{
			kind: "done",
			overview: {
				id: "deck-a11y-done",
				name: "完了デッキ",
				newLimitPerDay: 10,
				dailyStudyLimit: 20,
				studiedToday: 7,
				remainingToday: 13,
				totalCards: 14,
				learnedCards: 14,
				scheduledCards: 14,
				nextDueDate: "2026-03-01",
				counts: { new: 0, learn: 0, due: 0, total: 0 },
			},
			expectedText: DECK_STUDY_DONE_MESSAGE,
		},
		{
			kind: "limit-reached",
			overview: {
				id: "deck-a11y-limit",
				name: "上限デッキ",
				newLimitPerDay: 10,
				dailyStudyLimit: 2,
				studiedToday: 2,
				remainingToday: 0,
				totalCards: 5,
				learnedCards: 5,
				scheduledCards: 0,
				nextDueDate: null,
				counts: { new: 0, learn: 1, due: 2, total: 3 },
			},
			expectedText: DECK_STUDY_LIMIT_REACHED_MESSAGE,
		},
	])(
		"$kind では disabled ボタンが実在する理由文言を aria-describedby で参照する",
		async ({ overview, expectedText }) => {
			getDeckOverviewMock.mockResolvedValue(overview);

			const html = renderToStaticMarkup(
				await DeckOverviewPage({ params: { deckId: overview.id } })
			);

			expectDisabledButtonDescribedByText(html, expectedText);
		}
	);

	it("対象デッキがないとき notFound を呼ぶ", async () => {
		getDeckOverviewMock.mockResolvedValue(null);

		await expect(DeckOverviewPage({ params: { deckId: "missing" } })).rejects.toThrowError(
			"NEXT_NOT_FOUND"
		);
		expect(notFoundMock).toHaveBeenCalledTimes(1);
		expect(getDeckLearningMetricsMock).not.toHaveBeenCalled();
	});
});
