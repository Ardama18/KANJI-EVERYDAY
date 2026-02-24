// S-05 E2Eテスト - Design Doc: srs-engine
// 生成日: 2026-02-24
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Design AC#1〜#24）:
// AC#1  -> E2E-AC01-CONSTANTS-EXPOSED
// AC#2  -> E2E-AC02-RATING-ENUM-CONTRACT
// AC#3  -> E2E-AC03-RATECARD-NOW-INJECTION
// AC#4  -> E2E-AC04-FIRST-GOOD-REVIEW-FLOW
// AC#5  -> E2E-AC05-HARD-REVIEW-FLOW
// AC#6  -> E2E-AC06-AGAIN-RETRY-FLOW
// AC#7  -> E2E-AC07-AGAIN-RETRY-LIMIT-FLOW
// AC#8  -> E2E-AC08-DAILY-RETRY-RESET-FLOW
// AC#9  -> E2E-AC09-FIRST-REVIEW-NULL-STATE
// AC#10 -> E2E-AC10-LEVEL-OUT-OF-RANGE-FLOW
// AC#11 -> E2E-AC11-INTERVAL-PREVIEW-UX-LABEL
// AC#12 -> E2E-AC12-NEW-CARD-CLASSIFICATION
// AC#13 -> E2E-AC13-LEARN-DUE-CLASSIFICATION
// AC#14 -> E2E-AC14-FUTURE-CARD-EXCLUSION
// AC#15 -> E2E-AC15-COUNT-EXCLUDES-NON-TODAY
// AC#16 -> E2E-AC16-SESSION-QUEUE-BOOTSTRAP
// AC#17 -> E2E-AC17-NEWLIMIT-BOUNDARY-BEHAVIOR
// AC#18 -> E2E-AC18-STABLE-ORDER-IN-SESSION
// AC#19 -> E2E-AC19-NEXT-CARD-SELECTION-PRIORITY
// AC#20 -> E2E-AC20-DEQUEUE-ONE-STEP-IMMUTABLE
// AC#21 -> E2E-AC21-DEQUEUE-EMPTY-NOOP
// AC#22 -> E2E-AC22-RETRY-DUPLICATE-APPEND
// AC#23 -> E2E-AC23-SESSION-COMPLETE-CHECK
// AC#24 -> E2E-AC24-JST-MIDNIGHT-BOUNDARY-FLOW

import { describe, expect, it } from "vitest"

import { addDaysJST, getTomorrowJST } from "../../../../frontend/src/lib/date"
import {
	GOOD_INTERVALS,
	HARD_INTERVALS,
	RETRY_TODAY_LIMIT,
	addToRetryQueue,
	buildSessionQueue,
	calculateRating,
	classifyCard,
	countByCategory,
	dequeueCard,
	getNextCardId,
	getIntervalPreview,
	isSessionComplete,
	type CardWithState,
	type Rating,
	type ReviewState,
	type SessionQueue,
} from "../../../../frontend/src/lib/srs"

const TODAY = "2026-02-24"
const NOW = "2026-02-24T10:00:00.000Z"

const createState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
	level: 0,
	dueDate: "2026-02-20",
	lastRating: null,
	retryTodayCount: 0,
	lastReviewedAt: "2026-02-24T00:00:00.000Z",
	...overrides,
})

const createQueue = (overrides: Partial<SessionQueue> = {}): SessionQueue => ({
	due: [],
	learn: [],
	new: [],
	retry: [],
	...overrides,
})

interface RateCardFlowInput {
	queue: SessionQueue
	state: ReviewState | null
	rating: Rating
	today?: string
	now?: string
}

const runRateCardFlow = ({
	queue,
	state,
	rating,
	today = TODAY,
	now = NOW,
}: RateCardFlowInput) => {
	const next = getNextCardId(queue)
	if (next.cardId === null || next.source === null) {
		throw new Error("queue is empty")
	}

	const ratingResult = calculateRating(state, rating, today, now)
	let nextQueue = dequeueCard(queue, next.source)
	if (ratingResult.addToRetryQueue) {
		nextQueue = addToRetryQueue(nextQueue, next.cardId)
	}

	return {
		next,
		ratingResult,
		nextQueue,
	}
}

