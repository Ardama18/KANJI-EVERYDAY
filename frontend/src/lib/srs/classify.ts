import type {
	CardCategory,
	CardWithState,
	CategoryCounts,
	DeckStudySummary,
	ReviewState,
} from "./types";

const isDueTodayOrPast = (reviewState: ReviewState, today: string): boolean =>
	reviewState.dueDate <= today;

const isLearnLevel = (reviewState: ReviewState): boolean => reviewState.level <= 1;

export function classifyCard(reviewState: ReviewState | null, today: string): CardCategory | null {
	if (reviewState === null) {
		return "new";
	}

	if (!isDueTodayOrPast(reviewState, today)) {
		return null;
	}

	return isLearnLevel(reviewState) ? "learn" : "due";
}

export function countByCategory(cards: readonly CardWithState[], today: string): CategoryCounts {
	return cards.reduce<CategoryCounts>(
		(counts, card) => {
			const category = classifyCard(card.reviewState, today);
			if (category !== null) {
				counts[category] += 1;
			}
			return counts;
		},
		{
			new: 0,
			learn: 0,
			due: 0,
		}
	);
}

// 表示専用の read-only 集計。`due_date` は DB の date 型で常に `YYYY-MM-DD` のため文字列比較で足りる。
export function findNextDueDate(cards: readonly CardWithState[], today: string): string | null {
	return cards.reduce<string | null>((earliestDueDate, card) => {
		const reviewState = card.reviewState;
		if (reviewState === null || reviewState.dueDate <= today) {
			return earliestDueDate;
		}

		if (earliestDueDate === null || reviewState.dueDate < earliestDueDate) {
			return reviewState.dueDate;
		}

		return earliestDueDate;
	}, null);
}

export function summarizeDeckStudyState(
	cards: readonly CardWithState[],
	today: string
): DeckStudySummary {
	return cards.reduce<DeckStudySummary>(
		(summary, card) => {
			summary.totalCards += 1;
			if (card.reviewState !== null) {
				summary.learnedCards += 1;
				if (card.reviewState.dueDate > today) {
					summary.scheduledCards += 1;
				}
			}
			return summary;
		},
		{
			totalCards: 0,
			learnedCards: 0,
			scheduledCards: 0,
		}
	);
}
