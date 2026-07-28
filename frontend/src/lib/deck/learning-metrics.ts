import { addDaysJST, getJstDateForInstant } from "@/lib/date";

export type LearningMetricRating = "again" | "hard" | "good";

export type LearningMetricRatingBreakdown = Readonly<{
	total: number;
	again: number;
	hard: number;
	good: number;
	againRate: number | null;
	hardRate: number | null;
	goodRate: number | null;
}>;

export type LearningMetricDay = Readonly<{
	date: string;
	completedSessions: number;
	reviewedCards: number;
}>;

export type LearningMetricMnemonicTrend = Readonly<{
	withMnemonic: LearningMetricRatingBreakdown;
	withoutMnemonic: LearningMetricRatingBreakdown;
	comparable: boolean;
}>;

export type DeckLearningMetrics = Readonly<{
	contractVersion: 1;
	today: string;
	windowStart: string;
	windowEnd: string;
	activeDays: number;
	recentDays: readonly LearningMetricDay[];
	latestRatings: LearningMetricRatingBreakdown;
	mnemonicTrend: LearningMetricMnemonicTrend;
}>;

export type ReviewStateMetricRow = Readonly<{
	cardId: string;
	lastRating: string | null;
	lastReviewedAt: string | null;
}>;

export type StudySessionMetricRow = Readonly<{
	id: string;
	finishedAt: string | null;
}>;

export type CardMnemonicKeyRow = Readonly<{
	id: string;
	illustrationKey: string | null;
}>;

export type SummarizeDeckLearningMetricsInput = Readonly<{
	today: string;
	deckCardIds: readonly string[];
	reviewStates: readonly ReviewStateMetricRow[];
	studySessions: readonly StudySessionMetricRow[];
	cards: readonly CardMnemonicKeyRow[];
	approvedMnemonicKeys: readonly string[];
}>;

type WindowedReviewState = ReviewStateMetricRow &
	Readonly<{
		lastRating: LearningMetricRating;
		reviewedDate: string;
		reviewedTime: number;
	}>;

const RATING_VALUES: readonly LearningMetricRating[] = ["again", "hard", "good"];
const EMPTY_RATING_BREAKDOWN: LearningMetricRatingBreakdown = {
	total: 0,
	again: 0,
	hard: 0,
	good: 0,
	againRate: null,
	hardRate: null,
	goodRate: null,
};

export function buildRecentJstDateWindow(today: string, days = 7): readonly string[] {
	const normalizedDays = Math.max(0, Math.floor(days));
	return Array.from({ length: normalizedDays }, (_, index) =>
		addDaysJST(today, index - normalizedDays + 1)
	);
}

export function summarizeRatingBreakdown(
	rows: readonly Pick<ReviewStateMetricRow, "lastRating">[]
): LearningMetricRatingBreakdown {
	const counts = {
		again: 0,
		hard: 0,
		good: 0,
	};

	for (const row of rows) {
		if (isLearningMetricRating(row.lastRating)) {
			counts[row.lastRating] += 1;
		}
	}

	const total = counts.again + counts.hard + counts.good;
	if (total === 0) {
		return EMPTY_RATING_BREAKDOWN;
	}

	return {
		total,
		again: counts.again,
		hard: counts.hard,
		good: counts.good,
		againRate: percentage(counts.again, total),
		hardRate: percentage(counts.hard, total),
		goodRate: percentage(counts.good, total),
	};
}

export function summarizeDeckLearningMetrics(
	input: SummarizeDeckLearningMetricsInput
): DeckLearningMetrics {
	const recentDates = buildRecentJstDateWindow(input.today);
	const windowStart = recentDates[0] ?? input.today;
	const windowEnd = recentDates.at(-1) ?? input.today;
	const dateSet = new Set(recentDates);
	const deckCardIdSet = new Set(input.deckCardIds);
	const latestReviews = collectWindowedLatestReviews(input.reviewStates, deckCardIdSet, dateSet);
	const completedSessionsByDate = countCompletedSessionsByDate(input.studySessions, dateSet);
	const reviewedCardsByDate = countReviewedCardsByDate(latestReviews, dateSet);

	const recentDays = recentDates.map((date) => ({
		date,
		completedSessions: completedSessionsByDate.get(date) ?? 0,
		reviewedCards: reviewedCardsByDate.get(date) ?? 0,
	}));

	const latestRatings = summarizeRatingBreakdown(latestReviews);
	const mnemonicTrend = summarizeMnemonicTrend({
		latestReviews,
		deckCardIds: deckCardIdSet,
		cards: input.cards,
		approvedMnemonicKeys: input.approvedMnemonicKeys,
	});

	return {
		contractVersion: 1,
		today: input.today,
		windowStart,
		windowEnd,
		activeDays: recentDays.filter((day) => day.completedSessions > 0 || day.reviewedCards > 0)
			.length,
		recentDays,
		latestRatings,
		mnemonicTrend,
	};
}

