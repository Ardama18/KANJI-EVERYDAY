"use server";

import {
	type TriggerIllustrationGenerationResult,
	triggerIllustrationGeneration,
} from "@/actions/illustration-actions";
import {
	type IllustrationDisplayStatus,
	STUDY_SESSION_COMPLETE_MESSAGE,
	STUDY_SESSION_EMPTY_MESSAGE,
} from "@/actions/session-contracts";
import { getSignedUrl } from "@/lib/illustration/storage";
import {
	addToRetryQueue,
	buildSessionQueue,
	calculateRating,
	getIntervalPreview,
	getNextCardId,
	isSessionComplete,
} from "@/lib/srs";
import type { IntervalPreview, Rating, ReviewState, SessionQueue } from "@/lib/srs/types";
import { createServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { redirect } from "next/navigation";

import { getTodayJST } from "../lib/date";

const LOGIN_PATH = "/login";
const ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS = 3600;

export type { IllustrationDisplayStatus } from "@/actions/session-contracts";

type SupabaseClient = ReturnType<typeof createServerClient>;
type MutationError = { message: string } | null;
type MutationResult = Promise<{ error: MutationError }>;
type SingleIdResult = Promise<{ data: { id: string } | null; error: MutationError }>;

type StudySessionsMutationTable = {
	update: (values: Database["public"]["Tables"]["study_sessions"]["Update"]) => {
		eq: (column: string, value: string) => MutationResult;
	};
	insert: (values: Database["public"]["Tables"]["study_sessions"]["Insert"]) => {
		select: (columns: string) => {
			single: () => SingleIdResult;
		};
	};
};

type ReviewStatesMutationTable = {
	upsert: (
		values: Database["public"]["Tables"]["review_states"]["Insert"],
		options: { onConflict: string }
	) => MutationResult;
};

type DeckRow = Pick<
	Database["public"]["Tables"]["decks"]["Row"],
	"id" | "name" | "owner_user_id" | "new_limit_per_day"
>;

type CardRow = Pick<
	Database["public"]["Tables"]["cards"]["Row"],
	"id" | "skill" | "pattern" | "front_text" | "back_text" | "illustration_key"
>;

type StudySessionRow = Pick<
	Database["public"]["Tables"]["study_sessions"]["Row"],
	| "id"
	| "user_id"
	| "deck_id"
	| "queue_due"
	| "queue_learn"
	| "queue_new"
	| "queue_retry"
	| "current_card_id"
	| "revealed"
	| "created_at"
	| "finished_at"
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

type DeckCardWithReviewRows = {
	card_id: string;
	review_states: ReviewStateRow[] | ReviewStateRow | null;
};

type IllustrationRow = Pick<
	Database["public"]["Tables"]["illustrations"]["Row"],
	"status" | "storage_path"
>;

type GetSignedUrlFn = (storagePath: string, expiresIn: number) => Promise<string | null>;
type TriggerIllustrationGenerationFn = (
	cardId: string
) => Promise<TriggerIllustrationGenerationResult>;

export interface CardFrontData {
	sessionId: string;
	cardId: string;
	skill: "reading" | "writing";
	pattern: "R1" | "W1";
	frontText: string;
	progress: {
		current: number;
		total: number;
		remaining: number;
	};
}

export interface CardBackData {
	cardId: string;
	skill: "reading" | "writing";
	pattern: "R1" | "W1";
	frontText: string;
	backText: string;
	illustrationUrl: string | null;
	illustrationStatus: IllustrationDisplayStatus;
	intervalPreview: IntervalPreview;
}

export interface StudySummary {
	message: string;
	studiedUniqueCards: number;
}

export type StartStudySessionResult =
	| {
			status: "active";
			sessionId: string;
			deckId: string;
			deckName: string;
	  }
	| {
			status: "completed";
			deckId: string;
			deckName: string;
			summary: StudySummary;
	  };

export interface RateResult {
	nextCard: CardFrontData | null;
	summary?: StudySummary;
}

export type StudySessionState =
	| {
			deckId: string;
			deckName: string;
			phase: "front";
			card: CardFrontData;
	  }
	| {
			deckId: string;
			deckName: string;
			phase: "back";
			card: CardFrontData;
			backData: CardBackData;
	  }
	| {
			deckId: string;
			deckName: string;
			phase: "complete";
			summary: StudySummary;
	  };

const asReviewStateArray = (value: DeckCardWithReviewRows["review_states"]): ReviewStateRow[] => {
	if (Array.isArray(value)) {
		return value;
	}

	if (value === null) {
		return [];
	}

	return [value];
};

const parseQueuePart = (value: Json): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string");
};

