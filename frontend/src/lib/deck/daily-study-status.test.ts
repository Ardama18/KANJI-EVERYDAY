import { describe, expect, it, vi } from "vitest";

import {
	aggregateDailyStudyStatuses,
	getDailyStudyStatusForActor,
} from "@/lib/deck/daily-study-status";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111" };
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const DECK_DONE = "33333333-3333-4333-8333-333333333333";
const DECK_LIMIT = "44444444-4444-4444-8444-444444444444";
const DECK_TODO = "55555555-5555-4555-8555-555555555555";
const DECK_EMPTY = "66666666-6666-4666-8666-666666666666";
const CARD_DONE = "77777777-7777-4777-8777-777777777777";
const CARD_LIMIT = "88888888-8888-4888-8888-888888888888";
const CARD_TODO = "99999999-9999-4999-8999-999999999999";
const TODAY = "2026-07-26";
const NOW = new Date("2026-07-25T15:30:00.000Z");

type DbError = Readonly<{ message: string }>;
type DeckRow = Readonly<{ id: string; daily_study_limit: number }>;
type DeckCardRow = Readonly<{ deck_id: string; card_id: string }>;
type ReviewStateRow = Readonly<{
	user_id: string;
	card_id: string;
	level: number;
	due_date: string;
	last_rating: string | null;
	retry_today_count: number;
	last_reviewed_at: string | null;
}>;

function reviewState(cardId: string, overrides: Partial<ReviewStateRow> = {}): ReviewStateRow {
	return {
		user_id: ACTOR.userId,
		card_id: cardId,
		level: 2,
		due_date: "2026-07-27",
		last_rating: "good",
		retry_today_count: 0,
		last_reviewed_at: null,
		...overrides,
	};
}

function dailyClient(
	fixture: Readonly<{
		decks?: readonly DeckRow[];
		deckCards?: readonly DeckCardRow[];
		reviewStates?: readonly ReviewStateRow[];
		deckError?: DbError | null;
		deckCardsError?: DbError | null;
		reviewStatesError?: DbError | null;
	}>
) {
	const tableCalls: string[] = [];
	const deckDeletedAtIs = vi.fn(async (_column: string, _value: null) => ({
		data: fixture.decks ?? [],
		error: fixture.deckError ?? null,
	}));
	const deckEq = vi.fn((_column: string, _value: string) => ({ is: deckDeletedAtIs }));
	const deckCardsIn = vi.fn(async (_column: string, _values: readonly string[]) => ({
		data: fixture.deckCards ?? [],
		error: fixture.deckCardsError ?? null,
	}));
	const reviewStatesIn = vi.fn(async (_column: string, _values: readonly string[]) => ({
		data: fixture.reviewStates ?? [],
		error: fixture.reviewStatesError ?? null,
	}));
	const reviewStatesEq = vi.fn((_column: string, _value: string) => ({ in: reviewStatesIn }));
	const from = vi.fn((table: string) => {
		tableCalls.push(table);
		switch (table) {
			case "decks":
				return { select: vi.fn(() => ({ eq: deckEq })) };
			case "deck_cards":
				return { select: vi.fn(() => ({ in: deckCardsIn })) };
			case "review_states":
				return { select: vi.fn(() => ({ eq: reviewStatesEq })) };
			default:
				throw new Error(`unexpected table: ${table}`);
		}
	});

	return {
		client: { from } as never,
		tableCalls,
		deckEq,
		deckDeletedAtIs,
		deckCardsIn,
		reviewStatesEq,
		reviewStatesIn,
	};
}

describe("aggregateDailyStudyStatuses", () => {
	it("returns NO_ELIGIBLE_DECKS when every deck has no cards", () => {
		expect(aggregateDailyStudyStatuses(TODAY, ["no-cards"])).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "NO_ELIGIBLE_DECKS",
			completed: false,
		});
	});

	it("returns IN_PROGRESS when one eligible deck still has todo work", () => {
		expect(aggregateDailyStudyStatuses(TODAY, ["done", "todo", "limit-reached"])).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "IN_PROGRESS",
			completed: false,
		});
	});

	it("treats done and limit-reached eligible decks as completed", () => {
		expect(aggregateDailyStudyStatuses(TODAY, ["no-cards", "done", "limit-reached"])).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "COMPLETED",
			completed: true,
		});
	});
});

