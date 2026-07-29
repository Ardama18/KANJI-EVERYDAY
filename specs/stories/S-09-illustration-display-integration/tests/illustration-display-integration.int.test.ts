// S-09 統合テスト - Design Doc: illustration-display-integration
// 生成日: 2026-02-24
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Design Doc / Requirements）:
// EARS-01(遍在型) / AC-01 -> IT-AC01-STATUS-ENUM-CONTRACT
// EARS-02(選択型) / AC-02 -> IT-AC02-NONE-WHEN-ILLUSTRATION-KEY-NULL
// EARS-03(選択型) / AC-04 -> IT-AC03-READY-SIGNED-URL
// EARS-04(不測型) -> IT-AC04-READY-WITHOUT-STORAGE-PATH-NORMALIZED
// AC-05 -> IT-AC05-SIGNED-URL-EXPIRESIN-3600
// EARS-05(契機型) / AC-08 -> IT-AC06-TRIGGER-STARTED-GENERATING
// EARS-06(選択型) / AC-09 -> IT-AC07-TRIGGER-NOT-STARTED-PENDING
// EARS-07(不測型) / AC-10 -> IT-AC08-TRIGGER-OK-FALSE-PENDING
// EARS-07(不測型) / AC-11 -> IT-AC09-TRIGGER-EXCEPTION-PENDING
// Design Policy(getStudySessionState phase=back) -> IT-AC10-BACK-RESTORE-USES-SAME-NORMALIZATION
// AC-20 -> IT-AC11-NO-EXTRA-API-AFTER-REVEAL
// AC-18 -> IT-AC18-NEXT-CONFIG-REMOTE-PATTERNS

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());
const getSignedUrlMock = vi.hoisted(() => vi.fn());
const triggerIllustrationGenerationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

vi.mock("@/lib/illustration/storage", () => ({
	getSignedUrl: getSignedUrlMock,
}));

vi.mock("@/actions/illustration-actions", () => ({
	triggerIllustrationGeneration: triggerIllustrationGenerationMock,
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

import {
	type CardFrontData,
	getStudySessionState,
	revealCard,
} from "../../../../frontend/src/actions/session-actions";
import { ILLUSTRATION_DISPLAY_STATUSES } from "../../../../frontend/src/actions/session-contracts";
import { CardBack } from "../../../../frontend/src/components/study/CardBack";

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

const createOwnedDeckSelectChain = (deck: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: deck,
		error: null,
	});
	const isDeletedAtMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const eqOwnerMock = vi.fn().mockReturnValue({
		is: isDeletedAtMock,
	});
	const eqIdMock = vi.fn().mockReturnValue({
		eq: eqOwnerMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqIdMock,
	});

	return {
		selectMock,
	};
};

const createCardSelectChain = (card: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: card,
		error: null,
	});
	const eqIdMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqIdMock,
	});

	return {
		selectMock,
	};
};

const createReviewStateSelectChain = (reviewState: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: reviewState,
		error: null,
	});
	const eqCardIdMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const eqUserIdMock = vi.fn().mockReturnValue({
		eq: eqCardIdMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqUserIdMock,
	});

	return {
		selectMock,
	};
};

const createIllustrationSelectChain = (illustration: Record<string, unknown> | null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: illustration,
		error: null,
	});
	const limitMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const orderIdMock = vi.fn().mockReturnValue({
		limit: limitMock,
	});
	const orderUpdatedAtMock = vi.fn().mockReturnValue({
		order: orderIdMock,
	});
	const eqIllustrationKeyMock = vi.fn().mockReturnValue({
		order: orderUpdatedAtMock,
	});
	const eqOwnerMock = vi.fn().mockReturnValue({
		eq: eqIllustrationKeyMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqOwnerMock,
	});

	return {
		selectMock,
	};
};

const createDeckCardsSelectChain = (rows: Record<string, unknown>[] = []) => {
	const eqMock = vi.fn().mockResolvedValue({
		data: rows,
		error: null,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqMock,
	});

	return {
		selectMock,
	};
};

const createMnemonicSelectChain = (mnemonic: Record<string, unknown> | null = null) => {
	const maybeSingleMock = vi.fn().mockResolvedValue({
		data: mnemonic,
		error: null,
	});
	const eqIllustrationKeyMock = vi.fn().mockReturnValue({
		maybeSingle: maybeSingleMock,
	});
	const eqOwnerMock = vi.fn().mockReturnValue({
		eq: eqIllustrationKeyMock,
	});
	const selectMock = vi.fn().mockReturnValue({
		eq: eqOwnerMock,
	});

	return {
		selectMock,
	};
};

const createSessionRow = (revealed: boolean) => ({
	id: "session-2",
	user_id: "user-1",
	deck_id: "deck-1",
	queue_due: ["card-1"],
	queue_learn: [],
	queue_new: [],
	queue_retry: [],
	current_card_id: "card-1",
	revealed,
	created_at: "2026-02-24T00:00:00.000Z",
	finished_at: null,
});