type NormalizeIllustrationStateParams = {
	cardId: string;
	illustrationKey: string | null;
	illustration: IllustrationRow | null;
	allowTrigger?: boolean;
	getSignedUrlFn?: GetSignedUrlFn;
	triggerIllustrationGenerationFn?: TriggerIllustrationGenerationFn;
};

type NormalizedIllustrationState = Pick<CardBackData, "illustrationStatus" | "illustrationUrl">;

const pendingIllustrationState = (): NormalizedIllustrationState => ({
	illustrationStatus: "pending",
	illustrationUrl: null,
});

const normalizeReadyIllustration = async (
	illustration: IllustrationRow,
	getSignedUrlFn: GetSignedUrlFn
): Promise<NormalizedIllustrationState> => {
	if (!illustration.storage_path) {
		return pendingIllustrationState();
	}

	const signedUrl = await getSignedUrlFn(
		illustration.storage_path,
		ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS
	);
	if (!signedUrl) {
		return pendingIllustrationState();
	}

	return {
		illustrationStatus: "ready",
		illustrationUrl: signedUrl,
	};
};

export const normalizeIllustrationState = async (
	params: NormalizeIllustrationStateParams
): Promise<NormalizedIllustrationState> => {
	const {
		cardId,
		illustrationKey,
		illustration,
		allowTrigger = false,
		getSignedUrlFn = getSignedUrl,
		triggerIllustrationGenerationFn = triggerIllustrationGeneration,
	} = params;
	if (illustrationKey === null) {
		return {
			illustrationStatus: "none",
			illustrationUrl: null,
		};
	}

	if (illustration !== null) {
		if (illustration.status === "ready") {
			return normalizeReadyIllustration(illustration, getSignedUrlFn);
		}

		if (illustration.status === "pending") {
			return pendingIllustrationState();
		}

		if (illustration.status === "failed") {
			return {
				illustrationStatus: "failed",
				illustrationUrl: null,
			};
		}

		return pendingIllustrationState();
	}

	if (!allowTrigger) {
		return pendingIllustrationState();
	}

	try {
		const triggerResult = await triggerIllustrationGenerationFn(cardId);
		if (triggerResult.ok && triggerResult.started) {
			return {
				illustrationStatus: "generating",
				illustrationUrl: null,
			};
		}
	} catch (_error: unknown) {
		return pendingIllustrationState();
	}

	return pendingIllustrationState();
};

const queueFromSession = (session: StudySessionRow): SessionQueue => ({
	due: parseQueuePart(session.queue_due),
	learn: parseQueuePart(session.queue_learn),
	new: parseQueuePart(session.queue_new),
	retry: parseQueuePart(session.queue_retry),
});

const queueToSessionUpdate = (
	queue: SessionQueue
): Pick<
	Database["public"]["Tables"]["study_sessions"]["Update"],
	"queue_due" | "queue_learn" | "queue_new" | "queue_retry"
> => ({
	queue_due: queue.due,
	queue_learn: queue.learn,
	queue_new: queue.new,
	queue_retry: queue.retry,
});

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

const toSkill = (value: string): CardFrontData["skill"] => {
	if (value === "reading" || value === "writing") {
		return value;
	}

	throw new Error(`Unsupported card skill: ${value}`);
};

const toPattern = (value: string): CardFrontData["pattern"] => {
	if (value === "R1" || value === "W1") {
		return value;
	}

	throw new Error(`Unsupported card pattern: ${value}`);
};

