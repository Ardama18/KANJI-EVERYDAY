// S-09 E2Eテスト - Design Doc: illustration-display-integration
// 生成日: 2026-02-24
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Design Doc / Requirements）:
// AC-01 -> E2E-AC01-FRONT-REVEAL-BACK-FLOW
// AC-03 -> E2E-AC03-NONE-HIDES-ILLUSTRATION-REGION
// AC-12 -> E2E-AC12-PENDING-SHOWS-LOADING
// AC-13 -> E2E-AC13-GENERATING-SHOWS-LOADING
// AC-14 -> E2E-AC14-FAILED-SHOWS-PLACEHOLDER-NO-RETRY
// AC-15 -> E2E-AC15-READY-SHOWS-IMAGE
// AC-16 -> E2E-AC16-FALLBACK-NONBLOCKING
// AC-17 -> E2E-AC17-FRONT-HIDES-ILLUSTRATION
// AC-20 -> E2E-AC20-NO-EXTRA-API-CALLS

import type { ComponentPropsWithoutRef } from "react";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());
const getSignedUrlMock = vi.hoisted(() => vi.fn());
const triggerIllustrationGenerationMock = vi.hoisted(() => vi.fn());

type MockImageProps = ComponentPropsWithoutRef<"img"> & {
	src: string;
};

const imageMock = vi.hoisted(() =>
	vi.fn((props: MockImageProps) => createElement("img", { ...props, alt: props.alt ?? "" }))
);

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

vi.mock("next/image", () => ({
	default: (props: MockImageProps) => imageMock(props),
}));

import {
	type CardBackData,
	type CardFrontData,
	type IllustrationDisplayStatus,
	revealCard,
} from "../../../../frontend/src/actions/session-actions";
import { CardBack } from "../../../../frontend/src/components/study/CardBack";
import { CardFront } from "../../../../frontend/src/components/study/CardFront";
import { resolveIllustrationRenderState } from "../../../../frontend/src/components/study/IllustrationDisplay";
import {
	RATING_BUTTON_ORDER,
	RatingButtons,
} from "../../../../frontend/src/components/study/RatingButtons";

class RedirectSignal extends Error {
	constructor(public readonly location: string) {
		super("NEXT_REDIRECT");
	}
}

type IllustrationRow = {
	status: string;
	storage_path: string | null;
};

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

const createRevealCardClient = (options: {
	illustrationKey: string | null;
	illustration: IllustrationRow | null;
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
	};
};

const baseFrontCard = createFrontCardData();

const countByTestId = (html: string, testId: string): number =>
	html.match(new RegExp(`data-testid=\"${testId}\"`, "g"))?.length ?? 0;

const renderFront = (): string =>
	renderToStaticMarkup(
		createElement(CardFront, {
			card: baseFrontCard,
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			onReveal: vi.fn(),
		})
	);

const renderBack = (backData: CardBackData): string =>
	renderToStaticMarkup(
		createElement(CardBack, {
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			card: baseFrontCard,
			backData,
			onRate: vi.fn(),
		})
	);

const assertNoIllustrationDom = (html: string) => {
	expect(countByTestId(html, "illustration-region")).toBe(0);
	expect(countByTestId(html, "illustration-image")).toBe(0);
	expect(countByTestId(html, "illustration-loading")).toBe(0);
	expect(countByTestId(html, "illustration-failed")).toBe(0);
	expect(countByTestId(html, "illustration-fallback")).toBe(0);
};

