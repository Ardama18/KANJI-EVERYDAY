import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

import {
	ILLUSTRATION_DISPLAY_STATUSES,
	STUDY_SESSION_EMPTY_MESSAGE,
	getNextCard,
	normalizeIllustrationState,
	revealCard,
	startStudySession,
} from "./session-actions";

class RedirectSignal extends Error {
	constructor(public readonly location: string) {
		super("NEXT_REDIRECT");
	}
}

const createAuth = (userId: string | null) => ({
	getUser: vi.fn().mockResolvedValue({
		data: {
			user: userId ? { id: userId } : null,
		},
		error: null,
	}),
});

const createOwnedDeckSelectChain = (deck: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: deck,
		error: null,
	});
	const eqOwnerMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const eqIdMock = vi.fn().mockReturnValue({
		eq: eqOwnerMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqIdMock,
	});

	return {
		selectMock,
		maybeSingleMock,
	};
};

const createActiveSessionSelectChain = (session: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: session,
		error: null,
	});
	const limitMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const orderMock = vi.fn().mockReturnValue({
		limit: limitMock,
	});
	const isMock = vi.fn().mockReturnValue({
		order: orderMock,
	});
	const eqDeckMock = vi.fn().mockReturnValue({
		is: isMock,
	});
	const eqUserMock = vi.fn().mockReturnValue({
		eq: eqDeckMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqUserMock,
	});

	return {
		selectMock,
	};
};

const createRequireSessionChain = (session: Record<string, unknown>) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: session,
		error: null,
	});
	const eqUserMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const eqIdMock = vi.fn().mockReturnValue({
		eq: eqUserMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqIdMock,
	});

	return {
		selectMock,
	};
};

