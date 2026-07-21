import { describe, expect, it } from "vitest";

import {
	addToRetryQueue,
	buildSessionQueue,
	dequeueCard,
	getNextCardId,
	isSessionComplete,
} from "./queue";
import type { CardWithState, ReviewState, SessionQueue } from "./types";

const TODAY = "2026-02-24";

const createState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
	level: 0,
	dueDate: TODAY,
	lastRating: null,
	retryTodayCount: 0,
	lastReviewedAt: "2026-02-24T00:00:00.000Z",
	...overrides,
});

const createQueue = (overrides: Partial<SessionQueue> = {}): SessionQueue => ({
	due: [],
	learn: [],
	new: [],
	retry: [],
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

		expect(buildSessionQueue(cards, TODAY, { newLimit: 10, dailyStudyLimit: 10 })).toEqual({
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

			expect(buildSessionQueue(cards, TODAY, { newLimit, dailyStudyLimit: 10 }).new).toEqual(
				expectedNew
			);
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

		expect(buildSessionQueue(cards, TODAY, { newLimit: 10, dailyStudyLimit: 10 })).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1", "learn-2"],
			new: ["new-1", "new-2"],
			retry: [],
		});
	});

	it("UT-S17-QUEUE-DAILY-LIMIT-DUE-FIRST: Due が一日上限を満たすと後続カテゴリを入れない", () => {
		const cards: CardWithState[] = [
			{ cardId: "due-1", reviewState: createState({ level: 2 }) },
			{ cardId: "due-2", reviewState: createState({ level: 3 }) },
			{ cardId: "due-3", reviewState: createState({ level: 4 }) },
			{ cardId: "due-4", reviewState: createState({ level: 5 }) },
			{ cardId: "learn-1", reviewState: createState({ level: 1 }) },
			{ cardId: "new-1", reviewState: null },
		];

		expect(buildSessionQueue(cards, TODAY, { newLimit: 10, dailyStudyLimit: 3 })).toEqual({
			due: ["due-1", "due-2", "due-3"],
			learn: [],
			new: [],
			retry: [],
		});
	});

	it("UT-S17-QUEUE-DAILY-LIMIT-DUE-LEARN-NEW: Due -> Learn -> New の順に残枠まで構築する", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-1", reviewState: createState({ level: 1 }) },
			{ cardId: "due-1", reviewState: createState({ level: 2 }) },
			{ cardId: "learn-2", reviewState: createState({ level: 0 }) },
			{ cardId: "due-2", reviewState: createState({ level: 3 }) },
			{ cardId: "new-2", reviewState: null },
		];

		expect(buildSessionQueue(cards, TODAY, { newLimit: 10, dailyStudyLimit: 3 })).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1"],
			new: [],
			retry: [],
		});
	});

	it.each([
		{
			name: "daily 残枠のほうが小さい",
			limits: { newLimit: 4, dailyStudyLimit: 3 },
			expectedNew: ["new-1", "new-2", "new-3"],
		},
		{
			name: "new_limit_per_day のほうが小さい",
			limits: { newLimit: 2, dailyStudyLimit: 5 },
			expectedNew: ["new-1", "new-2"],
		},
	])("UT-S17-QUEUE-NEW-MIN-LIMIT: $name", ({ limits, expectedNew }) => {
		const cards: CardWithState[] = Array.from({ length: 10 }, (_, index) => ({
			cardId: `new-${index + 1}`,
			reviewState: null,
		}));

		expect(buildSessionQueue(cards, TODAY, limits).new).toEqual(expectedNew);
	});

	it.each([
		{ dailyStudyLimit: 1.9, expectedDue: ["due-1"] },
		{ dailyStudyLimit: -1, expectedDue: [] },
		{ dailyStudyLimit: Number.NaN, expectedDue: [] },
	])(
		"UT-S17-QUEUE-DAILY-LIMIT-NORMALIZE: dailyStudyLimit=$dailyStudyLimit",
		({ dailyStudyLimit, expectedDue }) => {
			const cards: CardWithState[] = [
				{ cardId: "due-1", reviewState: createState({ level: 2 }) },
				{ cardId: "due-2", reviewState: createState({ level: 3 }) },
			];

			expect(buildSessionQueue(cards, TODAY, { newLimit: 10, dailyStudyLimit }).due).toEqual(
				expectedDue
			);
		}
	);
});

