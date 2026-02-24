"use server";

import { countByCategory } from "@/lib/srs";
import type { CardWithState, ReviewState } from "@/lib/srs/types";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { redirect } from "next/navigation";

import { getTodayJST } from "../lib/date";

const LOGIN_PATH = "/login";

type DeckRow = Pick<
	Database["public"]["Tables"]["decks"]["Row"],
	"id" | "name" | "new_limit_per_day"
>;

type ReviewStateRow = Pick<
	Database["public"]["Tables"]["review_states"]["Row"],
	"user_id" | "level" | "due_date" | "last_rating" | "retry_today_count" | "last_reviewed_at"
>;

type DeckCardQueryRow = {
	deck_id: string;
	card_id: string;
	review_states: ReviewStateRow[] | ReviewStateRow | null;
};

export interface DeckCounts {
	new: number;
	learn: number;
	due: number;
}

export interface DeckWithCounts {
	id: string;
	name: string;
	counts: DeckCounts;
}

export interface DeckOverview {
	id: string;
	name: string;
	newLimitPerDay: number;
	counts: DeckCounts & {
		total: number;
	};
}

const asReviewStateArray = (value: DeckCardQueryRow["review_states"]): ReviewStateRow[] => {
	if (Array.isArray(value)) {
		return value;
	}

	if (value === null) {
		return [];
	}

	return [value];
};

const toReviewState = (value: ReviewStateRow | null): ReviewState | null => {
	if (value === null) {
		return null;
	}

	return {
		level: value.level,
		dueDate: value.due_date,
		lastRating: value.last_rating as ReviewState["lastRating"],
		retryTodayCount: value.retry_today_count,
		lastReviewedAt: value.last_reviewed_at,
	};
};

const requireAuthenticatedUserId = async (
	supabase: ReturnType<typeof createServerClient>
): Promise<string> => {
	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user) {
		redirect(LOGIN_PATH);
	}

	return data.user.id;
};

const fetchDeckCardRows = async (
	supabase: ReturnType<typeof createServerClient>,
	deckIds: string[]
): Promise<DeckCardQueryRow[]> => {
	if (deckIds.length === 0) {
		return [];
	}

	const { data, error } = await supabase
		.from("deck_cards")
		.select(
			"deck_id, card_id, review_states!left(user_id, level, due_date, last_rating, retry_today_count, last_reviewed_at)"
		)
		.in("deck_id", deckIds);

	if (error) {
		throw new Error(`Failed to fetch deck cards: ${error.message}`);
	}

	return (data ?? []) as DeckCardQueryRow[];
};

const buildCardsByDeck = (
	rows: readonly DeckCardQueryRow[],
	deckIds: readonly string[],
	userId: string
): Map<string, CardWithState[]> => {
	const cardsByDeck = new Map<string, CardWithState[]>();
	for (const deckId of deckIds) {
		cardsByDeck.set(deckId, []);
	}

	for (const row of rows) {
		const reviewState = toReviewState(
			asReviewStateArray(row.review_states).find((item) => item.user_id === userId) ?? null
		);
		const cards = cardsByDeck.get(row.deck_id);
		if (cards) {
			cards.push({
				cardId: row.card_id,
				reviewState,
			});
		}
	}

	return cardsByDeck;
};

const fetchOwnedDecks = async (
	supabase: ReturnType<typeof createServerClient>,
	userId: string
): Promise<DeckRow[]> => {
	const { data, error } = await supabase
		.from("decks")
		.select("id, name, new_limit_per_day")
		.eq("owner_user_id", userId)
		.order("created_at", { ascending: true });

	if (error) {
		throw new Error(`Failed to fetch decks: ${error.message}`);
	}

	return (data ?? []) as DeckRow[];
};

export async function getDecksWithCounts(): Promise<DeckWithCounts[]> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const decks = await fetchOwnedDecks(supabase, userId);
	if (decks.length === 0) {
		return [];
	}

	const deckIds = decks.map((deck) => deck.id);
	const deckCardRows = await fetchDeckCardRows(supabase, deckIds);
	const cardsByDeck = buildCardsByDeck(deckCardRows, deckIds, userId);
	const today = getTodayJST();

	return decks.map((deck) => ({
		id: deck.id,
		name: deck.name,
		counts: countByCategory(cardsByDeck.get(deck.id) ?? [], today),
	}));
}

export async function getDeckOverview(deckId: string): Promise<DeckOverview | null> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const { data: rawDeck, error } = await supabase
		.from("decks")
		.select("id, name, new_limit_per_day")
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.maybeSingle();
	const deck = rawDeck as DeckRow | null;

	if (error) {
		throw new Error(`Failed to fetch deck overview: ${error.message}`);
	}

	if (!deck) {
		return null;
	}

	const deckCardRows = await fetchDeckCardRows(supabase, [deck.id]);
	const cardsByDeck = buildCardsByDeck(deckCardRows, [deck.id], userId);
	const today = getTodayJST();
	const counts = countByCategory(cardsByDeck.get(deck.id) ?? [], today);

	return {
		id: deck.id,
		name: deck.name,
		newLimitPerDay: deck.new_limit_per_day,
		counts: {
			...counts,
			total: counts.new + counts.learn + counts.due,
		},
	};
}
