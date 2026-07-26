import { getJstDateForInstant, getTodayJST } from "@/lib/date";
import { type DeckStudyStatusKind, resolveDeckStudyStatus } from "@/lib/deck/study-status";
import { countByCategory, findNextDueDate, summarizeDeckStudyState } from "@/lib/srs";
import type { CardWithState, ReviewState } from "@/lib/srs/types";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type DailyStudyStatusState = "NO_ELIGIBLE_DECKS" | "IN_PROGRESS" | "COMPLETED";

export type DailyStudyStatusData = Readonly<{
	contractVersion: 1;
	date: string;
	state: DailyStudyStatusState;
	completed: boolean;
}>;

type DeckRow = Pick<Database["public"]["Tables"]["decks"]["Row"], "id" | "daily_study_limit">;

type DeckCardRow = Pick<Database["public"]["Tables"]["deck_cards"]["Row"], "deck_id" | "card_id">;

type ReviewStateRow = Pick<
	Database["public"]["Tables"]["review_states"]["Row"],
	| "user_id"
	| "card_id"
	| "level"
	| "due_date"
	| "last_rating"
	| "retry_today_count"
	| "last_reviewed_at"
>;

export function aggregateDailyStudyStatuses(
	date: string,
	deckStatuses: readonly DeckStudyStatusKind[]
): DailyStudyStatusData {
	const eligibleStatuses = deckStatuses.filter((status) => status !== "no-cards");
	if (eligibleStatuses.length === 0) {
		return {
			contractVersion: 1,
			date,
			state: "NO_ELIGIBLE_DECKS",
			completed: false,
		};
	}

	if (eligibleStatuses.some((status) => status === "todo")) {
		return {
			contractVersion: 1,
			date,
			state: "IN_PROGRESS",
			completed: false,
		};
	}

	return {
		contractVersion: 1,
		date,
		state: "COMPLETED",
		completed: true,
	};
}

export async function getDailyStudyStatusForActor(
	client: JwtScopedSupabaseClient,
	actor: Readonly<{ userId: string }>,
	options: Readonly<{ now?: Date }> = {}
): Promise<DailyStudyStatusData> {
	const today = getTodayJST(options.now);
	const decks = await fetchOwnedDecks(client, actor.userId);
	if (decks.length === 0) return aggregateDailyStudyStatuses(today, []);

	const deckIds = decks.map((deck) => deck.id);
	const deckCards = await fetchDeckCards(client, deckIds);
	if (deckCards.length === 0) return aggregateDailyStudyStatuses(today, []);

	const uniqueCardIds = [...new Set(deckCards.map((row) => row.card_id))];
	const reviewStates = await fetchActorReviewStates(client, actor.userId, uniqueCardIds);
	const cardsByDeck = buildCardsByDeck(deckIds, deckCards, reviewStates, actor.userId);
	const deckStatuses = decks.map((deck) =>
		resolveStatusForDeck(cardsByDeck.get(deck.id) ?? [], deck.daily_study_limit, today)
	);

	return aggregateDailyStudyStatuses(today, deckStatuses);
}

async function fetchOwnedDecks(
	client: JwtScopedSupabaseClient,
	userId: string
): Promise<DeckRow[]> {
	const { data, error } = await client
		.from("decks")
		.select("id,daily_study_limit")
		.eq("owner_user_id", userId);
	if (error !== null || !Array.isArray(data)) throw new Error("Failed to fetch daily study decks");
	return data as DeckRow[];
}

async function fetchDeckCards(
	client: JwtScopedSupabaseClient,
	deckIds: readonly string[]
): Promise<DeckCardRow[]> {
	const { data, error } = await client
		.from("deck_cards")
		.select("deck_id,card_id")
		.in("deck_id", deckIds);
	if (error !== null || !Array.isArray(data))
		throw new Error("Failed to fetch daily study deck cards");
	return data as DeckCardRow[];
}

async function fetchActorReviewStates(
	client: JwtScopedSupabaseClient,
	userId: string,
	cardIds: readonly string[]
): Promise<ReviewStateRow[]> {
	const { data, error } = await client
		.from("review_states")
		.select("user_id,card_id,level,due_date,last_rating,retry_today_count,last_reviewed_at")
		.eq("user_id", userId)
		.in("card_id", cardIds);
	if (error !== null || !Array.isArray(data))
		throw new Error("Failed to fetch daily study review states");
	return data as ReviewStateRow[];
}

function buildCardsByDeck(
	deckIds: readonly string[],
	deckCards: readonly DeckCardRow[],
	reviewStates: readonly ReviewStateRow[],
	userId: string
): Map<string, CardWithState[]> {
	const cardsByDeck = new Map<string, CardWithState[]>();
	for (const deckId of deckIds) cardsByDeck.set(deckId, []);

	const reviewStatesByCardId = new Map(
		reviewStates
			.filter((row) => row.user_id === userId)
			.map((row) => [row.card_id, toReviewState(row)] as const)
	);

	for (const row of deckCards) {
		const cards = cardsByDeck.get(row.deck_id);
		if (cards === undefined) continue;
		cards.push({
			cardId: row.card_id,
			reviewState: reviewStatesByCardId.get(row.card_id) ?? null,
		});
	}

	return cardsByDeck;
}

function resolveStatusForDeck(
	cards: readonly CardWithState[],
	dailyStudyLimit: number,
	today: string
): DeckStudyStatusKind {
	const counts = countByCategory(cards, today);
	const summary = summarizeDeckStudyState(cards, today);
	return resolveDeckStudyStatus({
		totalCards: summary.totalCards,
		todayCount: counts.new + counts.learn + counts.due,
		studiedToday: countCardsReviewedOnJstDate(cards, today),
		dailyStudyLimit,
		nextDueDate: findNextDueDate(cards, today),
		today,
	}).kind;
}

function countCardsReviewedOnJstDate(cards: readonly CardWithState[], targetDate: string): number {
	const reviewedCardIds = new Set<string>();
	for (const card of cards) {
		const reviewedAt = card.reviewState?.lastReviewedAt;
		if (reviewedAt !== null && reviewedAt !== undefined) {
			if (getJstDateForInstant(reviewedAt) === targetDate) reviewedCardIds.add(card.cardId);
		}
	}
	return reviewedCardIds.size;
}

function toReviewState(value: ReviewStateRow): ReviewState {
	return {
		level: value.level,
		dueDate: value.due_date,
		lastRating: value.last_rating as ReviewState["lastRating"],
		retryTodayCount: value.retry_today_count,
		lastReviewedAt: value.last_reviewed_at,
	};
}
