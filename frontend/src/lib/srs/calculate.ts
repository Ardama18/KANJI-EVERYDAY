import { addDaysJST, getTodayJST, getTomorrowJST } from "../date";
import { GOOD_INTERVALS, HARD_INTERVALS, MAX_GOOD_LEVEL, RETRY_TODAY_LIMIT } from "./constants";
import type { IntervalPreview, Rating, RatingResult, ReviewState } from "./types";

const clampLevel = (level: number): number => {
	return Math.min(Math.max(level, 0), MAX_GOOD_LEVEL);
};

const toJstDateFromIsoText = (isoText: string | null): string | null => {
	if (!isoText) {
		return null;
	}

	const date = new Date(isoText);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return getTodayJST(date);
};

const isSameJstDate = (isoText: string | null, targetJstDate: string): boolean => {
	return toJstDateFromIsoText(isoText) === targetJstDate;
};

const getBaseRetryTodayCount = (state: ReviewState | null, today: string): number => {
	if (!state) {
		return 0;
	}

	if (!isSameJstDate(state.lastReviewedAt, today)) {
		return 0;
	}

	return state.retryTodayCount;
};

export function calculateRating(
	state: ReviewState | null,
	rating: Rating,
	today: string,
	now: string
): RatingResult {
	const normalizedLevel = clampLevel(state?.level ?? 0);
	const baseRetryTodayCount = getBaseRetryTodayCount(state, today);

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

export function getIntervalPreview(state: ReviewState | null): IntervalPreview {
	const normalizedLevel = clampLevel(state?.level ?? 0);
	const goodInterval = GOOD_INTERVALS[normalizedLevel];
	const hardInterval = HARD_INTERVALS[normalizedLevel];

	return {
		good: { interval: goodInterval, label: `${goodInterval}日後` },
		hard: { interval: hardInterval, label: `${hardInterval}日後` },
		again: { label: "今日さいご + 明日" },
	};
}