describe("getNextCardId", () => {
	it.each([
		{
			name: "due が最優先",
			queue: createQueue({
				due: ["due-1"],
				learn: ["learn-1"],
				new: ["new-1"],
				retry: ["retry-1"],
			}),
			expected: { cardId: "due-1", source: "due" },
		},
		{
			name: "due が空なら learn",
			queue: createQueue({
				learn: ["learn-1"],
				new: ["new-1"],
				retry: ["retry-1"],
			}),
			expected: { cardId: "learn-1", source: "learn" },
		},
		{
			name: "due/learn が空なら new",
			queue: createQueue({
				new: ["new-1"],
				retry: ["retry-1"],
			}),
			expected: { cardId: "new-1", source: "new" },
		},
		{
			name: "due/learn/new が空なら retry",
			queue: createQueue({
				retry: ["retry-1"],
			}),
			expected: { cardId: "retry-1", source: "retry" },
		},
		{
			name: "全キュー空なら null を返す",
			queue: createQueue(),
			expected: { cardId: null, source: null },
		},
	])("UT-AC19-NEXTCARD-PRIORITY: $name", ({ queue, expected }) => {
		expect(getNextCardId(queue)).toEqual(expected);
	});
});

describe("dequeueCard", () => {
	it("UT-AC20-DEQUEUE-IMMUTABLE-SINGLE-STEP: 指定キュー先頭のみを削除して入力を破壊しない", () => {
		const queue = createQueue({
			due: ["due-1", "due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		});

		const result = dequeueCard(queue, "due");

		expect(result).toEqual({
			due: ["due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		});
		expect(result).not.toBe(queue);
		expect(result.due).not.toBe(queue.due);
		expect(queue).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		});
	});

	it("UT-AC21-DEQUEUE-EMPTY-NOOP-NEW-REF: 空キュー指定時は内容 no-op かつ新規参照を返す", () => {
		const queue = createQueue({
			due: ["due-1"],
			learn: ["learn-1"],
		});

		const result = dequeueCard(queue, "retry");

		expect(result).toEqual(queue);
		expect(result).not.toBe(queue);
		expect(queue).toEqual({
			due: ["due-1"],
			learn: ["learn-1"],
			new: [],
			retry: [],
		});
	});
});

describe("addToRetryQueue", () => {
	it("UT-AC22-RETRY-APPEND-DUPLICATE: 重複IDを許容して retry 末尾へ追加する", () => {
		const queue = createQueue({
			retry: ["retry-1"],
		});

		const result = addToRetryQueue(queue, "retry-1");

		expect(result.retry).toEqual(["retry-1", "retry-1"]);
		expect(result).not.toBe(queue);
		expect(queue.retry).toEqual(["retry-1"]);
	});
});

describe("isSessionComplete", () => {
	it("UT-AC23-SESSION-COMPLETE-ONLY-WHEN-ALL-EMPTY: 4キュー全空時のみ true を返す", () => {
		expect(isSessionComplete(createQueue())).toBe(true);
		expect(isSessionComplete(createQueue({ due: ["due-1"] }))).toBe(false);
		expect(isSessionComplete(createQueue({ learn: ["learn-1"] }))).toBe(false);
		expect(isSessionComplete(createQueue({ new: ["new-1"] }))).toBe(false);
		expect(isSessionComplete(createQueue({ retry: ["retry-1"] }))).toBe(false);
	});
});
