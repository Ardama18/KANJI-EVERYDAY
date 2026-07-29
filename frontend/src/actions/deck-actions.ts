"use server";

import { countByCategory, findNextDueDate, summarizeDeckStudyState } from "@/lib/srs";
import type { CardWithState, ReviewState } from "@/lib/srs/types";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getJstDateForInstant, getTodayJST } from "../lib/date";
import {
	type DeckLearningMetrics,
	summarizeDeckLearningMetrics,
} from "../lib/deck/learning-metrics";
import {
	type DeckActionState,
	type DeckDeleteActionState,
	type DeckStudyLimitActionState,
	normalizeDeckNameInput,
} from "./deck-action-types";

const LOGIN_PATH = "/login";
const GENERIC_DECK_DELETE_ERROR_MESSAGE =
	"デッキを削除できませんでした。時間をおいて再度お試しください。";
const ACTIVE_DECK_DELETE_ERROR_MESSAGE =
	"学習中のデッキは削除できません。学習を終えてからもう一度お試しください。";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeckRow = Pick<
	Database["public"]["Tables"]["decks"]["Row"],
	"id" | "name" | "new_limit_per_day" | "daily_study_limit"
>;

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

type DeckCardQueryRow = {
	deck_id: string;
	card_id: string;
	review_states: ReviewStateRow[] | ReviewStateRow | null;
};

type StudySessionMetricQueryRow = Pick<
	Database["public"]["Tables"]["study_sessions"]["Row"],
	"id" | "finished_at"
>;

type CardMetricQueryRow = Pick<
	Database["public"]["Tables"]["cards"]["Row"],
	"id" | "illustration_key"
>;

type CardMnemonicMetricQueryRow = Pick<
	Database["public"]["Tables"]["card_mnemonics"]["Row"],
	"illustration_key" | "status"
>;

type DeckDeleteTable = {
	update: (values: Database["public"]["Tables"]["decks"]["Update"]) => {
		eq: (
			column: string,
			value: string
		) => {
			eq: (
				column: string,
				value: string
			) => {
				is: (
					column: string,
					value: null
				) => {
					select: (columns: string) => {
						maybeSingle: () => Promise<{
							data: Pick<Database["public"]["Tables"]["decks"]["Row"], "id"> | null;
							error: { code?: string; message: string } | null;
						}>;
					};
				};
				select: (columns: string) => {
					maybeSingle: () => Promise<{
						data: Pick<Database["public"]["Tables"]["decks"]["Row"], "id"> | null;
						error: { code?: string; message: string } | null;
					}>;
				};
			};
		};
	};
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
	totalCards: number;
	learnedCards: number;
	scheduledCards: number;
	dailyStudyLimit: number;
	studiedToday: number;
	nextDueDate: string | null;
}

export interface DeckOverview {
	id: string;
	name: string;
	newLimitPerDay: number;
	dailyStudyLimit: number;
	studiedToday: number;
	remainingToday: number;
	counts: DeckCounts & {
		total: number;
	};
	totalCards: number;
	learnedCards: number;
	scheduledCards: number;
	nextDueDate: string | null;
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

const countCardsReviewedOnJstDate = (
	cards: readonly CardWithState[],
	targetDate: string
): number => {
	const reviewedCardIds = new Set<string>();
	for (const card of cards) {
		const reviewedAt = card.reviewState?.lastReviewedAt;
		if (!reviewedAt) {
			continue;
		}

		if (getJstDateForInstant(reviewedAt) === targetDate) {
			reviewedCardIds.add(card.cardId);
		}
	}

	return reviewedCardIds.size;
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

export async function createDeck(
	previousState: DeckActionState,
	formData: FormData
): Promise<DeckActionState> {
	void previousState;

	const validation = normalizeDeckNameInput(formData.get("name"));
	if (!validation.ok) {
		return { status: "error", message: validation.message };
	}

	const supabase = createServerClient();
	const { data: authData, error: authError } = await supabase.auth.getUser();
	if (authError || !authData.user) {
		return { status: "error", message: "ログインが必要です。" };
	}

	const { data, error } = await supabase
		.from("decks")
		.insert({ owner_user_id: authData.user.id, name: validation.name })
		.select("id, name")
		.single();

	if (error || !isCreatedDeckRow(data)) {
		return {
			status: "error",
			message: "デッキを作成できませんでした。時間をおいて再度お試しください。",
		};
	}

	revalidatePath("/decks");

	return {
		status: "success",
		message: "デッキを作成しました。",
		deck: { id: data.id, name: data.name },
	};
}

function isCreatedDeckRow(value: unknown): value is Readonly<{ id: string; name: string }> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { id?: unknown }).id === "string" &&
		typeof (value as { name?: unknown }).name === "string"
	);
}