const requireAuthenticatedUserId = async (supabase: SupabaseClient): Promise<string> => {
	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user) {
		redirect(LOGIN_PATH);
	}

	return data.user.id;
};

const requireOwnedDeck = async (
	supabase: SupabaseClient,
	deckId: string,
	userId: string
): Promise<DeckRow> => {
	const { data, error } = await supabase
		.from("decks")
		.select("id, name, owner_user_id, new_limit_per_day")
		.eq("id", deckId)
		.eq("owner_user_id", userId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch deck: ${error.message}`);
	}

	if (!data) {
		throw new Error("Deck not found");
	}

	return data as DeckRow;
};

const requireSessionOwner = async (
	supabase: SupabaseClient,
	sessionId: string,
	userId: string
): Promise<StudySessionRow> => {
	const { data, error } = await supabase
		.from("study_sessions")
		.select(
			"id, user_id, deck_id, queue_due, queue_learn, queue_new, queue_retry, current_card_id, revealed, created_at, finished_at"
		)
		.eq("id", sessionId)
		.eq("user_id", userId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch study session: ${error.message}`);
	}

	if (!data) {
		throw new Error("Session not found");
	}

	return data as StudySessionRow;
};

const fetchDeckCardsWithReviewStates = async (
	supabase: SupabaseClient,
	deckId: string
): Promise<DeckCardWithReviewRows[]> => {
	const { data, error } = await supabase
		.from("deck_cards")
		.select(
			"card_id, review_states!left(user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at)"
		)
		.eq("deck_id", deckId);

	if (error) {
		throw new Error(`Failed to fetch deck cards: ${error.message}`);
	}

	return (data ?? []) as DeckCardWithReviewRows[];
};

const fetchReviewStateForCard = async (
	supabase: SupabaseClient,
	userId: string,
	cardId: string
): Promise<ReviewState | null> => {
	const { data, error } = await supabase
		.from("review_states")
		.select("user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at")
		.eq("user_id", userId)
		.eq("card_id", cardId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch review state: ${error.message}`);
	}

	return toReviewState((data as ReviewStateRow | null) ?? null);
};

const fetchCardById = async (supabase: SupabaseClient, cardId: string): Promise<CardRow> => {
	const { data, error } = await supabase
		.from("cards")
		.select("id, skill, pattern, front_text, back_text, illustration_key")
		.eq("id", cardId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch card: ${error.message}`);
	}

	if (!data) {
		throw new Error("Card not found");
	}

	return data as CardRow;
};

const fetchLatestIllustrationByKey = async (
	supabase: SupabaseClient,
	userId: string,
	illustrationKey: string
): Promise<IllustrationRow | null> => {
	const { data, error } = await supabase
		.from("illustrations")
		.select("status, storage_path")
		.eq("owner_user_id", userId)
		.eq("illustration_key", illustrationKey)
		.order("updated_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch illustration: ${error.message}`);
	}

	return (data as IllustrationRow | null) ?? null;
};

const countRemainingUniqueCards = (queue: SessionQueue): number => {
	return new Set([...queue.due, ...queue.learn, ...queue.new]).size;
};

const countReviewedUniqueCards = async (
	supabase: SupabaseClient,
	userId: string,
	deckId: string,
	sessionStartedAt: string
): Promise<number> => {
	const rows = await fetchDeckCardsWithReviewStates(supabase, deckId);
	const startedAtMs = Date.parse(sessionStartedAt);
	const reviewedCardIds = new Set<string>();

	for (const row of rows) {
		const reviewState = asReviewStateArray(row.review_states).find(
			(item) => item.user_id === userId
		);
		if (!reviewState?.last_reviewed_at) {
			continue;
		}

		const reviewedAtMs = Date.parse(reviewState.last_reviewed_at);
		if (Number.isNaN(reviewedAtMs)) {
			continue;
		}

		if (reviewedAtMs >= startedAtMs) {
			reviewedCardIds.add(row.card_id);
		}
	}

	return reviewedCardIds.size;
};

