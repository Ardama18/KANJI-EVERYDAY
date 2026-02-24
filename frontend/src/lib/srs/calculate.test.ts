import { describe, expect, it } from "vitest";

import { addDaysJST, getTomorrowJST } from "../date";
import { RETRY_TODAY_LIMIT } from "./constants";
import { calculateRating } from "./calculate";
import type { ReviewState } from "./types";

const TODAY = "2026-02-24";
const NOW = "2026-02-24T10:00:00.000Z";

const createState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
	level: 0,
	dueDate: "2026-02-20",
	lastRating: null,
	retryTodayCount: 0,
	lastReviewedAt: "2026-02-24T00:00:00.000Z",
	...overrides,
});

describe("calculateRating", () => {
	it("UT-AC03-CALCULATE-SIGNATURE-NOW: 4引数契約とnow注入を維持する", () => {
		const result = calculateRating(createState(), "good", TODAY, NOW);

		expect(calculateRating.length).toBe(4);
		expect(result.newState.lastReviewedAt).toBe(NOW);
	});

	it("UT-AC04-GOOD-L0-TO-L1: level0 good で翌日設定とlevel上昇を行う", () => {
		const result = calculateRating(createState({ level: 0 }), "good", TODAY, NOW);

		expect(result).toEqual({
			newState: {
				level: 1,
				dueDate: addDaysJST(TODAY, 1),
				lastRating: "good",
				retryTodayCount: 0,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		});
	});

	it("UT-AC05-HARD-LEVEL-HOLD: level2 hard でlevelとretryTodayCountを維持する", () => {
		const state = createState({
			level: 2,
			retryTodayCount: 1,
			lastReviewedAt: "2026-02-24T01:00:00.000Z",
		});
		const result = calculateRating(state, "hard", TODAY, NOW);

		expect(result).toEqual({
			newState: {
				level: 2,
				dueDate: addDaysJST(TODAY, 4),
				lastRating: "hard",
				retryTodayCount: 1,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		});
	});

	it("UT-AC06-AGAIN-RESET-RETRY: level3 again でlevelを0に戻しretryを加算する", () => {
		const state = createState({
			level: 3,
			retryTodayCount: 0,
			lastReviewedAt: "2026-02-24T01:00:00.000Z",
		});
		const result = calculateRating(state, "again", TODAY, NOW);

		expect(result).toEqual({
			newState: {
				level: 0,
				dueDate: getTomorrowJST(TODAY),
				lastRating: "again",
				retryTodayCount: 1,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: true,
		});
	});

	it("UT-AC07-AGAIN-RETRY-LIMIT: againで上限超過時にretry追加を停止する", () => {
		const state = createState({
			level: 0,
			retryTodayCount: RETRY_TODAY_LIMIT,
			lastReviewedAt: "2026-02-24T02:00:00.000Z",
		});
		const result = calculateRating(state, "again", TODAY, NOW);

		expect(result.newState.retryTodayCount).toBe(RETRY_TODAY_LIMIT + 1);
		expect(result.addToRetryQueue).toBe(false);
	});

	it("UT-AC09-INITIAL-STATE-NULL: state=null を初回レビューとして扱う", () => {
		const result = calculateRating(null, "good", TODAY, NOW);

		expect(result).toEqual({
			newState: {
				level: 1,
				dueDate: addDaysJST(TODAY, 1),
				lastRating: "good",
				retryTodayCount: 0,
				lastReviewedAt: NOW,
			},
			addToRetryQueue: false,
		});
	});

	it("UT-AC10-LEVEL-CLAMP: level範囲外入力をclampして計算継続する", () => {
		const overMaxResult = calculateRating(createState({ level: 99 }), "good", TODAY, NOW);
		const underMinResult = calculateRating(createState({ level: -5 }), "hard", TODAY, NOW);

		expect(overMaxResult.newState.level).toBe(6);
		expect(overMaxResult.newState.dueDate).toBe(addDaysJST(TODAY, 120));
		expect(underMinResult.newState.level).toBe(0);
		expect(underMinResult.newState.dueDate).toBe(addDaysJST(TODAY, 1));
	});

	it("UT-IMMUTABLE-INPUT: 入力stateを破壊せず新規参照を返す", () => {
		const state = createState({
			level: 2,
			retryTodayCount: 1,
			dueDate: "2026-02-22",
		});
		const stateSnapshot: ReviewState = { ...state };
		const result = calculateRating(state, "good", TODAY, NOW);

		expect(result.newState).not.toBe(state);
		expect(state).toEqual(stateSnapshot);
	});
});