describe("frontend/src/actions/session-actions.ts", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		redirectMock.mockReset();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("UT-S07-AC01: 未認証で startStudySession を呼ぶと /login に遷移する", async () => {
		createServerClientMock.mockReturnValue({
			auth: createAuth(null),
			from: vi.fn(),
		});

		await expect(startStudySession("deck-1")).rejects.toMatchObject({
			location: "/login",
		});
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("UT-S07-AC05: 対象カード0件ならセッションを作成せず completed を返す", async () => {
		const decksChain = createOwnedDeckSelectChain({
			id: "deck-1",
			name: "小学3年生の漢字",
			owner_user_id: "user-1",
			new_limit_per_day: 10,
		});
		const activeSessionChain = createActiveSessionSelectChain(null);
		const deckCardsSelectMock = vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({
				data: [],
				error: null,
			}),
		});
		const studyInsertMock = vi.fn();

		createServerClientMock.mockReturnValue({
			auth: createAuth("user-1"),
			from: vi.fn((table: string) => {
				if (table === "decks") {
					return {
						select: decksChain.selectMock,
					};
				}

				if (table === "study_sessions") {
					return {
						select: activeSessionChain.selectMock,
						insert: studyInsertMock,
					};
				}

				if (table === "deck_cards") {
					return {
						select: deckCardsSelectMock,
					};
				}

				throw new Error(`Unsupported table: ${table}`);
			}),
		});

		const result = await startStudySession("deck-1");

		expect(result).toEqual({
			status: "completed",
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			summary: {
				message: STUDY_SESSION_EMPTY_MESSAGE,
				studiedUniqueCards: 0,
			},
		});
		expect(studyInsertMock).not.toHaveBeenCalled();
	});

	it("UT-S07-AC09: getNextCard はキューが空なら finished_at を更新して null を返す", async () => {
		const sessionSelectChain = createRequireSessionChain({
			id: "session-1",
			user_id: "user-1",
			deck_id: "deck-1",
			queue_due: [],
			queue_learn: [],
			queue_new: [],
			queue_retry: [],
			current_card_id: null,
			revealed: false,
			created_at: "2026-02-24T00:00:00.000Z",
			finished_at: null,
		});
		const updateEqMock = vi.fn().mockResolvedValue({ error: null });
		const updateMock = vi.fn().mockReturnValue({
			eq: updateEqMock,
		});

		createServerClientMock.mockReturnValue({
			auth: createAuth("user-1"),
			from: vi.fn((table: string) => {
				if (table === "study_sessions") {
					return {
						select: sessionSelectChain.selectMock,
						update: updateMock,
					};
				}
				throw new Error(`Unsupported table: ${table}`);
			}),
		});

		const result = await getNextCard("session-1");

		expect(result).toBeNull();
		expect(updateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				finished_at: expect.any(String),
			})
		);
		expect(updateEqMock).toHaveBeenCalledWith("id", "session-1");
	});

	it("UT-S07-AC11: revealCard は裏面データと intervalPreview を返す", async () => {
		const sessionSelectChain = createRequireSessionChain({
			id: "session-2",
			user_id: "user-1",
			deck_id: "deck-1",
			queue_due: ["card-1"],
			queue_learn: [],
			queue_new: [],
			queue_retry: [],
			current_card_id: "card-1",
			revealed: false,
			created_at: "2026-02-24T00:00:00.000Z",
			finished_at: null,
		});
		const sessionUpdateMock = vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: null }),
		});
		const cardSelectMock = vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({
				maybeSingle: vi.fn().mockResolvedValue({
					data: {
						id: "card-1",
						skill: "reading",
						pattern: "R1",
						front_text: "温かい",
						back_text: "あたたかい",
					},
					error: null,
				}),
			}),
		});
		const reviewStateSelectMock = vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					maybeSingle: vi.fn().mockResolvedValue({
						data: {
							user_id: "user-1",
							card_id: "card-1",
							level: 1,
							due_date: "2026-02-24",
							last_rating: "hard",
							retry_today_count: 0,
							last_reviewed_at: "2026-02-24T00:00:00.000Z",
						},
						error: null,
					}),
				}),
			}),
		});

		createServerClientMock.mockReturnValue({
			auth: createAuth("user-1"),
			from: vi.fn((table: string) => {
				if (table === "study_sessions") {
					return {
						select: sessionSelectChain.selectMock,
						update: sessionUpdateMock,
					};
				}

				if (table === "cards") {
					return {
						select: cardSelectMock,
					};
				}

				if (table === "review_states") {
					return {
						select: reviewStateSelectMock,
					};
				}

				throw new Error(`Unsupported table: ${table}`);
			}),
		});

		const result = await revealCard("session-2");

		expect(result).toMatchObject({
			cardId: "card-1",
			skill: "reading",
			pattern: "R1",
			frontText: "温かい",
			backText: "あたたかい",
			illustrationUrl: null,
			intervalPreview: {
				again: { label: "今日さいご + 明日" },
			},
		});
		expect(sessionUpdateMock).toHaveBeenCalledWith({ revealed: true });
	});

	it("UT-S09-AC01-STATUS-ENUM-CONTRACT: normalizeIllustrationState は5状態のみを返す", async () => {
		const readyGetSignedUrlMock = vi.fn().mockResolvedValue("https://signed.example/image.png");
		const statuses = await Promise.all([
			normalizeIllustrationState({
				cardId: "card-none",
				illustrationKey: null,
				illustration: null,
			}),
			normalizeIllustrationState({
				cardId: "card-ready",
				illustrationKey: "key-ready",
				illustration: { status: "ready", storage_path: "user-1/ready.png" },
				getSignedUrlFn: readyGetSignedUrlMock,
			}),
			normalizeIllustrationState({
				cardId: "card-pending",
				illustrationKey: "key-pending",
				illustration: { status: "pending", storage_path: null },
			}),
			normalizeIllustrationState({
				cardId: "card-failed",
				illustrationKey: "key-failed",
				illustration: { status: "failed", storage_path: null },
			}),
			normalizeIllustrationState({
				cardId: "card-unknown",
				illustrationKey: "key-unknown",
				illustration: { status: "unknown", storage_path: null },
			}),
		]);

		for (const result of statuses) {
			expect(ILLUSTRATION_DISPLAY_STATUSES).toContain(result.illustrationStatus);
		}
	});

	it("UT-S09-AC02-NONE-KEY-NULL: illustration_key=null は none/null に正規化する", async () => {
		const triggerMock = vi.fn();
		const result = await normalizeIllustrationState({
			cardId: "card-1",
			illustrationKey: null,
			illustration: null,
			allowTrigger: true,
			triggerIllustrationGenerationFn: triggerMock,
		});

		expect(result).toEqual({
			illustrationStatus: "none",
			illustrationUrl: null,
		});
		expect(triggerMock).not.toHaveBeenCalled();
	});

	it("UT-AC05-SIGNED-URL-EXPIRESIN-3600: ready + storage_path は Signed URL を3600秒契約で返す", async () => {
		const getSignedUrlMock = vi.fn().mockResolvedValue("https://signed.example/ready.png");
		const result = await normalizeIllustrationState({
			cardId: "card-ready",
			illustrationKey: "key-ready",
			illustration: {
				status: "ready",
				storage_path: "user-1/illustration-ready.png",
			},
			getSignedUrlFn: getSignedUrlMock,
		});

		expect(result).toEqual({
			illustrationStatus: "ready",
			illustrationUrl: "https://signed.example/ready.png",
		});
		expect(getSignedUrlMock).toHaveBeenCalledWith("user-1/illustration-ready.png", 3600);
	});

	it("UT-S09-AC06-PENDING-NORMALIZATION: pending 行は pending/null を返す", async () => {
		const getSignedUrlMock = vi.fn();
		const result = await normalizeIllustrationState({
			cardId: "card-pending",
			illustrationKey: "key-pending",
			illustration: {
				status: "pending",
				storage_path: null,
			},
			getSignedUrlFn: getSignedUrlMock,
		});

		expect(result).toEqual({
			illustrationStatus: "pending",
			illustrationUrl: null,
		});
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("UT-S09-AC07-FAILED-NO-TRIGGER: failed 行は failed/null を返し trigger を呼ばない", async () => {
		const triggerMock = vi.fn().mockResolvedValue({
			ok: true,
			started: true,
			illustrationId: "illustration-1",
		});
		const result = await normalizeIllustrationState({
			cardId: "card-failed",
			illustrationKey: "key-failed",
			illustration: {
				status: "failed",
				storage_path: null,
			},
			allowTrigger: true,
			triggerIllustrationGenerationFn: triggerMock,
		});

		expect(result).toEqual({
			illustrationStatus: "failed",
			illustrationUrl: null,
		});
		expect(triggerMock).not.toHaveBeenCalled();
	});
});
