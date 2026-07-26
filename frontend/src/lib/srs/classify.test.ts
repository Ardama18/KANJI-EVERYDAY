import { describe, expect, it } from "vitest";

import {
	classifyCard,
	countByCategory,
	findNextDueDate,
	summarizeDeckStudyState,
} from "./classify";
import type { CardWithState, ReviewState } from "./types";

const TODAY = "2026-02-24";

const createState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
	level: 0,
	dueDate: TODAY,
	lastRating: null,
	retryTodayCount: 0,
	lastReviewedAt: "2026-02-24T00:00:00.000Z",
	...overrides,
});

describe("classifyCard", () => {
	it("UT-AC12-CLASSIFY-NEW: state=null を new と分類する", () => {
		expect(classifyCard(null, TODAY)).toBe("new");
	});

	it.each([
		{
			name: "level0 & due=today",
			state: createState({ level: 0, dueDate: TODAY }),
			expected: "learn",
		},
		{
			name: "level1 & due=today",
			state: createState({ level: 1, dueDate: TODAY }),
			expected: "learn",
		},
		{
			name: "level2 & due=today",
			state: createState({ level: 2, dueDate: TODAY }),
			expected: "due",
		},
		{
			name: "level2 & due=future",
			state: createState({ level: 2, dueDate: "2026-02-25" }),
			expected: null,
		},
	])("UT-AC13/14-CLASSIFY-BOUNDARY: $name", ({ state, expected }) => {
		expect(classifyCard(state, TODAY)).toBe(expected);
	});
});

describe("countByCategory", () => {
	it("UT-AC15-COUNT-IGNORE-NULL: null 分類を除外してカテゴリ件数を集計する", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-card", reviewState: null },
			{ cardId: "learn-card", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-card", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "future-card", reviewState: createState({ level: 3, dueDate: "2026-03-01" }) },
		];

		expect(countByCategory(cards, TODAY)).toEqual({
			new: 1,
			learn: 1,
			due: 1,
		});
	});
});

describe("summarizeDeckStudyState", () => {
	it("UT-S17-SUMMARY-FUTURE-SCHEDULED: 将来予定カードだけでも全体状態を集計する", () => {
		const cards: CardWithState[] = [
			{ cardId: "future-1", reviewState: createState({ level: 3, dueDate: "2026-03-01" }) },
			{ cardId: "future-2", reviewState: createState({ level: 4, dueDate: "2026-03-02" }) },
			{ cardId: "new-1", reviewState: null },
		];

		expect(countByCategory(cards, TODAY)).toEqual({
			new: 1,
			learn: 0,
			due: 0,
		});
		expect(summarizeDeckStudyState(cards, TODAY)).toEqual({
			totalCards: 3,
			learnedCards: 2,
			scheduledCards: 2,
		});
	});
});

describe("findNextDueDate", () => {
	it("UT-S19-NEXT-DUE-MIN: 未来 due の最小日付を返す", () => {
		const cards: CardWithState[] = [
			{ cardId: "future-late", reviewState: createState({ level: 4, dueDate: "2026-03-10" }) },
			{ cardId: "future-early", reviewState: createState({ level: 3, dueDate: "2026-02-25" }) },
			{ cardId: "due-today", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "new-card", reviewState: null },
		];

		expect(findNextDueDate(cards, TODAY)).toBe("2026-02-25");
	});

	it("UT-S19-NEXT-DUE-PAST-ONLY: 今日以前の due だけなら null を返す", () => {
		const cards: CardWithState[] = [
			{ cardId: "overdue", reviewState: createState({ level: 2, dueDate: "2026-02-20" }) },
			{ cardId: "due-today", reviewState: createState({ level: 2, dueDate: TODAY }) },
		];

		expect(findNextDueDate(cards, TODAY)).toBeNull();
	});

	it("UT-S19-NEXT-DUE-NO-STATE: 未学習カードだけなら null を返す", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-1", reviewState: null },
			{ cardId: "new-2", reviewState: null },
		];

		expect(findNextDueDate(cards, TODAY)).toBeNull();
	});

	it("UT-S19-NEXT-DUE-EMPTY: 空配列なら null を返し入力を破壊しない", () => {
		const cards: CardWithState[] = [];

		expect(findNextDueDate(cards, TODAY)).toBeNull();
		expect(cards).toEqual([]);
	});
});
