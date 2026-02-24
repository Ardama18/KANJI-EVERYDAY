import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startStudySessionMock = vi.hoisted(() => vi.fn());
const getStudySessionStateMock = vi.hoisted(() => vi.fn());
const studyClientMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn<() => never>());

vi.mock("@/actions/session-actions", () => ({
	STUDY_SESSION_EMPTY_MESSAGE: "今日の学習は完了しています",
	startStudySession: startStudySessionMock,
	getStudySessionState: getStudySessionStateMock,
}));

vi.mock("@/components/study/StudyClient", () => ({
	StudyClient: studyClientMock,
}));

vi.mock("next/navigation", () => ({
	notFound: notFoundMock,
}));

import StudyPage, {
	STUDY_COMPLETE_FROM_START_MESSAGE,
	STUDY_PAGE_TITLE,
} from "../../../../../app/(auth)/decks/[deckId]/study/page";

class NotFoundSignal extends Error {
	constructor() {
		super("NEXT_NOT_FOUND");
	}
}

describe("frontend/app/(auth)/decks/[deckId]/study/page.tsx", () => {
	beforeEach(() => {
		startStudySessionMock.mockReset();
		getStudySessionStateMock.mockReset();
		studyClientMock.mockReset();
		notFoundMock.mockReset();

		studyClientMock.mockImplementation((props: { deckId: string; deckName: string }) => {
			return <div data-testid="study-client">{props.deckName}</div>;
		});

		notFoundMock.mockImplementation(() => {
			throw new NotFoundSignal();
		});
	});

	it("session が無いとき startStudySession を呼んで StudyClient に初期状態を渡す", async () => {
		startStudySessionMock.mockResolvedValue({
			status: "active",
			sessionId: "session-1",
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
		});
		getStudySessionStateMock.mockResolvedValue({
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			phase: "front",
			card: {
				sessionId: "session-1",
				cardId: "card-1",
				skill: "reading",
				pattern: "R1",
				frontText: "温かい",
				progress: { current: 1, total: 5, remaining: 5 },
			},
		});

		const html = renderToStaticMarkup(
			await StudyPage({
				params: { deckId: "deck-1" },
			})
		);

		expect(html).toContain("小学3年生の漢字");
		expect(startStudySessionMock).toHaveBeenCalledWith("deck-1");
		expect(getStudySessionStateMock).toHaveBeenCalledWith("session-1");
	});

	it("session クエリがあるときは startStudySession を呼ばずにセッション状態をロードする", async () => {
		getStudySessionStateMock.mockResolvedValue({
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			phase: "complete",
			summary: {
				message: "今日の学習おわり！",
				studiedUniqueCards: 3,
			},
		});

		await StudyPage({
			params: { deckId: "deck-1" },
			searchParams: { session: "session-9" },
		});

		expect(startStudySessionMock).not.toHaveBeenCalled();
		expect(getStudySessionStateMock).toHaveBeenCalledWith("session-9");
	});

	it("deckId が一致しないセッションを指定した場合は notFound する", async () => {
		getStudySessionStateMock.mockResolvedValue({
			deckId: "deck-other",
			deckName: "別デッキ",
			phase: "front",
			card: {
				sessionId: "session-x",
				cardId: "card-1",
				skill: "reading",
				pattern: "R1",
				frontText: "温かい",
				progress: { current: 1, total: 5, remaining: 5 },
			},
		});

		await expect(
			StudyPage({
				params: { deckId: "deck-1" },
				searchParams: { session: "session-x" },
			})
		).rejects.toThrowError("NEXT_NOT_FOUND");
		expect(notFoundMock).toHaveBeenCalledTimes(1);
	});

	it("開始時点で完了状態なら complete 初期状態を StudyClient に渡す", async () => {
		startStudySessionMock.mockResolvedValue({
			status: "completed",
			deckId: "deck-1",
			deckName: "小学3年生の漢字",
			summary: {
				message: "今日の学習は完了しています",
				studiedUniqueCards: 0,
			},
		});

		const html = renderToStaticMarkup(
			await StudyPage({
				params: { deckId: "deck-1" },
			})
		);

		expect(html).toContain("小学3年生の漢字");
		expect(getStudySessionStateMock).not.toHaveBeenCalled();
		expect(STUDY_PAGE_TITLE).toBe("学習セッション");
		expect(STUDY_COMPLETE_FROM_START_MESSAGE).toBe("今日の学習は完了しています");
	});
});