describe("srs-engine E2Eテスト", () => {
	it("E2E-AC01: 固定テーブルがセッション導線で仕様値として参照される", () => {
		expect(GOOD_INTERVALS).toEqual([1, 3, 7, 14, 30, 60, 120])
		expect(HARD_INTERVALS).toEqual([1, 2, 4, 7, 14, 30, 60])
		expect(RETRY_TODAY_LIMIT).toBe(2)
	})

	it("E2E-AC02: Rating が 3 値のみで評価フローを構成する", () => {
		const ratingButtons: Rating[] = ["good", "hard", "again"]
		const toRating = (value: Rating): Rating => value

		expect(ratingButtons.map((value) => toRating(value))).toEqual(["good", "hard", "again"])
	})

	it("E2E-AC03: rateCard 相当導線で now 注入契約を満たす", () => {
		const rateAt = "2026-02-24T15:30:00.000Z"

		const result = calculateRating(createState(), "good", TODAY, rateAt)

		expect(calculateRating.length).toBe(4)
		expect(result.newState.lastReviewedAt).toBe(rateAt)
	})

	it("E2E-AC04: 初回 good 評価で翌日スケジュールと level1 遷移が反映される", () => {
		const flow = runRateCardFlow({
			queue: createQueue({ new: ["new-1"] }),
			state: null,
			rating: "good",
		})

		expect(flow.next).toEqual({ cardId: "new-1", source: "new" })
		expect(flow.ratingResult).toEqual({
			newState: {
				level: 1,
				dueDate: addDaysJST(TODAY, 1),
				lastRating: "good",
				retryTodayCount: 0,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		})
		expect(flow.nextQueue).toEqual(createQueue())
	})

	it("E2E-AC05: hard 評価で level据え置きの間隔更新を行う", () => {
		const flow = runRateCardFlow({
			queue: createQueue({ due: ["due-1"] }),
			state: createState({
				level: 2,
				retryTodayCount: 1,
				lastReviewedAt: "2026-02-24T02:00:00.000Z",
			}),
			rating: "hard",
		})

		expect(flow.next).toEqual({ cardId: "due-1", source: "due" })
		expect(flow.ratingResult).toEqual({
			newState: {
				level: 2,
				dueDate: addDaysJST(TODAY, 4),
				lastRating: "hard",
				retryTodayCount: 1,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		})
		expect(flow.nextQueue).toEqual(createQueue())
	})

	it("E2E-AC06: again 評価で再学習導線へ遷移し retry キューへ追加される", () => {
		const flow = runRateCardFlow({
			queue: createQueue({ due: ["due-1"] }),
			state: createState({
				level: 3,
			}),
			rating: "again",
		})

		expect(flow.next).toEqual({ cardId: "due-1", source: "due" })
		expect(flow.ratingResult).toEqual({
			newState: {
				level: 0,
				dueDate: getTomorrowJST(TODAY),
				lastRating: "again",
				retryTodayCount: 1,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: true,
		})
		expect(flow.nextQueue).toEqual(createQueue({ retry: ["due-1"] }))
	})

	it("E2E-AC07: retryTodayCount が上限を超えた時点で retry 追加を停止する", () => {
		const flow = runRateCardFlow({
			queue: createQueue({ due: ["due-1"] }),
			state: createState({
				retryTodayCount: RETRY_TODAY_LIMIT,
				lastReviewedAt: "2026-02-24T02:00:00.000Z",
			}),
			rating: "again",
		})

		expect(flow.ratingResult.newState.retryTodayCount).toBe(RETRY_TODAY_LIMIT + 1)
		expect(flow.ratingResult.addToRetryQueue).toBe(false)
		expect(flow.nextQueue).toEqual(createQueue())
	})

	it("E2E-AC08: JST 日付差分がある場合に retryTodayCount を 0 起点で再計算する", () => {
		const result = calculateRating(
			createState({
				level: 2,
				retryTodayCount: 2,
				lastReviewedAt: "2026-02-23T14:59:59.000Z",
			}),
			"again",
			TODAY,
			NOW,
		)

		expect(result.newState.retryTodayCount).toBe(1)
		expect(result.addToRetryQueue).toBe(true)
	})

	it("E2E-AC09: state=null の初回レビュー導線で level 基準計算を行う", () => {
		const result = calculateRating(null, "good", TODAY, NOW)

		expect(result).toEqual({
			newState: {
				level: 1,
				dueDate: addDaysJST(TODAY, 1),
				lastRating: "good",
				retryTodayCount: 0,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		})
	})

	it("E2E-AC10: 範囲外 level を clamp して評価処理を継続する", () => {
		const overMaxResult = calculateRating(createState({ level: 99 }), "good", TODAY, NOW)
		const underMinResult = calculateRating(createState({ level: -5 }), "hard", TODAY, NOW)

		expect(overMaxResult.newState.level).toBe(6)
		expect(overMaxResult.newState.dueDate).toBe(addDaysJST(TODAY, 120))
		expect(underMinResult.newState.level).toBe(0)
		expect(underMinResult.newState.dueDate).toBe(addDaysJST(TODAY, 1))
	})

	it("E2E-AC11: level2 の間隔プレビュー表示が仕様文言と一致する", () => {
		const preview = getIntervalPreview(createState({ level: 2 }))

		expect(preview).toEqual({
			good: { interval: 7, label: "7日後" },
			hard: { interval: 4, label: "4日後" },
			again: { label: "今日さいご + 明日" },
		})
	})

	it("E2E-AC12: null reviewState カードは new として分類される", () => {
		expect(classifyCard(null, TODAY)).toBe("new")
	})

	it("E2E-AC13: 期日到来カードが learn と due に正しく分岐される", () => {
		expect(classifyCard(createState({ level: 0, dueDate: TODAY }), TODAY)).toBe("learn")
		expect(classifyCard(createState({ level: 1, dueDate: TODAY }), TODAY)).toBe("learn")
		expect(classifyCard(createState({ level: 2, dueDate: TODAY }), TODAY)).toBe("due")
	})

	it("E2E-AC14: 未来期日カードが classifyCard で null になり対象外となる", () => {
		expect(classifyCard(createState({ level: 2, dueDate: "2026-02-25" }), TODAY)).toBeNull()
	})

	it("E2E-AC15: countByCategory が null 分類カードを集計から除外する", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-1", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-1", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "future-1", reviewState: createState({ level: 4, dueDate: "2026-03-01" }) },
		]

		expect(countByCategory(cards, TODAY)).toEqual({
			new: 1,
			learn: 1,
			due: 1,
		})
	})

	it("E2E-AC16: buildSessionQueue が初期キューを仕様どおり構築する", () => {
		const cards: CardWithState[] = [
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-1", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-1", reviewState: createState({ level: 3, dueDate: TODAY }) },
			{ cardId: "future-1", reviewState: createState({ level: 3, dueDate: "2026-02-25" }) },
			{ cardId: "new-2", reviewState: null },
		]

		expect(buildSessionQueue(cards, TODAY, 10)).toEqual({
			due: ["due-1"],
			learn: ["learn-1"],
			new: ["new-1", "new-2"],
			retry: [],
		})
	})

	it.each([
		{ newLimit: 1.9, expected: ["new-1"] },
		{ newLimit: -1, expected: [] },
		{ newLimit: Number.NaN, expected: [] },
	])(
		"E2E-AC17: newLimit=$newLimit 入力時に new キューが $expected へ正規化される",
		({ newLimit, expected }) => {
			const cards: CardWithState[] = [
				{ cardId: "new-1", reviewState: null },
				{ cardId: "new-2", reviewState: null },
			]

			expect(buildSessionQueue(cards, TODAY, newLimit).new).toEqual(expected)
		},
	)

	it("E2E-AC18: queue 構築後もカテゴリ内部の順序が安定している", () => {
		const cards: CardWithState[] = [
			{ cardId: "due-1", reviewState: createState({ level: 2, dueDate: TODAY }) },
			{ cardId: "learn-1", reviewState: createState({ level: 1, dueDate: TODAY }) },
			{ cardId: "due-2", reviewState: createState({ level: 4, dueDate: TODAY }) },
			{ cardId: "new-1", reviewState: null },
			{ cardId: "learn-2", reviewState: createState({ level: 0, dueDate: TODAY }) },
			{ cardId: "new-2", reviewState: null },
		]

		expect(buildSessionQueue(cards, TODAY, 10)).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1", "learn-2"],
			new: ["new-1", "new-2"],
			retry: [],
		})
	})

	it("E2E-AC19: getNextCardId が優先順に従ってカードを返す", () => {
		expect(
			getNextCardId(createQueue({
				due: ["due-1"],
				learn: ["learn-1"],
				new: ["new-1"],
				retry: ["retry-1"],
			})),
		).toEqual({ cardId: "due-1", source: "due" })

		expect(
			getNextCardId(createQueue({
				learn: ["learn-1"],
				new: ["new-1"],
				retry: ["retry-1"],
			})),
		).toEqual({ cardId: "learn-1", source: "learn" })

		expect(
			getNextCardId(createQueue({
				new: ["new-1"],
				retry: ["retry-1"],
			})),
		).toEqual({ cardId: "new-1", source: "new" })

		expect(
			getNextCardId(createQueue({
				retry: ["retry-1"],
			})),
		).toEqual({ cardId: "retry-1", source: "retry" })

		expect(getNextCardId(createQueue())).toEqual({ cardId: null, source: null })
	})

	it("E2E-AC20: dequeueCard が先頭1件のみ除去し不変性を維持する", () => {
		const input = createQueue({
			due: ["due-1", "due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		})

		const result = dequeueCard(input, "due")

		expect(result).toEqual({
			due: ["due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		})
		expect(result).not.toBe(input)
		expect(result.due).not.toBe(input.due)
		expect(input).toEqual({
			due: ["due-1", "due-2"],
			learn: ["learn-1"],
			new: ["new-1"],
			retry: ["retry-1"],
		})
	})

	it("E2E-AC21: dequeueCard は空キュー対象で no-op かつ新規参照を返す", () => {
		const input = createQueue({
			due: ["due-1"],
			learn: ["learn-1"],
		})

		const result = dequeueCard(input, "retry")

		expect(result).toEqual(input)
		expect(result).not.toBe(input)
	})

	it("E2E-AC22: addToRetryQueue が重複 cardId を許可して末尾追加する", () => {
		const input = createQueue({ retry: ["retry-1"] })

		const result = addToRetryQueue(input, "retry-1")

		expect(result.retry).toEqual(["retry-1", "retry-1"])
		expect(result).not.toBe(input)
		expect(input.retry).toEqual(["retry-1"])
	})

	it("E2E-AC23: isSessionComplete は4キュー全空でのみ true になる", () => {
		expect(isSessionComplete(createQueue())).toBe(true)
		expect(isSessionComplete(createQueue({ due: ["due-1"] }))).toBe(false)
		expect(isSessionComplete(createQueue({ learn: ["learn-1"] }))).toBe(false)
		expect(isSessionComplete(createQueue({ new: ["new-1"] }))).toBe(false)
		expect(isSessionComplete(createQueue({ retry: ["retry-1"] }))).toBe(false)
	})

	it("E2E-AC24: JST 00:00 跨ぎ条件で retryTodayCount が日次リセットされる", () => {
		const nextDay = "2026-02-25"
		const nextDayNow = "2026-02-25T01:00:00.000Z"
		const beforeMidnightJst = createState({
			retryTodayCount: 1,
			lastReviewedAt: "2026-02-24T14:59:59.000Z",
		})
		const midnightJst = createState({
			retryTodayCount: 1,
			lastReviewedAt: "2026-02-24T15:00:00.000Z",
		})

		const resetResult = calculateRating(beforeMidnightJst, "again", nextDay, nextDayNow)
		const carryOverResult = calculateRating(midnightJst, "again", nextDay, nextDayNow)

		expect(resetResult.newState.retryTodayCount).toBe(1)
		expect(carryOverResult.newState.retryTodayCount).toBe(2)
	})
})
