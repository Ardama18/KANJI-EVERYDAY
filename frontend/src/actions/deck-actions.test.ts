import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	DECK_STUDY_LIMIT_ACTION_INITIAL_STATE,
	MAX_DECK_NAME_LENGTH,
	normalizeDeckNameInput,
} from "./deck-action-types";
import {
	createDeck,
	getDeckOverview,
	getDecksWithCounts,
	updateDeckStudyLimit,
} from "./deck-actions";

class RedirectSignal extends Error {
	constructor(public readonly location: string) {
		super("NEXT_REDIRECT");
	}
}

type DeckRow = {
	id: string;
	name: string;
	new_limit_per_day: number;
	daily_study_limit: number;
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
	updateStudyLimitResult?: { data: { id: string } | null; error: { message: string } | null };
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
	const decksUpdateMaybeSingleMock = vi.fn().mockResolvedValue(
		options.updateStudyLimitResult ?? {
			data: { id: "deck-1" },
			error: null,
		}
	);
	const decksUpdateSelectMock = vi.fn().mockReturnValue({
		maybeSingle: decksUpdateMaybeSingleMock,
	});
	const decksUpdateOwnerEqMock = vi.fn().mockReturnValue({
		select: decksUpdateSelectMock,
	});
	const decksUpdateIdEqMock = vi.fn().mockReturnValue({
		eq: decksUpdateOwnerEqMock,
	});
	const decksUpdateMock = vi.fn().mockReturnValue({
		eq: decksUpdateIdEqMock,
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
			return { select: decksSelectMock, insert: decksInsertMock, update: decksUpdateMock };
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
		decksUpdateMock,
		decksUpdateIdEqMock,
		decksUpdateOwnerEqMock,
		decksUpdateSelectMock,
		decksUpdateMaybeSingleMock,
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
		vi.useRealTimers();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	afterEach(() => {
		vi.useRealTimers();
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
		expect(decksInsertMock.mock.calls[0]?.[0]).not.toHaveProperty("daily_study_limit");
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
				{ id: "deck-1", name: "小学3年生", new_limit_per_day: 20, daily_study_limit: 20 },
				{ id: "deck-2", name: "小学4年生", new_limit_per_day: 20, daily_study_limit: 20 },
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
				totalCards: 3,
				learnedCards: 2,
				scheduledCards: 0,
				dailyStudyLimit: 20,
				studiedToday: 0,
				nextDueDate: null,
			},
			{
				id: "deck-2",
				name: "小学4年生",
				counts: {
					new: 0,
					learn: 0,
					due: 0,
				},
				totalCards: 1,
				learnedCards: 1,
				scheduledCards: 1,
				dailyStudyLimit: 20,
				studiedToday: 0,
				nextDueDate: "2999-01-01",
			},
		]);
	});

	it("UT-S17-DECKS-FUTURE-ONLY-VISIBLE: 今日0件でも総数・学習済み・将来予定を返す", async () => {
		setupClient({
			userId: "user-1",
			decksList: [
				{ id: "deck-future", name: "テスt", new_limit_per_day: 10, daily_study_limit: 20 },
			],
			deckCards: Array.from({ length: 12 }, (_, index) => ({
				deck_id: "deck-future",
				card_id: `future-card-${index + 1}`,
			})),
			reviewStates: Array.from({ length: 12 }, (_, index) => ({
				user_id: "user-1",
				card_id: `future-card-${index + 1}`,
				level: 5,
				due_date: "2999-01-01",
				last_rating: "good" as const,
				retry_today_count: 0,
				last_reviewed_at: "2026-01-01T00:00:00.000Z",
			})),
		});

		await expect(getDecksWithCounts()).resolves.toEqual([
			{
				id: "deck-future",
				name: "テスt",
				counts: { new: 0, learn: 0, due: 0 },
				totalCards: 12,
				learnedCards: 12,
				scheduledCards: 12,
				dailyStudyLimit: 20,
				studiedToday: 0,
				nextDueDate: "2999-01-01",
			},
		]);
	});

	it("UT-S19-DECKS-JST-STUDIED-TODAY: JST日境界で一覧の本日学習済みと次回予定日を返す", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		const { deckCardsSelectMock, reviewStatesInMock } = setupClient({
			userId: "user-1",
			decksList: [
				{ id: "deck-1", name: "小学3年生", new_limit_per_day: 20, daily_study_limit: 20 },
			],
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-before-jst-midnight" },
				{ deck_id: "deck-1", card_id: "card-after-jst-midnight" },
				{ deck_id: "deck-1", card_id: "card-future" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "card-before-jst-midnight",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T14:59:59.999Z",
				},
				{
					user_id: "user-1",
					card_id: "card-after-jst-midnight",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
				{
					user_id: "user-1",
					card_id: "card-future",
					level: 4,
					due_date: "2026-03-05",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
			],
		});

		const result = await getDecksWithCounts();

		expect(result[0]).toMatchObject({
			studiedToday: 2,
			nextDueDate: "2026-03-05",
		});
		// NFR-01: 既存取得データの再集計のみで、追加の Supabase ラウンドトリップを作らない。
		expect(deckCardsSelectMock).toHaveBeenCalledTimes(1);
		expect(reviewStatesInMock).toHaveBeenCalledTimes(1);
	});

	it("UT-S19-DECKS-STUDIED-TODAY-UNIQUE: 同一カードが重複しても本日学習済みは1枚と数える", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		setupClient({
			userId: "user-1",
			decksList: [
				{ id: "deck-1", name: "小学3年生", new_limit_per_day: 20, daily_study_limit: 20 },
			],
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-reviewed" },
				{ deck_id: "deck-1", card_id: "card-reviewed" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "card-reviewed",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-24T01:00:00.000Z",
				},
			],
		});

		const result = await getDecksWithCounts();

		expect(result[0]?.studiedToday).toBe(1);
	});

	it("UT-S19-DECKS-OVERVIEW-STUDIED-TODAY-MATCH: 一覧と詳細で本日学習済みが一致する", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		const deckRow = {
			id: "deck-1",
			name: "小学3年生",
			new_limit_per_day: 20,
			daily_study_limit: 20,
		};
		setupClient({
			userId: "user-1",
			decksList: [deckRow],
			deckOverview: deckRow,
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-studied" },
				{ deck_id: "deck-1", card_id: "card-not-studied" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "card-studied",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
				{
					user_id: "user-1",
					card_id: "card-not-studied",
					level: 3,
					due_date: "2026-02-28",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-20T02:00:00.000Z",
				},
			],
		});

		const [deckFromList] = await getDecksWithCounts();
		const overview = await getDeckOverview("deck-1");

		expect(deckFromList?.studiedToday).toBe(overview?.studiedToday);
		expect(deckFromList?.nextDueDate).toBe(overview?.nextDueDate);
		expect(deckFromList?.nextDueDate).toBe("2026-02-28");
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
				daily_study_limit: 20,
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
			dailyStudyLimit: 20,
			studiedToday: 0,
			remainingToday: 20,
			counts: {
				new: 1,
				learn: 1,
				due: 0,
				total: 2,
			},
			totalCards: 2,
			learnedCards: 1,
			scheduledCards: 0,
			nextDueDate: null,
		});
	});

	it("UT-S17-OVERVIEW-JST-STUDIED-TODAY: JST日付で今日学習済み枚数と残枠を計算する", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		setupClient({
			userId: "user-1",
			deckOverview: {
				id: "deck-1",
				name: "小学3年生",
				new_limit_per_day: 15,
				daily_study_limit: 3,
			},
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-before-jst-midnight" },
				{ deck_id: "deck-1", card_id: "card-after-jst-midnight" },
				{ deck_id: "deck-1", card_id: "card-tomorrow-jst" },
			],
			reviewStates: [
				{
					user_id: "user-1",
					card_id: "card-before-jst-midnight",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T14:59:59.999Z",
				},
				{
					user_id: "user-1",
					card_id: "card-after-jst-midnight",
					level: 2,
					due_date: "2026-02-24",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
				{
					user_id: "user-1",
					card_id: "card-tomorrow-jst",
					level: 2,
					due_date: "2026-02-25",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-24T15:00:00.000Z",
				},
			],
		});

		const overview = await getDeckOverview("deck-1");

		expect(overview).toMatchObject({
			studiedToday: 1,
			remainingToday: 2,
			scheduledCards: 1,
			nextDueDate: "2026-02-25",
		});
	});

	it.each([
		{ value: "0", label: "too small" },
		{ value: "101", label: "too large" },
		{ value: "2.5", label: "decimal" },
		{ value: "abc", label: "non-number" },
	])("UT-S17-UPDATE-LIMIT-VALIDATION: $label をDB更新前に拒否する", async ({ value }) => {
		const formData = new FormData();
		formData.set("deckId", "deck-1");
		formData.set("dailyStudyLimit", value);

		const result = await updateDeckStudyLimit(DECK_STUDY_LIMIT_ACTION_INITIAL_STATE, formData);

		expect(result).toMatchObject({ status: "error" });
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S17-UPDATE-LIMIT-OWNER-SUCCESS: 本人所有デッキだけ一日最大枚数を更新する", async () => {
		const { decksUpdateMock, decksUpdateIdEqMock, decksUpdateOwnerEqMock } = setupClient({
			userId: "owner-user-1",
			updateStudyLimitResult: { data: { id: "deck-1" }, error: null },
		});
		const formData = new FormData();
		formData.set("deckId", "deck-1");
		formData.set("dailyStudyLimit", "25");

		const result = await updateDeckStudyLimit(DECK_STUDY_LIMIT_ACTION_INITIAL_STATE, formData);

		expect(decksUpdateMock).toHaveBeenCalledWith({ daily_study_limit: 25 });
		expect(decksUpdateIdEqMock).toHaveBeenCalledWith("id", "deck-1");
		expect(decksUpdateOwnerEqMock).toHaveBeenCalledWith("owner_user_id", "owner-user-1");
		expect(revalidatePathMock).toHaveBeenCalledWith("/decks");
		expect(revalidatePathMock).toHaveBeenCalledWith("/decks/deck-1");
		expect(result).toEqual({ status: "success", message: "一日最大枚数を保存しました。" });
	});

	it("UT-S17-UPDATE-LIMIT-OWNER-MISSING: 所有外または不存在なら安全なerror stateを返す", async () => {
		setupClient({
			userId: "owner-user-1",
			updateStudyLimitResult: { data: null, error: null },
		});
		const formData = new FormData();
		formData.set("deckId", "other-deck");
		formData.set("dailyStudyLimit", "25");

		const result = await updateDeckStudyLimit(DECK_STUDY_LIMIT_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "一日最大枚数を保存できませんでした。時間をおいて再度お試しください。",
		});
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});
});
