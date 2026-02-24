export type Rating = "good" | "hard" | "again";

export interface ReviewState {
	level: number;
	dueDate: string;
	lastRating: Rating | null;
	retryTodayCount: number;
	lastReviewedAt: string | null;
}

export interface RatingResult {
	newState: ReviewState;
	addToRetryQueue: boolean;
}

export interface IntervalPreview {
	good: {
		interval: number;
		label: string;
	};
	hard: {
		interval: number;
		label: string;
	};
	again: {
		label: string;
	};
}

export type CardCategory = "new" | "learn" | "due";

export interface CardWithState {
	cardId: string;
	reviewState: ReviewState | null;
}

export interface CategoryCounts {
	new: number;
	learn: number;
	due: number;
}