const createCardRow = (illustrationKey: string | null) => ({
	id: "card-1",
	skill: "reading",
	pattern: "R1",
	front_text: "温かい",
	back_text: "あたたかい",
	illustration_key: illustrationKey,
});

const createReviewStateRow = () => ({
	user_id: "user-1",
	card_id: "card-1",
	level: 1,
	due_date: "2026-02-24",
	last_rating: "hard",
	retry_today_count: 0,
	last_reviewed_at: "2026-02-24T00:00:00.000Z",
});

const createFrontCardData = (): CardFrontData => ({
	sessionId: "session-2",
	cardId: "card-1",
	skill: "reading",
	pattern: "R1",
	frontText: "温かい",
	progress: {
		current: 1,
		total: 10,
		remaining: 9,
	},
});

const countByTestId = (html: string, testId: string): number =>
	html.match(new RegExp(`data-testid="${testId}"`, "g"))?.length ?? 0;

const NEXT_CONFIG_MODULE_URL = new URL("../../../../frontend/next.config.mjs", import.meta.url);

const createRevealCardClient = (options: {
	illustrationKey: string | null;
	illustration: Record<string, unknown> | null;
}) => {
	const sessionSelectChain = createRequireSessionChain(createSessionRow(false));
	const sessionUpdateMock = vi.fn().mockReturnValue({
		eq: vi.fn().mockResolvedValue({ error: null }),
	});
	const cardSelectChain = createCardSelectChain(createCardRow(options.illustrationKey));
	const reviewStateSelectChain = createReviewStateSelectChain(createReviewStateRow());
	const illustrationSelectChain = createIllustrationSelectChain(options.illustration);
	const mnemonicSelectChain = createMnemonicSelectChain();
	const fromMock = vi.fn((table: string) => {
		if (table === "study_sessions") {
			return {
				select: sessionSelectChain.selectMock,
				update: sessionUpdateMock,
			};
		}

		if (table === "cards") {
			return {
				select: cardSelectChain.selectMock,
			};
		}

		if (table === "review_states") {
			return {
				select: reviewStateSelectChain.selectMock,
			};
		}

		if (table === "illustrations") {
			return {
				select: illustrationSelectChain.selectMock,
			};
		}

		if (table === "card_mnemonics") {
			return {
				select: mnemonicSelectChain.selectMock,
			};
		}

		throw new Error(`Unsupported table: ${table}`);
	});

	return {
		client: {
			auth: createAuth("user-1"),
			from: fromMock,
		},
		sessionUpdateMock,
	};
};

const createBackPhaseClient = (options: {
	illustrationKey: string | null;
	illustration: Record<string, unknown> | null;
}) => {
	const sessionSelectChain = createRequireSessionChain(createSessionRow(true));
	const deckSelectChain = createOwnedDeckSelectChain({
		id: "deck-1",
		name: "小学3年生の漢字",
		owner_user_id: "user-1",
		new_limit_per_day: 10,
	});
	const cardSelectChain = createCardSelectChain(createCardRow(options.illustrationKey));
	const reviewStateSelectChain = createReviewStateSelectChain(createReviewStateRow());
	const illustrationSelectChain = createIllustrationSelectChain(options.illustration);
	const mnemonicSelectChain = createMnemonicSelectChain();
	const deckCardsSelectChain = createDeckCardsSelectChain([]);
	const fromMock = vi.fn((table: string) => {
		if (table === "study_sessions") {
			return {
				select: sessionSelectChain.selectMock,
			};
		}

		if (table === "decks") {
			return {
				select: deckSelectChain.selectMock,
			};
		}

		if (table === "cards") {
			return {
				select: cardSelectChain.selectMock,
			};
		}

		if (table === "review_states") {
			return {
				select: reviewStateSelectChain.selectMock,
			};
		}

		if (table === "illustrations") {
			return {
				select: illustrationSelectChain.selectMock,
			};
		}

		if (table === "card_mnemonics") {
			return {
				select: mnemonicSelectChain.selectMock,
			};
		}

		if (table === "deck_cards") {
			return {
				select: deckCardsSelectChain.selectMock,
			};
		}

		throw new Error(`Unsupported table: ${table}`);
	});

	return {
		auth: createAuth("user-1"),
		from: fromMock,
	};
};

