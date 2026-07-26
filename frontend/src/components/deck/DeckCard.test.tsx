import type { DeckWithCounts } from "@/actions/deck-actions";
import {
	DECK_STUDY_DONE_MESSAGE,
	DECK_STUDY_LIMIT_REACHED_MESSAGE,
	DECK_STUDY_NO_CARDS_MESSAGE,
	DECK_STUDY_NO_NEXT_DUE_MESSAGE,
} from "@/lib/deck/study-status";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeckCard } from "./DeckCard";

const TODAY = "2026-02-24";

/**
 * CountBadge の値がラベルへ正しく結線されているかを検証する（FR-07）。
 * CountBadge は `<span>{label}</span><span>{value}</span>` の順で描画するため、ラベル直後の数値を読む。
 * 単に両方の数値が HTML に含まれることだけを見ると、あたらしい と ふくしゅう を
 * 入れ替えても検出できない。
 */
const readBadgeValue = (html: string, label: string): string | null =>
	new RegExp(`<span>${label}</span><span>(\\d+)</span>`).exec(html)?.[1] ?? null;

const createDeck = (overrides: Partial<DeckWithCounts> = {}): DeckWithCounts => ({
	id: "deck-1",
	name: "小学3年生の漢字",
	counts: { new: 10, learn: 3, due: 5 },
	totalCards: 18,
	learnedCards: 8,
	scheduledCards: 2,
	dailyStudyLimit: 20,
	studiedToday: 3,
	nextDueDate: null,
	...overrides,
});

describe("frontend/src/components/deck/DeckCard.tsx", () => {
	it("UT-S19-DECKCARD-TODO: 今日やることがあるとき あたらしい/ふくしゅう と きょうやった を表示する", () => {
		const html = renderToStaticMarkup(<DeckCard deck={createDeck()} today={TODAY} />);

		expect(html).toContain('href="/decks/deck-1"');
		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain("あたらしい");
		expect(html).toContain("ふくしゅう");
		expect(readBadgeValue(html, "あたらしい")).toBe("10");
		// ふくしゅう は learn + due の合算値
		expect(readBadgeValue(html, "ふくしゅう")).toBe("8");
		expect(html).toContain("きょうやった");
		expect(html).toContain("3枚");
		expect(html).toContain("カード 18枚");
		expect(html).toContain("学習した 8枚");
		expect(html).not.toContain(DECK_STUDY_DONE_MESSAGE);
	});

	it("UT-S19-DECKCARD-NO-ENGLISH-LABEL: 英語ラベルと将来予定枚数を表示しない", () => {
		const html = renderToStaticMarkup(<DeckCard deck={createDeck()} today={TODAY} />);

		expect(html).not.toContain("New");
		expect(html).not.toContain("Learn");
		expect(html).not.toContain("Due");
		expect(html).not.toContain("予定 2枚");
	});

	it("UT-S19-DECKCARD-DONE-NEXT-DUE: 今日やることが0なら完了文言と次回予定日を表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={createDeck({
					id: "deck-done",
					counts: { new: 0, learn: 0, due: 0 },
					studiedToday: 12,
					nextDueDate: "2026-03-01",
				})}
				today={TODAY}
			/>
		);

		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain("つぎは 3月1日");
		expect(html).toContain("きょうやった");
		expect(html).toContain("12枚");
	});

	it("UT-S19-DECKCARD-DONE-TOMORROW: 次回予定が翌日なら あした と表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={createDeck({
					counts: { new: 0, learn: 0, due: 0 },
					nextDueDate: "2026-02-25",
				})}
				today={TODAY}
			/>
		);

		expect(html).toContain("つぎは あした");
	});

	it("UT-S19-DECKCARD-DONE-NO-NEXT-DUE: 次回予定が無いとき予定なし文言を表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={createDeck({
					counts: { new: 0, learn: 0, due: 0 },
					scheduledCards: 0,
					nextDueDate: null,
				})}
				today={TODAY}
			/>
		);

		expect(html).toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
	});

	it("UT-S19-DECKCARD-LIMIT-REACHED: 残り枠0なら上限到達文言を表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={createDeck({
					counts: { new: 2, learn: 1, due: 0 },
					dailyStudyLimit: 20,
					studiedToday: 20,
					nextDueDate: "2026-02-25",
				})}
				today={TODAY}
			/>
		);

		expect(html).toContain(DECK_STUDY_LIMIT_REACHED_MESSAGE);
		expect(html).toContain("つぎは あした");
		expect(html).toContain("20枚");
		expect(html).not.toContain("あたらしい");
	});

	it("UT-S19-DECKCARD-NO-CARDS: カード0枚ならカード未登録文言を表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={createDeck({
					counts: { new: 0, learn: 0, due: 0 },
					totalCards: 0,
					learnedCards: 0,
					scheduledCards: 0,
					studiedToday: 0,
					nextDueDate: null,
				})}
				today={TODAY}
			/>
		);

		expect(html).toContain(DECK_STUDY_NO_CARDS_MESSAGE);
		expect(html).not.toContain(DECK_STUDY_DONE_MESSAGE);
		expect(html).not.toContain(DECK_STUDY_NO_NEXT_DUE_MESSAGE);
		// 0枚のバッジはグレー配色で表示する
		expect(html).toContain("bg-slate-200 text-slate-700");
	});
});
