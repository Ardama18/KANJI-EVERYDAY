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
	DECK_DELETE_ACTION_INITIAL_STATE,
	DECK_STUDY_LIMIT_ACTION_INITIAL_STATE,
	MAX_DECK_NAME_LENGTH,
	normalizeDeckNameInput,
} from "./deck-action-types";
import {
	createDeck,
	deleteDeck,
	getDeckLearningMetrics,
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

type StudySessionRow = {
	id: string;
	user_id?: string;
	deck_id?: string;
	finished_at: string | null;
};

type CardRow = {
	id: string;
	owner_user_id?: string | null;
	illustration_key: string | null;
};

type CardMnemonicRow = {
	owner_user_id?: string;
	illustration_key: string;
	status: string;
};

type SetupOptions = {
	userId?: string | null;
	authError?: unknown;
	decksList?: DeckRow[];
	deckOverview?: DeckRow | null;
	deckCards?: DeckCardRow[];
	reviewStates?: ReviewStateRow[];
	studySessions?: StudySessionRow[];
	cards?: CardRow[];
	cardMnemonics?: CardMnemonicRow[];
	deckOverviewError?: { message: string } | null;
	deckCardsError?: { message: string } | null;
	reviewStatesError?: { message: string } | null;
	studySessionsError?: { message: string } | null;
	cardsError?: { message: string } | null;
	cardMnemonicsError?: { message: string } | null;
	insertResult?: { data: unknown; error: unknown };
	updateStudyLimitResult?: { data: { id: string } | null; error: { message: string } | null };
	deleteDeckResult?: {
		data: { id: string } | null;
		error: { code?: string; message: string } | null;
	};
};

const VALID_DECK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_VALID_DECK_ID = "22222222-2222-4222-8222-222222222222";

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
		error: options.deckOverviewError ?? null,
	});
	const deckCardsInMock = vi.fn(async (_column: string, values: readonly string[]) => ({
		data: (options.deckCards ?? []).filter((row) => values.includes(row.deck_id)),
		error: options.deckCardsError ?? null,
	}));
	const deckCardsEqMock = vi.fn(async (_column: string, value: string) => ({
		data: (options.deckCards ?? []).filter((row) => row.deck_id === value),
		error: options.deckCardsError ?? null,
	}));
	let reviewStatesUserFilter: string | null = null;
	const reviewStatesInMock = vi.fn(async (_column: string, values: readonly string[]) => ({
		data: (options.reviewStates ?? []).filter(
			(row) =>
				values.includes(row.card_id) &&
				(reviewStatesUserFilter === null || row.user_id === reviewStatesUserFilter)
		),
		error: options.reviewStatesError ?? null,
	}));
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
	let decksUpdateResult: {
		data: { id: string } | null;
		error: { code?: string; message: string } | null;
	} | null = null;
	const decksUpdateMaybeSingleMock = vi.fn().mockImplementation(() =>
		Promise.resolve(
			decksUpdateResult ??
				options.updateStudyLimitResult ?? {
					data: { id: "deck-1" },
					error: null,
				}
		)
	);
	const decksUpdateSelectMock = vi.fn().mockReturnValue({
		maybeSingle: decksUpdateMaybeSingleMock,
	});
	const decksUpdateDeletedAtIsMock = vi.fn().mockReturnValue({
		select: decksUpdateSelectMock,
	});
	const decksUpdateOwnerEqMock = vi.fn().mockReturnValue({
		is: decksUpdateDeletedAtIsMock,
		select: decksUpdateSelectMock,
	});
	const decksUpdateIdEqMock = vi.fn().mockReturnValue({
		eq: decksUpdateOwnerEqMock,
	});
	const decksUpdateMock = vi.fn((values: Record<string, unknown>) => {
		decksUpdateResult =
			"deleted_at" in values
				? (options.deleteDeckResult ?? { data: { id: VALID_DECK_ID }, error: null })
				: (options.updateStudyLimitResult ?? { data: { id: "deck-1" }, error: null });
		return {
			eq: decksUpdateIdEqMock,
		};
	});
	const decksSelectOrderDeletedAtIsMock = vi.fn().mockReturnValue({
		order: decksOrderMock,
	});
	const decksSelectSingleDeletedAtIsMock = vi.fn().mockReturnValue({
		maybeSingle: decksMaybeSingleMock,
	});

	const decksSelectMock = vi.fn().mockImplementation(() => ({
		eq: vi.fn((column: string) => {
			if (column === "owner_user_id") {
				return {
					is: decksSelectOrderDeletedAtIsMock,
				};
			}

			if (column === "id") {
				return {
					eq: vi.fn(() => ({
						is: decksSelectSingleDeletedAtIsMock,
					})),
				};
			}

			throw new Error(`Unsupported decks eq column: ${column}`);
		}),
	}));

	const deckCardsSelectMock = vi.fn().mockReturnValue({
		in: deckCardsInMock,
		eq: deckCardsEqMock,
	});
	const reviewStatesEqMock = vi.fn((column: string, value: string) => {
		if (column === "user_id") {
			reviewStatesUserFilter = value;
		}
		return {
			in: reviewStatesInMock,
		};
	});
	const reviewStatesSelectMock = vi.fn().mockReturnValue({
		eq: reviewStatesEqMock,
	});

	let studySessionsUserFilter: string | null = null;
	const resolveStudySessions = (deckId: string, activeOnly: boolean) => ({
		data: (options.studySessions ?? []).filter(
			(row) =>
				(row.user_id === undefined ||
					studySessionsUserFilter === null ||
					row.user_id === studySessionsUserFilter) &&
				(row.deck_id === undefined || row.deck_id === deckId) &&
				(!activeOnly || row.finished_at === null)
		),
		error: options.studySessionsError ?? null,
	});
	const studySessionsLimitMock = vi.fn((deckId: string, activeOnly: boolean) =>
		Promise.resolve(resolveStudySessions(deckId, activeOnly))
	);
	const studySessionsFinishedAtIsMock = vi.fn(
		(deckId: string, _column: string, value: unknown) => ({
			limit: vi.fn((_count: number) => studySessionsLimitMock(deckId, value === null)),
		})
	);
	const studySessionsDeckEqMock = vi.fn((_column: string, value: string) => {
		const query = Promise.resolve(resolveStudySessions(value, false)) as Promise<
			ReturnType<typeof resolveStudySessions>
		> & {
			is: (
				column: string,
				filterValue: unknown
			) => ReturnType<typeof studySessionsFinishedAtIsMock>;
		};
		query.is = (column: string, filterValue: unknown) =>
			studySessionsFinishedAtIsMock(value, column, filterValue);

		return query;
	});
	const studySessionsUserEqMock = vi.fn((column: string, value: string) => {
		if (column === "user_id") {
			studySessionsUserFilter = value;
		}
		return {
			eq: studySessionsDeckEqMock,
		};
	});
	const studySessionsSelectMock = vi.fn().mockReturnValue({
		eq: studySessionsUserEqMock,
	});

	let cardsOwnerFilter: string | null = null;
	const cardsInMock = vi.fn(async (_column: string, values: readonly string[]) => ({
		data: (options.cards ?? []).filter(
			(row) =>
				values.includes(row.id) &&
				(row.owner_user_id === undefined ||
					cardsOwnerFilter === null ||
					row.owner_user_id === cardsOwnerFilter)
		),
		error: options.cardsError ?? null,
	}));
	const cardsOwnerEqMock = vi.fn((column: string, value: string) => {
		if (column === "owner_user_id") {
			cardsOwnerFilter = value;
		}
		return {
			in: cardsInMock,
		};
	});
	const cardsSelectMock = vi.fn().mockReturnValue({
		eq: cardsOwnerEqMock,
	});

	let cardMnemonicsOwnerFilter: string | null = null;
	let cardMnemonicsStatusFilter: string | null = null;
	const cardMnemonicsInMock = vi.fn(async (_column: string, values: readonly string[]) => ({
		data: (options.cardMnemonics ?? []).filter(
			(row) =>
				values.includes(row.illustration_key) &&
				(row.owner_user_id === undefined ||
					cardMnemonicsOwnerFilter === null ||
					row.owner_user_id === cardMnemonicsOwnerFilter) &&
				(cardMnemonicsStatusFilter === null || row.status === cardMnemonicsStatusFilter)
		),
		error: options.cardMnemonicsError ?? null,
	}));
	const cardMnemonicsStatusEqMock = vi.fn((column: string, value: string) => {
		if (column === "status") {
			cardMnemonicsStatusFilter = value;
		}
		return {
			in: cardMnemonicsInMock,
		};
	});
	const cardMnemonicsOwnerEqMock = vi.fn((column: string, value: string) => {
		if (column === "owner_user_id") {
			cardMnemonicsOwnerFilter = value;
		}
		return {
			eq: cardMnemonicsStatusEqMock,
		};
	});
	const cardMnemonicsSelectMock = vi.fn().mockReturnValue({
		eq: cardMnemonicsOwnerEqMock,
	});

	const fromMock = vi.fn((table: string) => {
		if (table === "decks") {
			return {
				select: decksSelectMock,
				insert: decksInsertMock,
				update: decksUpdateMock,
			};
		}

		if (table === "deck_cards") {
			return { select: deckCardsSelectMock };
		}

		if (table === "review_states") {
			return { select: reviewStatesSelectMock };
		}

		if (table === "study_sessions") {
			return { select: studySessionsSelectMock };
		}

		if (table === "cards") {
			return { select: cardsSelectMock };
		}

		if (table === "card_mnemonics") {
			return { select: cardMnemonicsSelectMock };
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
		decksUpdateDeletedAtIsMock,
		decksUpdateSelectMock,
		decksUpdateMaybeSingleMock,
		decksSelectOrderDeletedAtIsMock,
		decksSelectSingleDeletedAtIsMock,
		deckCardsSelectMock,
		deckCardsInMock,
		deckCardsEqMock,
		reviewStatesEqMock,
		reviewStatesInMock,
		studySessionsSelectMock,
		studySessionsUserEqMock,
		studySessionsDeckEqMock,
		studySessionsFinishedAtIsMock,
		studySessionsLimitMock,
		cardsSelectMock,
		cardsOwnerEqMock,
		cardsInMock,
		cardMnemonicsSelectMock,
		cardMnemonicsOwnerEqMock,
		cardMnemonicsStatusEqMock,
		cardMnemonicsInMock,
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

	it("UT-S25-DELETE-DECK-VALIDATION: invalid deckId は auth / DB 前に安全なerror stateを返す", async () => {
		const formData = new FormData();
		formData.set("deckId", "not-a-uuid");

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "デッキを削除できませんでした。時間をおいて再度お試しください。",
		});
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S25-DELETE-DECK-UNAUTH: 未認証ではDB DMLを実行しない", async () => {
		const { fromMock, decksUpdateMock } = setupClient({ userId: null });
		const formData = new FormData();
		formData.set("deckId", VALID_DECK_ID);

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({ status: "error", message: "ログインが必要です。" });
		expect(fromMock).not.toHaveBeenCalled();
		expect(decksUpdateMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S25-DELETE-DECK-SUCCESS: owner deck をowner filter付きで論理削除し /decks をrevalidateする", async () => {
		const {
			decksMaybeSingleMock,
			studySessionsUserEqMock,
			studySessionsDeckEqMock,
			studySessionsFinishedAtIsMock,
			decksUpdateMock,
			decksUpdateIdEqMock,
			decksUpdateOwnerEqMock,
			decksUpdateDeletedAtIsMock,
			decksUpdateSelectMock,
		} = setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: VALID_DECK_ID,
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			studySessions: [{ id: "completed-session", finished_at: "2026-02-24T00:00:00.000Z" }],
			deleteDeckResult: { data: { id: VALID_DECK_ID }, error: null },
		});
		const formData = new FormData();
		formData.set("deckId", VALID_DECK_ID);

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(decksMaybeSingleMock).toHaveBeenCalledTimes(1);
		expect(studySessionsUserEqMock).toHaveBeenCalledWith("user_id", "owner-user-1");
		expect(studySessionsDeckEqMock).toHaveBeenCalledWith("deck_id", VALID_DECK_ID);
		expect(studySessionsFinishedAtIsMock).toHaveBeenCalledWith(VALID_DECK_ID, "finished_at", null);
		expect(decksUpdateMock).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
		const deletedAt = decksUpdateMock.mock.calls[0]?.[0].deleted_at;
		expect(typeof deletedAt).toBe("string");
		expect(Number.isNaN(Date.parse(String(deletedAt)))).toBe(false);
		expect(decksUpdateIdEqMock).toHaveBeenCalledWith("id", VALID_DECK_ID);
		expect(decksUpdateOwnerEqMock).toHaveBeenCalledWith("owner_user_id", "owner-user-1");
		expect(decksUpdateDeletedAtIsMock).toHaveBeenCalledWith("deleted_at", null);
		expect(decksUpdateSelectMock).toHaveBeenCalledWith("id");
		expect(revalidatePathMock).toHaveBeenCalledWith("/decks");
		expect(result).toEqual({ status: "success", message: "デッキを削除しました。" });
	});

	it("UT-S25-DELETE-DECK-MISSING-OR-OTHER: 他ownerと不存在は同じ安全な失敗にする", async () => {
		setupClient({
			userId: "owner-user-1",
			deckOverview: null,
		});
		const otherOwnerFormData = new FormData();
		otherOwnerFormData.set("deckId", OTHER_VALID_DECK_ID);

		const otherOwnerResult = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, otherOwnerFormData);

		createServerClientMock.mockReset();
		revalidatePathMock.mockReset();
		setupClient({
			userId: "owner-user-1",
			deckOverview: null,
		});
		const missingFormData = new FormData();
		missingFormData.set("deckId", VALID_DECK_ID);

		const missingResult = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, missingFormData);

		expect(otherOwnerResult).toEqual(missingResult);
		expect(missingResult).toEqual({
			status: "error",
			message: "デッキを削除できませんでした。時間をおいて再度お試しください。",
		});
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S25-DELETE-DECK-ACTIVE-SESSION: active session があるdeckは論理削除しない", async () => {
		const { decksUpdateMock } = setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: VALID_DECK_ID,
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			studySessions: [
				{
					id: "active-session",
					user_id: "owner-user-1",
					deck_id: VALID_DECK_ID,
					finished_at: null,
				},
			],
		});
		const formData = new FormData();
		formData.set("deckId", VALID_DECK_ID);

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "学習中のデッキは削除できません。学習を終えてからもう一度お試しください。",
		});
		expect(decksUpdateMock).not.toHaveBeenCalled();
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S25-DELETE-DECK-P1007: trigger race のactive-session errorを安全な文言へ写像する", async () => {
		setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: VALID_DECK_ID,
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			deleteDeckResult: {
				data: null,
				error: { code: "P1007", message: "S-25 deck has an active session" },
			},
		});
		const formData = new FormData();
		formData.set("deckId", VALID_DECK_ID);

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "学習中のデッキは削除できません。学習を終えてからもう一度お試しください。",
		});
		expect(JSON.stringify(result)).not.toContain("P1007");
		expect(JSON.stringify(result)).not.toContain("active session");
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("UT-S25-DELETE-DECK-SAFE-ERROR: Supabase error detailを返却stateに含めない", async () => {
		setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: VALID_DECK_ID,
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			deleteDeckResult: {
				data: null,
				error: { message: "raw SQL stack secret other-owner-id" },
			},
		});
		const formData = new FormData();
		formData.set("deckId", VALID_DECK_ID);

		const result = await deleteDeck(DECK_DELETE_ACTION_INITIAL_STATE, formData);

		expect(result).toEqual({
			status: "error",
			message: "デッキを削除できませんでした。時間をおいて再度お試しください。",
		});
		expect(JSON.stringify(result)).not.toContain("raw SQL");
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(JSON.stringify(result)).not.toContain("other-owner");
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

	it("UT-S24-METRICS-OWNER-MISSING: owner deck が無ければ子行を読まず null を返す", async () => {
		const { fromMock, deckCardsSelectMock, reviewStatesInMock } = setupClient({
			userId: "owner-user-1",
			deckOverview: null,
		});

		await expect(getDeckLearningMetrics("missing-deck")).resolves.toBeNull();

		expect(fromMock.mock.calls.map(([table]) => table)).toEqual(["decks"]);
		expect(deckCardsSelectMock).not.toHaveBeenCalled();
		expect(reviewStatesInMock).not.toHaveBeenCalled();
	});

	it("UT-S24-METRICS-CARD0: card0 deck は empty metrics を返して子テーブルを追加取得しない", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		const {
			fromMock,
			deckCardsEqMock,
			reviewStatesInMock,
			studySessionsSelectMock,
			cardsSelectMock,
			cardMnemonicsSelectMock,
		} = setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: "deck-empty",
				name: "空デッキ",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			deckCards: [],
		});

		const result = await getDeckLearningMetrics("deck-empty");

		expect(fromMock.mock.calls.map(([table]) => table)).toEqual(["decks", "deck_cards"]);
		expect(deckCardsEqMock).toHaveBeenCalledWith("deck_id", "deck-empty");
		expect(reviewStatesInMock).not.toHaveBeenCalled();
		expect(studySessionsSelectMock).not.toHaveBeenCalled();
		expect(cardsSelectMock).not.toHaveBeenCalled();
		expect(cardMnemonicsSelectMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			contractVersion: 1,
			today: "2026-02-24",
			activeDays: 0,
			latestRatings: { total: 0, again: 0, hard: 0, good: 0, goodRate: null },
			mnemonicTrend: { comparable: false },
		});
		expect(result?.recentDays).toHaveLength(7);
	});

	it("UT-S24-METRICS-OWNER-FILTERS: actor/deck/card/mnemonic 境界で最新評価を集計する", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:30:00.000Z"));
		const {
			reviewStatesEqMock,
			reviewStatesInMock,
			studySessionsUserEqMock,
			studySessionsDeckEqMock,
			cardsOwnerEqMock,
			cardsInMock,
			cardMnemonicsOwnerEqMock,
			cardMnemonicsStatusEqMock,
			cardMnemonicsInMock,
		} = setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: "deck-1",
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			deckCards: [
				{ deck_id: "deck-1", card_id: "card-with-mnemonic" },
				{ deck_id: "deck-1", card_id: "card-without-mnemonic" },
				{ deck_id: "other-deck", card_id: "card-other-deck" },
			],
			reviewStates: [
				{
					user_id: "owner-user-1",
					card_id: "card-with-mnemonic",
					level: 2,
					due_date: "2026-02-25",
					last_rating: "good",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
				{
					user_id: "owner-user-1",
					card_id: "card-without-mnemonic",
					level: 1,
					due_date: "2026-02-25",
					last_rating: "hard",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-22T08:00:00.000Z",
				},
				{
					user_id: "other-user",
					card_id: "card-with-mnemonic",
					level: 1,
					due_date: "2026-02-25",
					last_rating: "again",
					retry_today_count: 0,
					last_reviewed_at: "2026-02-23T15:00:00.000Z",
				},
			],
			studySessions: [
				{
					id: "session-owner",
					user_id: "owner-user-1",
					deck_id: "deck-1",
					finished_at: "2026-02-23T15:00:00.000Z",
				},
				{
					id: "session-other-user",
					user_id: "other-user",
					deck_id: "deck-1",
					finished_at: "2026-02-23T15:00:00.000Z",
				},
				{
					id: "session-other-deck",
					user_id: "owner-user-1",
					deck_id: "other-deck",
					finished_at: "2026-02-23T15:00:00.000Z",
				},
			],
			cards: [
				{
					id: "card-with-mnemonic",
					owner_user_id: "owner-user-1",
					illustration_key: "key-approved",
				},
				{
					id: "card-without-mnemonic",
					owner_user_id: "owner-user-1",
					illustration_key: "key-draft",
				},
				{
					id: "card-with-mnemonic",
					owner_user_id: "other-user",
					illustration_key: "key-other-user",
				},
			],
			cardMnemonics: [
				{
					owner_user_id: "owner-user-1",
					illustration_key: "key-approved",
					status: "approved",
				},
				{
					owner_user_id: "owner-user-1",
					illustration_key: "key-draft",
					status: "draft",
				},
				{
					owner_user_id: "other-user",
					illustration_key: "key-draft",
					status: "approved",
				},
			],
		});

		const result = await getDeckLearningMetrics("deck-1");

		expect(reviewStatesEqMock).toHaveBeenCalledWith("user_id", "owner-user-1");
		expect(reviewStatesInMock).toHaveBeenCalledWith("card_id", [
			"card-with-mnemonic",
			"card-without-mnemonic",
		]);
		expect(studySessionsUserEqMock).toHaveBeenCalledWith("user_id", "owner-user-1");
		expect(studySessionsDeckEqMock).toHaveBeenCalledWith("deck_id", "deck-1");
		expect(cardsOwnerEqMock).toHaveBeenCalledWith("owner_user_id", "owner-user-1");
		expect(cardsInMock).toHaveBeenCalledWith("id", ["card-with-mnemonic", "card-without-mnemonic"]);
		expect(cardMnemonicsOwnerEqMock).toHaveBeenCalledWith("owner_user_id", "owner-user-1");
		expect(cardMnemonicsStatusEqMock).toHaveBeenCalledWith("status", "approved");
		expect(cardMnemonicsInMock).toHaveBeenCalledWith("illustration_key", [
			"key-approved",
			"key-draft",
		]);
		expect(result).toMatchObject({
			today: "2026-02-24",
			activeDays: 2,
			latestRatings: {
				total: 2,
				again: 0,
				hard: 1,
				good: 1,
				hardRate: 50,
				goodRate: 50,
			},
			mnemonicTrend: {
				withMnemonic: { total: 1, good: 1, goodRate: 100 },
				withoutMnemonic: { total: 1, hard: 1, hardRate: 100 },
				comparable: true,
			},
		});
		expect(result?.recentDays.at(-1)).toEqual({
			date: "2026-02-24",
			completedSessions: 1,
			reviewedCards: 1,
		});
	});

	it("UT-S24-METRICS-SAFE-ERROR: Supabase error detailを例外messageに含めない", async () => {
		setupClient({
			userId: "owner-user-1",
			deckOverview: {
				id: "deck-1",
				name: "小学3年生",
				new_limit_per_day: 20,
				daily_study_limit: 20,
			},
			deckCardsError: { message: "raw SQL secret token detail" },
		});

		await expect(getDeckLearningMetrics("deck-1")).rejects.toThrow(
			"Failed to fetch deck learning metrics"
		);
		await expect(getDeckLearningMetrics("deck-1")).rejects.not.toThrow("secret");
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
