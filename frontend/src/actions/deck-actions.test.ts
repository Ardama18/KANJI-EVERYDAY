import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

vi.mock("next/cache", () => ({
	revalidatePath: revalidatePathMock,
}));

import {
	DECK_ACTION_INITIAL_STATE,
	MAX_DECK_NAME_LENGTH,
	normalizeDeckNameInput,
} from "./deck-action-types";
import { createDeck, getDeckOverview, getDecksWithCounts } from "./deck-actions";

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
	authError?: unknown;
	decksList?: DeckRow[];
	deckOverview?: DeckRow | null;
	deckCards?: DeckCardRow[];
	reviewStates?: ReviewStateRow[];
	insertResult?: { data: unknown; error: unknown };
};

const setupClient = (options: SetupOptions = {}) => {
	const getUserMock = vi.fn().mockResolvedValue({
		data: {
			user: options.userId === null ? null : { id: options.userId ?? "user-1" },
		},
		error: options.authError ?? null,
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
	const decksInsertSingleMock = vi.fn().mockResolvedValue(
		options.insertResult ?? {
			data: { id: "created-deck-1", name: "新しいデッキ" },
			error: null,
		}
	);
	const decksInsertSelectMock = vi.fn().mockReturnValue({
		single: decksInsertSingleMock,
	});
	const decksInsertMock = vi.fn().mockReturnValue({
		select: decksInsertSelectMock,
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
			return { select: decksSelectMock, insert: decksInsertMock };
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
		decksInsertMock,
		decksInsertSelectMock,
		decksInsertSingleMock,
		deckCardsSelectMock,
		deckCardsInMock,
		reviewStatesInMock,
	};
};

describe("frontend/src/actions/deck-actions.ts", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		redirectMock.mockReset();
		revalidatePathMock.mockReset();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("UT-S16-VALIDATE-DECK-NAME: デッキ名の空・長さ・制御文字を拒否しtrim済み名を返す", () => {
		expect(normalizeDeckNameInput("  一年生  ")).toEqual({ ok: true, name: "一年生" });
		expect(normalizeDeckNameInput("")).toMatchObject({ ok: false });
		expect(normalizeDeckNameInput("   ")).toMatchObject({ ok: false });
		expect(normalizeDeckNameInput(`${"あ".repeat(MAX_DECK_NAME_LENGTH)}x`)).toMatchObject({
			ok: false,
		});
		expect(normalizeDeckNameInput("漢字\u0000")).toMatchObject({ ok: false });
	});

	it("UT-S16-CREATE-DECK-VALIDATION: invalid form input fails before auth and insert", async () => {
		const formData = new FormData();
		formData.set("name", " ");

		const result = await createDeck(DECK_ACTION_INITIAL_STATE, formData);

		expect(result).toMatchObject({ status: "error" });
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S16-CREATE-DECK-UNAUTH: 未認証ではinsertせず安全なerror stateを返す", async () => {
		const { decksInsertMock } = setupClient({ userId: null });
		const formData = new FormData();
		formData.set("name", "初回デッキ");

		const result = await createDeck(DECK_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({ status: "error", message: "ログインが必要です。" });
		expect(decksInsertMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S16-CREATE-DECK-SUCCESS: 認証user IDでdeckを作成しdefault列を明示しない", async () => {
		const { decksInsertMock, decksInsertSelectMock } = setupClient({
			userId: "owner-user-1",
			insertResult: { data: { id: "deck-created", name: "初回デッキ" }, error: null },
		});
		const formData = new FormData();
		formData.set("name", "  初回デッキ  ");

		const result = await createDeck(DECK_ACTION_INITIAL_STATE, formData);

		expect(decksInsertMock).toHaveBeenCalledWith({
			owner_user_id: "owner-user-1",
			name: "初回デッキ",
		});
		expect(decksInsertMock.mock.calls[0]?.[0]).not.toHaveProperty("new_limit_per_day");
		expect(decksInsertSelectMock).toHaveBeenCalledWith("id, name");
		expect(revalidatePathMock).toHaveBeenCalledWith("/decks");
		expect(result).toEqual({
			status: "success",
			message: "デッキを作成しました。",
			deck: { id: "deck-created", name: "初回デッキ" },
		});
	});

	it("UT-S16-CREATE-DECK-SAFE-ERROR: Supabase error detailを返却stateに含めない", async () => {
		setupClient({
			insertResult: {
				data: null,
				error: { message: "duplicate key value violates unique constraint using SQL secret token" },
			},
		});
		const formData = new FormData();
		formData.set("name", "初回デッキ");

		const result = await createDeck(DECK_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "デッキを作成できませんでした。時間をおいて再度お試しください。",
		});
		expect(JSON.stringify(result)).not.toContain("duplicate key");
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(revalidatePathMock).not.toHaveBeenCalled();
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