const buildProgress = async (
	supabase: SupabaseClient,
	session: StudySessionRow,
	userId: string,
	queue: SessionQueue
): Promise<CardFrontData["progress"]> => {
	const remaining = countRemainingUniqueCards(queue);
	const reviewed = await countReviewedUniqueCards(
		supabase,
		userId,
		session.deck_id,
		session.created_at
	);
	const total = remaining + reviewed;
	const current = total === 0 ? 0 : Math.min(total, reviewed + 1);

	return {
		current,
		total,
		remaining,
	};
};

const buildSummary = async (
	supabase: SupabaseClient,
	userId: string,
	session: StudySessionRow,
	overrideMessage?: string
): Promise<StudySummary> => {
	const studiedUniqueCards = await countReviewedUniqueCards(
		supabase,
		userId,
		session.deck_id,
		session.created_at
	);

	return {
		message: overrideMessage ?? STUDY_SESSION_COMPLETE_MESSAGE,
		studiedUniqueCards,
	};
};

const toCardFrontData = (
	sessionId: string,
	card: CardRow,
	progress: CardFrontData["progress"]
): CardFrontData => {
	return {
		sessionId,
		cardId: card.id,
		skill: toSkill(card.skill),
		pattern: toPattern(card.pattern),
		frontText: card.front_text,
		progress,
	};
};

const toCardBackData = (
	card: CardRow,
	intervalPreview: IntervalPreview,
	illustrationState: NormalizedIllustrationState
): CardBackData => {
	return {
		cardId: card.id,
		skill: toSkill(card.skill),
		pattern: toPattern(card.pattern),
		frontText: card.front_text,
		backText: card.back_text,
		illustrationUrl: illustrationState.illustrationUrl,
		illustrationStatus: illustrationState.illustrationStatus,
		intervalPreview,
	};
};

type BuildCardBackDataParams = {
	supabase: SupabaseClient;
	userId: string;
	card: CardRow;
	reviewState: ReviewState | null;
	allowTrigger?: boolean;
};

const buildCardBackData = async (params: BuildCardBackDataParams): Promise<CardBackData> => {
	const { supabase, userId, card, reviewState, allowTrigger = true } = params;
	const illustration =
		card.illustration_key === null
			? null
			: await fetchLatestIllustrationByKey(supabase, userId, card.illustration_key);
	const illustrationState = await normalizeIllustrationState({
		cardId: card.id,
		illustrationKey: card.illustration_key,
		illustration,
		allowTrigger,
	});

	return toCardBackData(card, getIntervalPreview(reviewState), illustrationState);
};

const removeCardFromQueue = (
	queue: SessionQueue,
	cardId: string
): {
	nextQueue: SessionQueue;
	removed: boolean;
} => {
	const clone: SessionQueue = {
		due: [...queue.due],
		learn: [...queue.learn],
		new: [...queue.new],
		retry: [...queue.retry],
	};

	for (const source of ["due", "learn", "new", "retry"] as const) {
		const index = clone[source].indexOf(cardId);
		if (index >= 0) {
			clone[source].splice(index, 1);
			return { nextQueue: clone, removed: true };
		}
	}

	return { nextQueue: clone, removed: false };
};

