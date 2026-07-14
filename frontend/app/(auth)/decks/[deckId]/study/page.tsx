import { getStudySessionState, startStudySession } from "@/actions/session-actions";
import { STUDY_SESSION_EMPTY_MESSAGE } from "@/actions/session-contracts";
import { StudyClient } from "@/components/study/StudyClient";
import { notFound } from "next/navigation";

export const STUDY_PAGE_TITLE = "学習セッション";
export const STUDY_COMPLETE_FROM_START_MESSAGE = STUDY_SESSION_EMPTY_MESSAGE;

type StudyPlaceholderPageProps = {
	params: {
		deckId: string;
	};
	searchParams?: {
		session?: string;
	};
};

export default async function StudyPage({ params, searchParams }: StudyPlaceholderPageProps) {
	const sessionId = typeof searchParams?.session === "string" ? searchParams.session : null;

	if (!sessionId) {
		const startResult = await startStudySession(params.deckId);
		if (startResult.status === "completed") {
			return (
				<StudyClient
					deckId={startResult.deckId}
					deckName={startResult.deckName}
					initialState={{
						deckId: startResult.deckId,
						deckName: startResult.deckName,
						phase: "complete",
						summary: startResult.summary,
					}}
				/>
			);
		}

		const startedState = await getStudySessionState(startResult.sessionId);
		if (startedState.deckId !== params.deckId) {
			notFound();
		}

		return (
			<StudyClient
				deckId={startedState.deckId}
				deckName={startedState.deckName}
				initialState={startedState}
			/>
		);
	}

	const sessionState = await getStudySessionState(sessionId);
	if (sessionState.deckId !== params.deckId) {
		notFound();
	}

	return (
		<StudyClient
			deckId={sessionState.deckId}
			deckName={sessionState.deckName}
			initialState={sessionState}
		/>
	);
}
