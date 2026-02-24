import { describe, expect, it } from "vitest";

import { buildSessionQueue } from "./queue";
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

describe("buildSessionQueue", () => {
	it("UT-AC16-BUILD-QUEUE-BASIC: due/learn/new を分類して retry を空で初期化する", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-1", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-1", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "future-1", reviewState: createState({ level: 3, dueDate: "2026-02-25" }) },
			{ cardId: "new-2", reviewState: null },
		];

		expect(buildSessionQueue(cards, TODAY, 10)).toEqual({
			due: ["due-1"],
			learn: ["learn-1"],
			new: ["new-1", "new-2"],
			retry: [],
		});
	});

	it.each([
		{ newLimit: 1.9, expectedNew: ["new-1"] },
		{ newLimit: -1, expectedNew: [] },
		{ newLimit: Number.NaN, expectedNew: [] },
	])(
		"UT-AC17-NEWLIMIT-NORMALIZE: newLimit=$newLimit のとき new は $expectedNew になる",
		({ newLimit, expectedNew }) => {
			const cards: CardWithState[] = [
				{ cardId: "new-1", reviewState: null },
				{ cardId: "new-2", reviewState: null },
			];

			expect(buildSessionQueue(cards, TODAY, newLimit).new).toEqual(expectedNew);
		}
	);

	it("UT-AC18-BUILD-QUEUE-STABLE-ORDER: カテゴリ内部順序を入力順で維持する", () => {
		const cards: CardWithState[] = [
			{ cardId: "due-1", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "learn-1", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-2", reviewState: createState({ level: 4, dueDate: TODAY }) },
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-2", reviewState: createState({ level: 0, dueDate: TODAY }) },
			{ cardId: "new-2", reviewState: null },
		];

		expect(buildSessionQueue(cards, TODAY, 10)).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1", "learn-2"],
			new: ["new-1", "new-2"],
			retry: [],
		});
	});
});
