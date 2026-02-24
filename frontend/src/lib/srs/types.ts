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