describe("S-09 illustration-display-integration integration", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		redirectMock.mockReset();
		getSignedUrlMock.mockReset();
		triggerIllustrationGenerationMock.mockReset();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("IT-AC01: revealCard は illustrationStatus を5状態列挙で返し illustrationUrl キーを常時返す", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "pending", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(ILLUSTRATION_DISPLAY_STATUSES).toContain(result.illustrationStatus);
		expect(result).toHaveProperty("illustrationUrl");
	});

	it("IT-AC02: illustration_key=null のとき revealCard は none/null を返却する", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: null,
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockResolvedValue({
			ok: true,
			started: true,
			illustrationId: "illustration-1",
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("none");
		expect(result.illustrationUrl).toBeNull();
		expect(triggerIllustrationGenerationMock).not.toHaveBeenCalled();
	});

	it("IT-AC03: ready + storage_path ありは ready と Signed URL を返す", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "ready", storage_path: "user-1/illustration-ready.png" },
		});
		getSignedUrlMock.mockResolvedValue("https://signed.example/illustration-ready.png");
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("ready");
		expect(result.illustrationUrl).toBe("https://signed.example/illustration-ready.png");
	});

	it("IT-AC04: ready かつ storage_path 欠落は pending/null へ正規化する", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "ready", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("pending");
		expect(result.illustrationUrl).toBeNull();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("IT-AC05: Signed URL 生成は expiresIn=3600 で呼び出される", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "ready", storage_path: "user-1/illustration-ready.png" },
		});
		getSignedUrlMock.mockResolvedValue("https://signed.example/illustration-ready.png");
		createServerClientMock.mockReturnValue(reveal.client);

		await revealCard("session-2");

		expect(getSignedUrlMock).toHaveBeenCalledWith("user-1/illustration-ready.png", 3600);
	});

	it("IT-AC06: records なしで trigger が ok=true started=true のとき generating を返す", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockResolvedValue({
			ok: true,
			started: true,
			illustrationId: "illustration-1",
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("generating");
		expect(result.illustrationUrl).toBeNull();
	});

	it("IT-AC07: records なしで trigger が ok=true started=false のとき pending を返す", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockResolvedValue({
			ok: true,
			started: false,
			illustrationId: "illustration-1",
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("pending");
		expect(result.illustrationUrl).toBeNull();
	});

	it("IT-AC08: records なしで trigger が ok=false のとき pending を返し revealCard は成功を維持する", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockResolvedValue({
			ok: false,
			code: "failed_to_schedule",
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("pending");
		expect(result.illustrationUrl).toBeNull();
	});

	it("IT-AC09: records なしで trigger が例外を投げても pending を返し revealCard は失敗しない", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockRejectedValue(new Error("trigger failed"));
		createServerClientMock.mockReturnValue(reveal.client);

		const result = await revealCard("session-2");

		expect(result.illustrationStatus).toBe("pending");
		expect(result.illustrationUrl).toBeNull();
	});

	it("IT-AC10: getStudySessionState(phase=back) は revealCard と同一正規化/trigger分岐を使用する", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		const back = createBackPhaseClient({
			illustrationKey: "key-1",
			illustration: null,
		});
		triggerIllustrationGenerationMock.mockResolvedValue({
			ok: true,
			started: false,
			illustrationId: "illustration-1",
		});
		createServerClientMock.mockReturnValueOnce(reveal.client).mockReturnValueOnce(back);

		const revealResult = await revealCard("session-2");
		const state = await getStudySessionState("session-2");

		expect(state.phase).toBe("back");
		if (state.phase !== "back") {
			throw new Error("Expected back phase state");
		}
		expect(state.backData.illustrationStatus).toBe(revealResult.illustrationStatus);
		expect(state.backData.illustrationUrl).toBe(revealResult.illustrationUrl);
		expect(triggerIllustrationGenerationMock).toHaveBeenCalledTimes(2);
		expect(triggerIllustrationGenerationMock).toHaveBeenNthCalledWith(1, "card-1");
		expect(triggerIllustrationGenerationMock).toHaveBeenNthCalledWith(2, "card-1");
	});

	it("IT-AC11: revealCard のレスポンスだけで裏面イラスト分岐が決定でき追加API呼び出しが不要", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "pending", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const fromCallCountAfterReveal = reveal.client.from.mock.calls.length;
		const html = renderToStaticMarkup(
			createElement(CardBack, {
				deckId: "deck-1",
				deckName: "小学3年生の漢字",
				card: createFrontCardData(),
				backData,
				onRate: vi.fn(),
			})
		);

		expect(backData.illustrationStatus).toBe("pending");
		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-loading")).toBe(1);
		expect(countByTestId(html, "illustration-image")).toBe(0);
		expect(reveal.client.from).toHaveBeenCalledTimes(fromCallCountAfterReveal);
		expect(createServerClientMock).toHaveBeenCalledTimes(1);
		expect(triggerIllustrationGenerationMock).not.toHaveBeenCalled();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("IT-AC18: next.config.mjs は Supabase Signed URL 向け remotePatterns 契約を保持する", async () => {
		const module = (await import(NEXT_CONFIG_MODULE_URL.href)) as {
			default?: {
				images?: {
					remotePatterns?: Array<{
						protocol?: string;
						hostname?: string;
						pathname?: string;
					}>;
				};
			};
		};
		const remotePatterns = module.default?.images?.remotePatterns;

		expect(remotePatterns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					protocol: "https",
					hostname: "*.supabase.co",
					pathname: "/storage/v1/object/sign/**",
				}),
			])
		);
	});
});