describe("S-09 illustration-display-integration e2e", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		redirectMock.mockReset();
		getSignedUrlMock.mockReset();
		triggerIllustrationGenerationMock.mockReset();
		imageMock.mockClear();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("E2E-AC01: 学習画面で front から reveal して back 表示へ遷移し状態別描画に到達できる", async () => {
		const frontHtml = renderFront();
		assertNoIllustrationDom(frontHtml);

		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "pending", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("pending");
		expect(countByTestId(backHtml, "illustration-region")).toBe(1);
		expect(countByTestId(backHtml, "illustration-loading")).toBe(1);
		expect(backHtml).toContain("むり");
		expect(backHtml).toContain("あやしい");
		expect(backHtml).toContain("できた");
	});

	it("E2E-AC03: none のカードでは裏面に illustration-region が描画されない", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: null,
			illustration: null,
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("none");
		expect(backData.illustrationUrl).toBeNull();
		expect(countByTestId(backHtml, "illustration-region")).toBe(0);
		expect(triggerIllustrationGenerationMock).not.toHaveBeenCalled();
	});

	it("E2E-AC12: pending のカードはローディングプレースホルダを表示し画像は表示しない", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "pending", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("pending");
		expect(countByTestId(backHtml, "illustration-region")).toBe(1);
		expect(countByTestId(backHtml, "illustration-loading")).toBe(1);
		expect(countByTestId(backHtml, "illustration-image")).toBe(0);
	});

	it("E2E-AC13: generating のカードは pending と同じローディングプレースホルダを表示する", async () => {
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

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("generating");
		expect(countByTestId(backHtml, "illustration-loading")).toBe(1);
		expect(countByTestId(backHtml, "illustration-image")).toBe(0);
		expect(triggerIllustrationGenerationMock).toHaveBeenCalledWith("card-1");
	});

	it("E2E-AC14: failed のカードは静的プレースホルダを表示し再試行UIを描画しない", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "failed", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("failed");
		expect(countByTestId(backHtml, "illustration-failed")).toBe(1);
		expect(backHtml).not.toContain("再試行");
	});

	it("E2E-AC15: ready のカードは裏面で illustration-image を表示する", async () => {
		const signedUrl = "https://signed.example/illustration-ready.png";
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "ready", storage_path: "user-1/illustration-ready.png" },
		});
		getSignedUrlMock.mockResolvedValue(signedUrl);
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const backHtml = renderBack(backData);

		expect(backData.illustrationStatus).toBe("ready");
		expect(backData.illustrationUrl).toBe(signedUrl);
		expect(countByTestId(backHtml, "illustration-image")).toBe(1);
		expect(backHtml).toContain("/_next/image?url=");
		expect(backHtml).toContain(encodeURIComponent(signedUrl));
	});

	it("E2E-AC16: ready 画像のロード失敗時に fallback 表示へ切替わり評価操作を継続できる", () => {
		const signedUrl = "https://signed.example/illustration-ready.png";

		expect(resolveIllustrationRenderState("ready", false, signedUrl)).toBe("image");
		expect(resolveIllustrationRenderState("ready", true, signedUrl)).toBe("fallback");

		const fallbackBackData: CardBackData = {
			cardId: "card-1",
			skill: "reading",
			pattern: "R1",
			frontText: "温かい",
			backText: "あたたかい",
			illustrationStatus: "ready",
			illustrationUrl: null,
			explanation: null,
			intervalPreview: {
				again: { label: "今日さいご + 明日" },
				hard: { interval: 2, label: "2日後" },
				good: { interval: 3, label: "3日後" },
			},
		};
		const fallbackHtml = renderBack(fallbackBackData);
		expect(countByTestId(fallbackHtml, "illustration-fallback")).toBe(1);

		const onRate = vi.fn<(rating: "again" | "hard" | "good") => void>();
		const ratingButtonsElement = RatingButtons({
			intervalPreview: fallbackBackData.intervalPreview,
			onRate,
		});
		if (
			!isValidElement<{ children: unknown }>(ratingButtonsElement) ||
			!Array.isArray(ratingButtonsElement.props.children)
		) {
			throw new Error("Expected RatingButtons to render clickable children");
		}

		for (const child of ratingButtonsElement.props.children) {
			if (!isValidElement<{ onClick?: () => void }>(child) || !child.props.onClick) {
				throw new Error("Expected each rating button to provide onClick");
			}
			child.props.onClick();
		}

		expect(onRate.mock.calls.map(([rating]) => rating)).toEqual(RATING_BUTTON_ORDER);
	});

	it("E2E-AC17: front フェーズでは illustration 系DOMが常に非表示のまま維持される", () => {
		const statuses: IllustrationDisplayStatus[] = [
			"ready",
			"pending",
			"generating",
			"failed",
			"none",
		];

		for (const _status of statuses) {
			const frontHtml = renderFront();
			assertNoIllustrationDom(frontHtml);
		}
	});

	it("E2E-AC20: reveal 後に追加の状態判定APIを呼ばず裏面イラスト表示分岐が完了する", async () => {
		const reveal = createRevealCardClient({
			illustrationKey: "key-1",
			illustration: { status: "pending", storage_path: null },
		});
		createServerClientMock.mockReturnValue(reveal.client);

		const backData = await revealCard("session-2");
		const fromCallCountAfterReveal = reveal.client.from.mock.calls.length;
		const backHtml = renderToStaticMarkup(
			createElement(CardBack, {
				deckId: "deck-1",
				deckName: "小学3年生の漢字",
				card: createFrontCardData(),
				backData,
				onRate: vi.fn(),
			})
		);

		expect(backData.illustrationStatus).toBe("pending");
		expect(countByTestId(backHtml, "illustration-loading")).toBe(1);
		expect(reveal.client.from).toHaveBeenCalledTimes(fromCallCountAfterReveal);
		expect(createServerClientMock).toHaveBeenCalledTimes(1);
		expect(triggerIllustrationGenerationMock).not.toHaveBeenCalled();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});
});
