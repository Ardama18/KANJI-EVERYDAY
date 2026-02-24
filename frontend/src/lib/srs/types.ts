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
