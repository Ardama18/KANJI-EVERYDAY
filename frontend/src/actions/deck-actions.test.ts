import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

import { getDeckOverview, getDecksWithCounts } from "./deck-actions";

class RedirectSignal extends Error {
	constructor(public readonly location: string) {
		super("NEXT_REDIRECT");
	}
}

type DeckRow = {
	id: string;
	name: string;
	new_limit_per_day: number;
};

type ReviewStateRow = {
	user_id: string;
	card_id: string;
	level: number;
	due_date: string;
	last_rating: "good" | "hard" | "again" | null;
	retry_today_count: number;
	last_reviewed_at: string | null;
};

type DeckCardRow = {
	deck_id: string;
	card_id: string;
};

type SetupOptions = {
	userId?: string | null;
	decksList?: DeckRow[];
	deckOverview?: DeckRow | null;
	deckCards?: DeckCardRow[];
	reviewStates?: ReviewStateRow[];
};

const setupClient = (options: SetupOptions = {}) => {
	const getUserMock = vi.fn().mockResolvedValue({
		data: {
			user: options.userId === null ? null : { id: options.userId ?? "user-1" },
		},
		error: null,
	});

	const decksOrderMock = vi.fn().mockResolvedValue({
		data: options.decksList ?? [],
		error: null,
	});
	const decksMaybeSingleMock = vi.fn().mockResolvedValue({
		data: options.deckOverview ?? null,
		error: null,
	});
	const deckCardsInMock = vi.fn().mockResolvedValue({
		data: options.deckCards ?? [],
		error: null,
	});
	const reviewStatesInMock = vi.fn().mockResolvedValue({
		data: options.reviewStates ?? [],
		error: null,
	});

	const decksSelectMock = vi.fn().mockImplementation(() => ({
		eq: vi.fn((column: string) => {
			if (column === "owner_user_id") {
				return {
					order: decksOrderMock,
				};
			}

			if (column === "id") {
				return {
					eq: vi.fn(() => ({
						maybeSingle: decksMaybeSingleMock,
					})),
				};
			}

			throw new Error(`Unsupported decks eq column: ${column}`);
		}),
	}));

	const deckCardsSelectMock = vi.fn().mockReturnValue({
		in: deckCardsInMock,
	});
	const reviewStatesSelectMock = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			in: reviewStatesInMock,
		}),
	});

	const fromMock = vi.fn((table: string) => {
		if (table === "decks") {
			return { select: decksSelectMock };
		}

		if (table === "deck_cards") {
			return { select: deckCardsSelectMock };
		}

		if (table === "review_states") {
			return { select: reviewStatesSelectMock };
		}

		throw new Error(`Unsupported table: ${table}`);
	});

	createServerClientMock.mockReturnValue({
		auth: {
			getUser: getUserMock,
		},
		from: fromMock,
	});

	return {
		getUserMock,
		fromMock,
		decksSelectMock,
		decksOrderMock,
		decksMaybeSingleMock,
		deckCardsSelectMock,
		deckCardsInMock,
		reviewStatesInMock,
	};
};

describe("frontend/src/actions/deck-actions.ts", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		redirectMock.mockReset();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("UT-AC14-UNAUTH-REDIRECT-LIST: 未認証で getDecksWithCounts を呼ぶと /login へ遷移する", async () => {
		setupClient({ userId: null });

		await expect(getDecksWithCounts()).rejects.toMatchObject({
			location: "/login",
		});
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("UT-AC02-TWO-STEP-QUERY-EMPTY: デッキ0件なら1段階目のみで空配列を返す", async () => {
		const { deckCardsSelectMock, decksOrderMock } = setupClient({
			decksList: [],
		});

		const result = await getDecksWithCounts();

		expect(result).toEqual([]);
		expect(decksOrderMock).toHaveBeenCalledTimes(1);
		expect(deckCardsSelectMock).not.toHaveBeenCalled();
	});

	it("UT-AC03-COUNTS-BY-CATEGORY: 2段階目の結果をデッキ別に集計して返す", async () => {
		const { deckCardsInMock } = setupClient({
			userId: "user-1",
			decksList: [
				{ id: "deck-1", name: "小学3年生", new_limit_per_day: 20 },
				{ id: "deck-2", name: "小学4年生", new_limit_per_day: 20 },
			],
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-new" },
				{ deck_id: "deck-1", card_id: "card-learn" },
				{ deck_id: "deck-1", card_id: "card-due" },
				{ deck_id: "deck-2", card_id: "card-future" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "card-learn",
					level: 1,
					due_date: "1900-01-01",
					last_rating: "hard",
					retry_today_count: 0,
					last_reviewed_at: "2026-01-01T00:00:00.000Z",
				},
				{
					user_id: "user-1",
					card_id: "card-due",
					level: 3,
					due_date: "1900-01-01",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-01-01T00:00:00.000Z",
				},
				{
					user_id: "user-1",
					card_id: "card-future",
					level: 5,
					due_date: "2999-01-01",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const result = await getDecksWithCounts();

		expect(deckCardsInMock).toHaveBeenCalledWith("deck_id", ["deck-1", "deck-2"]);
		expect(result).toEqual([
			{
				id: "deck-1",
				name: "小学3年生",
				counts: {
					new: 1,
					learn: 1,
					due: 1,
				},
			},
			{
				id: "deck-2",
				name: "小学4年生",
				counts: {
					new: 0,
					learn: 0,
					due: 0,
				},
			},
		]);
	});

	it("UT-AC09-OVERVIEW-NOT-FOUND: getDeckOverview は対象デッキが無ければ null を返す", async () => {
		setupClient({ deckOverview: null });

		await expect(getDeckOverview("missing-deck")).resolves.toBeNull();
	});

	it("UT-AC10-OVERVIEW-TOTAL: getDeckOverview は total=new+learn+due を返す", async () => {
		const { deckCardsInMock, reviewStatesInMock } = setupClient({
			userId: "user-1",
			deckOverview: {
				id: "deck-1",
				name: "小学3年生",
				new_limit_per_day: 15,
			},
			deckCards: [
				{ deck_id: "deck-1", card_id: "new-card" },
				{ deck_id: "deck-1", card_id: "learn-card" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "learn-card",
					level: 1,
					due_date: "1900-01-01",
					last_rating: "hard",
					retry_today_count: 0,
					last_reviewed_at: null,
				},
			],
		});

		const overview = await getDeckOverview("deck-1");

		expect(deckCardsInMock).toHaveBeenCalledWith("deck_id", ["deck-1"]);
		expect(reviewStatesInMock).toHaveBeenCalledWith("card_id", ["new-card", "learn-card"]);
		expect(overview).toEqual({
			id: "deck-1",
			name: "小学3年生",
			newLimitPerDay: 15,
			counts: {
				new: 1,
				learn: 1,
				due: 0,
				total: 2,
			},
		});
	});
});
