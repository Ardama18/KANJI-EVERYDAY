import { addDaysJST, getTomorrowJST } from "../date";
import { GOOD_INTERVALS, HARD_INTERVALS, MAX_GOOD_LEVEL, RETRY_TODAY_LIMIT } from "./constants";
import type { Rating, RatingResult, ReviewState } from "./types";

const clampLevel = (level: number): number => {
	return Math.min(Math.max(level, 0), MAX_GOOD_LEVEL);
};

const getBaseRetryTodayCount = (state: ReviewState | null): number => {
	return state?.retryTodayCount ?? 0;
};

export function calculateRating(
	state: ReviewState | null,
	rating: Rating,
	today: string,
	now: string,
): RatingResult {
	const normalizedLevel = clampLevel(state?.level ?? 0);
	const baseRetryTodayCount = getBaseRetryTodayCount(state);

	switch (rating) {
		case "good": {
			const nextLevel = clampLevel(normalizedLevel + 1);
			return {
				newState: {
					level: nextLevel,
					dueDate: addDaysJST(today, GOOD_INTERVALS[normalizedLevel]),
					lastRating: "good",
					retryTodayCount: baseRetryTodayCount,
					lastReviewedAt: now,
				},
				addToRetryQueue: false,
			};
		}
		case "hard":
			return {
				newState: {
					level: normalizedLevel,
					dueDate: addDaysJST(today, HARD_INTERVALS[normalizedLevel]),
					lastRating: "hard",
					retryTodayCount: baseRetryTodayCount,
					lastReviewedAt: now,
				},
				addToRetryQueue: false,
			};
		case "again": {
			const retryTodayCount = baseRetryTodayCount + 1;
			return {
				newState: {
					level: 0,
					dueDate: getTomorrowJST(today),
					lastRating: "again",
					retryTodayCount,
					lastReviewedAt: now,
				},
				addToRetryQueue: retryTodayCount <= RETRY_TODAY_LIMIT,
			};
		}
	}
}