describe("getDailyStudyStatusForActor", () => {
	it("short-circuits after the owned deck query when the actor has no decks", async () => {
		const fixture = dailyClient({ decks: [] });

		const result = await getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW });

		expect(result).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "NO_ELIGIBLE_DECKS",
			completed: false,
		});
		expect(fixture.tableCalls).toEqual(["decks"]);
		expect(fixture.deckEq).toHaveBeenCalledWith("owner_user_id", ACTOR.userId);
	});

	it("short-circuits after deck_cards when every owned deck is empty", async () => {
		const fixture = dailyClient({
			decks: [{ id: DECK_EMPTY, daily_study_limit: 5 }],
			deckCards: [],
		});

		const result = await getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW });

		expect(result.state).toBe("NO_ELIGIBLE_DECKS");
		expect(result.completed).toBe(false);
		expect(fixture.tableCalls).toEqual(["decks", "deck_cards"]);
		expect(fixture.deckCardsIn).toHaveBeenCalledWith("deck_id", [DECK_EMPTY]);
		expect(fixture.reviewStatesIn).not.toHaveBeenCalled();
	});

	it("returns IN_PROGRESS when one eligible actor-owned deck is todo", async () => {
		const fixture = dailyClient({
			decks: [
				{ id: DECK_DONE, daily_study_limit: 5 },
				{ id: DECK_TODO, daily_study_limit: 5 },
			],
			deckCards: [
				{ deck_id: DECK_DONE, card_id: CARD_DONE },
				{ deck_id: DECK_TODO, card_id: CARD_TODO },
			],
			reviewStates: [
				reviewState(CARD_DONE, { due_date: "2026-07-27" }),
				reviewState(CARD_TODO, { due_date: TODAY }),
				reviewState(CARD_TODO, { user_id: OTHER_USER_ID, due_date: "2026-07-27" }),
			],
		});

		const result = await getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW });

		expect(result).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "IN_PROGRESS",
			completed: false,
		});
		expect(fixture.tableCalls).toEqual(["decks", "deck_cards", "review_states"]);
		expect(fixture.reviewStatesEq).toHaveBeenCalledWith("user_id", ACTOR.userId);
		expect(fixture.reviewStatesIn).toHaveBeenCalledWith("card_id", [CARD_DONE, CARD_TODO]);
		expect(Object.keys(result)).toEqual(["contractVersion", "date", "state", "completed"]);
	});

	it("returns COMPLETED when all eligible decks are done or limit-reached", async () => {
		const fixture = dailyClient({
			decks: [
				{ id: DECK_DONE, daily_study_limit: 5 },
				{ id: DECK_LIMIT, daily_study_limit: 1 },
				{ id: DECK_EMPTY, daily_study_limit: 5 },
			],
			deckCards: [
				{ deck_id: DECK_DONE, card_id: CARD_DONE },
				{ deck_id: DECK_LIMIT, card_id: CARD_LIMIT },
			],
			reviewStates: [
				reviewState(CARD_DONE, { due_date: "2026-07-27" }),
				reviewState(CARD_LIMIT, {
					due_date: TODAY,
					last_reviewed_at: "2026-07-25T15:00:00.000Z",
				}),
			],
		});

		const result = await getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW });

		expect(result).toEqual({
			contractVersion: 1,
			date: TODAY,
			state: "COMPLETED",
			completed: true,
		});
	});

	it("throws sanitized errors so the MCP wrapper can return INTERNAL_ERROR", async () => {
		const fixture = dailyClient({
			decks: [],
			deckError: { message: "SQL token secret raw database detail" },
		});

		await expect(getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW })).rejects.toThrow(
			"Failed to fetch daily study decks"
		);
		await expect(
			getDailyStudyStatusForActor(fixture.client, ACTOR, { now: NOW })
		).rejects.not.toThrow("secret");
	});
});