const normalizeDeckIdInput = (value: unknown): string | null => {
	if (typeof value !== "string") {
		return null;
	}

	const deckId = value.trim();
	return UUID_PATTERN.test(deckId) ? deckId : null;
};

const isActiveDeckDeleteError = (error: { code?: string; message: string } | null): boolean =>
	error?.code === "P1007";

export async function deleteDeck(
	previousState: DeckDeleteActionState,
	formData: FormData
): Promise<DeckDeleteActionState> {
	void previousState;

	const deckId = normalizeDeckIdInput(formData.get("deckId"));
	if (deckId === null) {
		return { status: "error", message: GENERIC_DECK_DELETE_ERROR_MESSAGE };
	}

	const supabase = createServerClient();
	const { data: authData, error: authError } = await supabase.auth.getUser();
	if (authError || !authData.user) {
		return { status: "error", message: "ログインが必要です。" };
	}
	const userId = authData.user.id;

	const { data: deck, error: deckError } = await supabase
		.from("decks")
		.select("id")
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.is("deleted_at", null)
		.maybeSingle();

	if (deckError || deck === null) {
		return { status: "error", message: GENERIC_DECK_DELETE_ERROR_MESSAGE };
	}

	const { data: activeSessions, error: activeSessionError } = await supabase
		.from("study_sessions")
		.select("id")
		.eq("user_id", userId)
		.eq("deck_id", deckId)
		.is("finished_at", null)
		.limit(1);

	if (activeSessionError) {
		return { status: "error", message: GENERIC_DECK_DELETE_ERROR_MESSAGE };
	}

	if ((activeSessions ?? []).length > 0) {
		return { status: "error", message: ACTIVE_DECK_DELETE_ERROR_MESSAGE };
	}

	const table = supabase.from("decks") as unknown as DeckDeleteTable;
	const { data: deletedDeck, error: deleteError } = await table
		.update({ deleted_at: new Date().toISOString() })
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.is("deleted_at", null)
		.select("id")
		.maybeSingle();

	if (isActiveDeckDeleteError(deleteError)) {
		return { status: "error", message: ACTIVE_DECK_DELETE_ERROR_MESSAGE };
	}

	if (deleteError || deletedDeck === null) {
		return { status: "error", message: GENERIC_DECK_DELETE_ERROR_MESSAGE };
	}

	revalidatePath("/decks");

	return { status: "success", message: "デッキを削除しました。" };
}

const fetchDeckCardRows = async (
	supabase: ReturnType<typeof createServerClient>,
	deckIds: string[],
	userId: string
): Promise<DeckCardQueryRow[]> => {
	if (deckIds.length === 0) {
		return [];
	}

	const { data, error } = await supabase
		.from("deck_cards")
		.select("deck_id, card_id")
		.in("deck_id", deckIds);

	if (error) {
		throw new Error(`Failed to fetch deck cards: ${error.message}`);
	}

	const deckCards = (data ?? []) as Pick<DeckCardQueryRow, "deck_id" | "card_id">[];
	const cardIds = [...new Set(deckCards.map((row) => row.card_id))];
	if (cardIds.length === 0) {
		return [];
	}

	const { data: reviewData, error: reviewError } = await supabase
		.from("review_states")
		.select("user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at")
		.eq("user_id", userId)
		.in("card_id", cardIds);

	if (reviewError) {
		throw new Error(`Failed to fetch review states: ${reviewError.message}`);
	}

	const reviewStatesByCardId = new Map(
		((reviewData ?? []) as ReviewStateRow[]).map((row) => [row.card_id, row] as const)
	);

	return deckCards.map((row) => ({
		...row,
		review_states: reviewStatesByCardId.get(row.card_id) ?? null,
	}));
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
		.select("id, name, new_limit_per_day, daily_study_limit")
		.eq("owner_user_id", userId)
		.is("deleted_at", null)
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
	const deckCardRows = await fetchDeckCardRows(supabase, deckIds, userId);
	const cardsByDeck = buildCardsByDeck(deckCardRows, deckIds, userId);
	const today = getTodayJST();

	// 追加クエリを作らず、取得済みカードから studiedToday / nextDueDate を再集計する（NFR-01）。
	return decks.map((deck) => {
		const cards = cardsByDeck.get(deck.id) ?? [];

		return {
			id: deck.id,
			name: deck.name,
			counts: countByCategory(cards, today),
			...summarizeDeckStudyState(cards, today),
			dailyStudyLimit: deck.daily_study_limit,
			studiedToday: countCardsReviewedOnJstDate(cards, today),
			nextDueDate: findNextDueDate(cards, today),
		};
	});
}