const fetchActiveSession = async (
	supabase: SupabaseClient,
	userId: string,
	deckId: string
): Promise<StudySessionRow | null> => {
	const { data, error } = await supabase
		.from("study_sessions")
		.select(
			"id, user_id, deck_id, queue_due, queue_learn, queue_new, queue_retry, current_card_id, revealed, created_at, finished_at"
		)
		.eq("user_id", userId)
		.eq("deck_id", deckId)
		.is("finished_at", null)
		.order("created_at", { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch active session: ${error.message}`);
	}

	return (data as StudySessionRow | null) ?? null;
};

const markSessionFinished = async (
	supabase: SupabaseClient,
	sessionId: string,
	finishedAt: string
): Promise<void> => {
	const table = supabase.from("study_sessions") as unknown as StudySessionsMutationTable;
	const { error } = await table.update({ finished_at: finishedAt }).eq("id", sessionId);

	if (error) {
		throw new Error(`Failed to finish study session: ${error.message}`);
	}
};

const updateStudySession = async (
	supabase: SupabaseClient,
	sessionId: string,
	values: Database["public"]["Tables"]["study_sessions"]["Update"]
): Promise<void> => {
	const table = supabase.from("study_sessions") as unknown as StudySessionsMutationTable;
	const { error } = await table.update(values).eq("id", sessionId);
	if (error) {
		throw new Error(`Failed to update study session: ${error.message}`);
	}
};

const insertStudySession = async (
	supabase: SupabaseClient,
	values: Database["public"]["Tables"]["study_sessions"]["Insert"]
): Promise<{ id: string }> => {
	const table = supabase.from("study_sessions") as unknown as StudySessionsMutationTable;
	const { data, error } = await table.insert(values).select("id").single();
	if (error || !data) {
		throw new Error(`Failed to create study session: ${error?.message ?? "unknown error"}`);
	}

	return data as { id: string };
};

const upsertReviewState = async (
	supabase: SupabaseClient,
	values: Database["public"]["Tables"]["review_states"]["Insert"]
): Promise<void> => {
	const table = supabase.from("review_states") as unknown as ReviewStatesMutationTable;
	const { error } = await table.upsert(values, {
		onConflict: "user_id,card_id",
	});
	if (error) {
		throw new Error(`Failed to save review state: ${error.message}`);
	}
};

export async function startStudySession(deckId: string): Promise<StartStudySessionResult> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const deck = await requireOwnedDeck(supabase, deckId, userId);

	const activeSession = await fetchActiveSession(supabase, userId, deck.id);
	if (activeSession) {
		const activeQueue = queueFromSession(activeSession);
		if (
			activeSession.current_card_id === null &&
			isSessionComplete(activeQueue) &&
			activeSession.finished_at === null
		) {
			const now = new Date().toISOString();
			await markSessionFinished(supabase, activeSession.id, now);

			return {
				status: "completed",
				deckId: deck.id,
				deckName: deck.name,
				summary: await buildSummary(supabase, userId, activeSession),
			};
		}

		return {
			status: "active",
			sessionId: activeSession.id,
			deckId: deck.id,
			deckName: deck.name,
		};
	}

	const today = getTodayJST();
	const deckCardRows = await fetchDeckCardsWithReviewStates(supabase, deck.id);
	const queue = buildSessionQueue(
		deckCardRows.map((row) => ({
			cardId: row.card_id,
			reviewState:
				toReviewState(
					asReviewStateArray(row.review_states).find((item) => item.user_id === userId) ?? null
				) ?? null,
		})),
		today,
		deck.new_limit_per_day
	);

	if (isSessionComplete(queue)) {
		return {
			status: "completed",
			deckId: deck.id,
			deckName: deck.name,
			summary: {
				message: STUDY_SESSION_EMPTY_MESSAGE,
				studiedUniqueCards: 0,
			},
		};
	}

	const data = await insertStudySession(supabase, {
		user_id: userId,
		deck_id: deck.id,
		...queueToSessionUpdate(queue),
		current_card_id: null,
		revealed: false,
	});

	return {
		status: "active",
		sessionId: data.id,
		deckId: deck.id,
		deckName: deck.name,
	};
}

export async function getNextCard(sessionId: string): Promise<CardFrontData | null> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const session = await requireSessionOwner(supabase, sessionId, userId);

	if (session.finished_at) {
		return null;
	}

	const queue = queueFromSession(session);
	const { cardId } = getNextCardId(queue);

	if (cardId === null) {
		await markSessionFinished(supabase, session.id, new Date().toISOString());
		return null;
	}

	const card = await fetchCardById(supabase, cardId);
	const progress = await buildProgress(supabase, session, userId, queue);

	await updateStudySession(supabase, session.id, {
		current_card_id: cardId,
		revealed: false,
	});

	return toCardFrontData(session.id, card, progress);
}

export async function revealCard(sessionId: string): Promise<CardBackData> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const session = await requireSessionOwner(supabase, sessionId, userId);

	if (session.finished_at) {
		throw new Error("Session is already finished");
	}

	if (session.current_card_id === null) {
		throw new Error("No current card");
	}

	if (session.revealed) {
		throw new Error("Card is already revealed");
	}

	await updateStudySession(supabase, session.id, {
		revealed: true,
	});

	const card = await fetchCardById(supabase, session.current_card_id);
	const reviewState = await fetchReviewStateForCard(supabase, userId, card.id);

	return buildCardBackData({
		supabase,
		userId,
		card,
		reviewState,
		allowTrigger: true,
	});
}

export async function rateCard(sessionId: string, rating: Rating): Promise<RateResult> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const session = await requireSessionOwner(supabase, sessionId, userId);

	if (session.finished_at) {
		return {
			nextCard: null,
			summary: await buildSummary(supabase, userId, session),
		};
	}

	if (session.current_card_id === null || !session.revealed) {
		throw new Error("Current card is not ready for rating");
	}

	const currentCardId = session.current_card_id;
	const queue = queueFromSession(session);
	const { nextQueue } = removeCardFromQueue(queue, currentCardId);
	const reviewState = await fetchReviewStateForCard(supabase, userId, currentCardId);

	const today = getTodayJST();
	const now = new Date().toISOString();
	const ratingResult = calculateRating(reviewState, rating, today, now);

	const updatedQueue = ratingResult.addToRetryQueue
		? addToRetryQueue(nextQueue, currentCardId)
		: nextQueue;

	await upsertReviewState(supabase, {
		user_id: userId,
		card_id: currentCardId,
		level: ratingResult.newState.level,
		due_date: ratingResult.newState.dueDate,
		last_rating: ratingResult.newState.lastRating,
		retry_today_count: ratingResult.newState.retryTodayCount,
		last_reviewed_at: ratingResult.newState.lastReviewedAt,
	});

	const next = getNextCardId(updatedQueue);
	if (next.cardId === null) {
		const finishedAt = new Date().toISOString();
		await updateStudySession(supabase, session.id, {
			...queueToSessionUpdate(updatedQueue),
			current_card_id: null,
			revealed: false,
			finished_at: finishedAt,
		});

		const finishedSession = await requireSessionOwner(supabase, session.id, userId);
		return {
			nextCard: null,
			summary: await buildSummary(supabase, userId, finishedSession),
		};
	}

	await updateStudySession(supabase, session.id, {
		...queueToSessionUpdate(updatedQueue),
		current_card_id: null,
		revealed: false,
		finished_at: null,
	});

	return {
		nextCard: await getNextCard(session.id),
	};
}

export async function getStudySessionState(sessionId: string): Promise<StudySessionState> {
	const supabase = createServerClient();
	const userId = await requireAuthenticatedUserId(supabase);
	const session = await requireSessionOwner(supabase, sessionId, userId);
	const deck = await requireOwnedDeck(supabase, session.deck_id, userId);

	if (session.finished_at) {
		return {
			deckId: deck.id,
			deckName: deck.name,
			phase: "complete",
			summary: await buildSummary(supabase, userId, session),
		};
	}

	if (session.current_card_id === null) {
		const nextCard = await getNextCard(session.id);
		if (nextCard === null) {
			const finishedSession = await requireSessionOwner(supabase, session.id, userId);
			return {
				deckId: deck.id,
				deckName: deck.name,
				phase: "complete",
				summary: await buildSummary(supabase, userId, finishedSession),
			};
		}

		return {
			deckId: deck.id,
			deckName: deck.name,
			phase: "front",
			card: nextCard,
		};
	}

	const card = await fetchCardById(supabase, session.current_card_id);
	const progress = await buildProgress(supabase, session, userId, queueFromSession(session));
	const frontCard = toCardFrontData(session.id, card, progress);

	if (!session.revealed) {
		return {
			deckId: deck.id,
			deckName: deck.name,
			phase: "front",
			card: frontCard,
		};
	}

	const reviewState = await fetchReviewStateForCard(supabase, userId, card.id);
	const backData = await buildCardBackData({
		supabase,
		userId,
		card,
		reviewState,
		allowTrigger: true,
	});

	return {
		deckId: deck.id,
		deckName: deck.name,
		phase: "back",
		card: frontCard,
		backData,
	};
}