function summarizeMnemonicTrend(input: {
	latestReviews: readonly WindowedReviewState[];
	deckCardIds: ReadonlySet<string>;
	cards: readonly CardMnemonicKeyRow[];
	approvedMnemonicKeys: readonly string[];
}): LearningMetricMnemonicTrend {
	const approvedKeySet = new Set(input.approvedMnemonicKeys);
	const cardsById = new Map(
		input.cards
			.filter((card) => input.deckCardIds.has(card.id))
			.map((card) => [card.id, card] as const)
	);
	const withMnemonic: WindowedReviewState[] = [];
	const withoutMnemonic: WindowedReviewState[] = [];

	for (const review of input.latestReviews) {
		const card = cardsById.get(review.cardId);
		if (card?.illustrationKey !== null && card?.illustrationKey !== undefined) {
			if (approvedKeySet.has(card.illustrationKey)) {
				withMnemonic.push(review);
				continue;
			}
		}
		withoutMnemonic.push(review);
	}

	const withBreakdown = summarizeRatingBreakdown(withMnemonic);
	const withoutBreakdown = summarizeRatingBreakdown(withoutMnemonic);

	return {
		withMnemonic: withBreakdown,
		withoutMnemonic: withoutBreakdown,
		comparable: withBreakdown.total > 0 && withoutBreakdown.total > 0,
	};
}

function collectWindowedLatestReviews(
	reviewStates: readonly ReviewStateMetricRow[],
	deckCardIdSet: ReadonlySet<string>,
	dateSet: ReadonlySet<string>
): readonly WindowedReviewState[] {
	const latestByCardId = new Map<string, WindowedReviewState>();

	for (const row of reviewStates) {
		if (!deckCardIdSet.has(row.cardId) || !isLearningMetricRating(row.lastRating)) {
			continue;
		}

		const reviewedAt = parseReviewedAt(row.lastReviewedAt);
		if (reviewedAt === null || !dateSet.has(reviewedAt.reviewedDate)) {
			continue;
		}

		const candidate: WindowedReviewState = {
			...row,
			lastRating: row.lastRating,
			reviewedDate: reviewedAt.reviewedDate,
			reviewedTime: reviewedAt.reviewedTime,
		};
		const current = latestByCardId.get(row.cardId);
		if (current === undefined || candidate.reviewedTime > current.reviewedTime) {
			latestByCardId.set(row.cardId, candidate);
		}
	}

	return [...latestByCardId.values()];
}

function countCompletedSessionsByDate(
	studySessions: readonly StudySessionMetricRow[],
	dateSet: ReadonlySet<string>
): Map<string, number> {
	const sessionsByDate = new Map<string, number>();

	for (const session of studySessions) {
		if (session.finishedAt === null) {
			continue;
		}

		const finishedDate = getJstDateForInstant(session.finishedAt);
		if (finishedDate === null || !dateSet.has(finishedDate)) {
			continue;
		}

		sessionsByDate.set(finishedDate, (sessionsByDate.get(finishedDate) ?? 0) + 1);
	}

	return sessionsByDate;
}

function countReviewedCardsByDate(
	reviewStates: readonly WindowedReviewState[],
	dateSet: ReadonlySet<string>
): Map<string, number> {
	const reviewedByDate = new Map<string, number>();

	for (const row of reviewStates) {
		if (!dateSet.has(row.reviewedDate)) {
			continue;
		}

		reviewedByDate.set(row.reviewedDate, (reviewedByDate.get(row.reviewedDate) ?? 0) + 1);
	}

	return reviewedByDate;
}

function parseReviewedAt(
	value: string | null
): Readonly<{ reviewedDate: string; reviewedTime: number }> | null {
	if (value === null) {
		return null;
	}

	const reviewedTime = new Date(value).getTime();
	if (Number.isNaN(reviewedTime)) {
		return null;
	}

	const reviewedDate = getJstDateForInstant(value);
	return reviewedDate === null ? null : { reviewedDate, reviewedTime };
}

function isLearningMetricRating(value: string | null): value is LearningMetricRating {
	return RATING_VALUES.some((rating) => rating === value);
}

function percentage(value: number, total: number): number {
	return Math.round((value / total) * 100);
}