export async function getDeckOverview(deckId: string): Promise<DeckOverview | null> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const { data: rawDeck, error } = await supabase
		.from("decks")
		.select("id, name, new_limit_per_day, daily_study_limit")
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.is("deleted_at", null)
		.maybeSingle();
	const deck = rawDeck as DeckRow | null;

	if (error) {
		throw new Error(`Failed to fetch deck overview: ${error.message}`);
	}

	if (!deck) {
		return null;
	}

	const deckCardRows = await fetchDeckCardRows(supabase, [deck.id], userId);
	const cardsByDeck = buildCardsByDeck(deckCardRows, [deck.id], userId);
	const today = getTodayJST();
	const cards = cardsByDeck.get(deck.id) ?? [];
	const counts = countByCategory(cards, today);
	const summary = summarizeDeckStudyState(cards, today);
	const studiedToday = countCardsReviewedOnJstDate(cards, today);

	return {
		id: deck.id,
		name: deck.name,
		newLimitPerDay: deck.new_limit_per_day,
		dailyStudyLimit: deck.daily_study_limit,
		studiedToday,
		remainingToday: Math.max(0, deck.daily_study_limit - studiedToday),
		counts: {
			...counts,
			total: counts.new + counts.learn + counts.due,
		},
		...summary,
		nextDueDate: findNextDueDate(cards, today),
	};
}

export async function getDeckLearningMetrics(deckId: string): Promise<DeckLearningMetrics | null> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const today = getTodayJST();
	const { data: rawDeck, error: deckError } = await supabase
		.from("decks")
		.select("id")
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.is("deleted_at", null)
		.maybeSingle();
	const deck = rawDeck as Pick<DeckRow, "id"> | null;

	if (deckError) {
		throwLearningMetricsFetchError();
	}

	if (!deck) {
		return null;
	}

	const { data: deckCardData, error: deckCardError } = await supabase
		.from("deck_cards")
		.select("deck_id, card_id")
		.eq("deck_id", deck.id);

	if (deckCardError) {
		throwLearningMetricsFetchError();
	}

	const deckCards = (deckCardData ?? []) as Pick<DeckCardQueryRow, "deck_id" | "card_id">[];
	const cardIds = [...new Set(deckCards.map((row) => row.card_id))];
	if (cardIds.length === 0) {
		return summarizeDeckLearningMetrics({
			today,
			deckCardIds: [],
			reviewStates: [],
			studySessions: [],
			cards: [],
			approvedMnemonicKeys: [],
		});
	}

	const { data: reviewData, error: reviewError } = await supabase
		.from("review_states")
		.select("user_id, card_id, last_rating, last_reviewed_at")
		.eq("user_id", userId)
		.in("card_id", cardIds);

	if (reviewError) {
		throwLearningMetricsFetchError();
	}

	const { data: sessionData, error: sessionError } = await supabase
		.from("study_sessions")
		.select("id, finished_at")
		.eq("user_id", userId)
		.eq("deck_id", deck.id);

	if (sessionError) {
		throwLearningMetricsFetchError();
	}

	const { data: cardData, error: cardError } = await supabase
		.from("cards")
		.select("id, illustration_key")
		.eq("owner_user_id", userId)
		.in("id", cardIds);

	if (cardError) {
		throwLearningMetricsFetchError();
	}

	const cards = (cardData ?? []) as CardMetricQueryRow[];
	const illustrationKeys = [
		...new Set(
			cards
				.map((card) => card.illustration_key)
				.filter((key): key is string => typeof key === "string" && key.length > 0)
		),
	];
	const approvedMnemonicKeys =
		illustrationKeys.length === 0
			? []
			: await fetchApprovedMnemonicKeys(supabase, userId, illustrationKeys);

	return summarizeDeckLearningMetrics({
		today,
		deckCardIds: cardIds,
		reviewStates: (
			(reviewData ?? []) as Pick<ReviewStateRow, "card_id" | "last_rating" | "last_reviewed_at">[]
		).map((row) => ({
			cardId: row.card_id,
			lastRating: row.last_rating,
			lastReviewedAt: row.last_reviewed_at,
		})),
		studySessions: ((sessionData ?? []) as StudySessionMetricQueryRow[]).map((row) => ({
			id: row.id,
			finishedAt: row.finished_at,
		})),
		cards: cards.map((row) => ({
			id: row.id,
			illustrationKey: row.illustration_key,
		})),
		approvedMnemonicKeys,
	});
}

async function fetchApprovedMnemonicKeys(
	supabase: ReturnType<typeof createServerClient>,
	userId: string,
	illustrationKeys: readonly string[]
): Promise<string[]> {
	const { data, error } = await supabase
		.from("card_mnemonics")
		.select("illustration_key, status")
		.eq("owner_user_id", userId)
		.eq("status", "approved")
		.in("illustration_key", illustrationKeys);

	if (error) {
		throwLearningMetricsFetchError();
	}

	return ((data ?? []) as CardMnemonicMetricQueryRow[])
		.filter((row) => row.status === "approved")
		.map((row) => row.illustration_key);
}

function throwLearningMetricsFetchError(): never {
	throw new Error("Failed to fetch deck learning metrics");
}

const parseDailyStudyLimitInput = (value: unknown): number | null => {
	if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
		return null;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		return null;
	}

	return parsed;
};

type DeckStudyLimitUpdateTable = {
	update: (values: Database["public"]["Tables"]["decks"]["Update"]) => {
		eq: (
			column: string,
			value: string
		) => {
			eq: (
				column: string,
				value: string
			) => {
				is: (
					column: string,
					value: null
				) => {
					select: (columns: string) => {
						maybeSingle: () => Promise<{
							data: Pick<Database["public"]["Tables"]["decks"]["Row"], "id"> | null;
							error: { message: string } | null;
						}>;
					};
				};
				select: (columns: string) => {
					maybeSingle: () => Promise<{
						data: Pick<Database["public"]["Tables"]["decks"]["Row"], "id"> | null;
						error: { message: string } | null;
					}>;
				};
			};
		};
	};
};

export async function updateDeckStudyLimit(
	previousState: DeckStudyLimitActionState,
	formData: FormData
): Promise<DeckStudyLimitActionState> {
	void previousState;

	const deckId = formData.get("deckId");
	if (typeof deckId !== "string" || deckId.trim().length === 0) {
		return { status: "error", message: "デッキを確認できませんでした。" };
	}
	const normalizedDeckId = deckId.trim();

	const dailyStudyLimit = parseDailyStudyLimitInput(formData.get("dailyStudyLimit"));
	if (dailyStudyLimit === null) {
		return { status: "error", message: "一日最大枚数は1〜100の整数で入力してください。" };
	}

	const supabase = createServerClient();
	const { data: authData, error: authError } = await supabase.auth.getUser();
	if (authError || !authData.user) {
		return { status: "error", message: "ログインが必要です。" };
	}

	const table = supabase.from("decks") as unknown as DeckStudyLimitUpdateTable;
	const { data, error } = await table
		.update({ daily_study_limit: dailyStudyLimit })
		.eq("id", normalizedDeckId)
		.eq("owner_user_id", authData.user.id)
		.is("deleted_at", null)
		.select("id")
		.maybeSingle();

	if (error || data === null) {
		return {
			status: "error",
			message: "一日最大枚数を保存できませんでした。時間をおいて再度お試しください。",
		};
	}

	revalidatePath("/decks");
	revalidatePath(`/decks/${normalizedDeckId}`);

	return { status: "success", message: "一日最大枚数を保存しました。" };
}
