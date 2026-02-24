"use client";

import {
	type CardBackData,
	type CardFrontData,
	type StudySessionState,
	type StudySummary,
	rateCard,
	revealCard,
} from "@/actions/session-actions";
import type { Rating } from "@/lib/srs/types";
import { useMemo, useState, useTransition } from "react";

import { CardBack } from "./CardBack";
import { CardFront } from "./CardFront";
import { SessionComplete } from "./SessionComplete";

type StudyClientProps = {
	deckId: string;
	deckName: string;
	initialState: StudySessionState;
};

type StudyState =
	| { phase: "front"; card: CardFrontData }
	| { phase: "back"; card: CardFrontData; backData: CardBackData }
	| { phase: "complete"; summary: StudySummary }
	| { phase: "loading" };

const toInitialStudyState = (initialState: StudySessionState): StudyState => {
	switch (initialState.phase) {
		case "front":
			return { phase: "front", card: initialState.card };
		case "back":
			return { phase: "back", card: initialState.card, backData: initialState.backData };
		case "complete":
			return { phase: "complete", summary: initialState.summary };
	}
};

export function StudyClient({ deckId, deckName, initialState }: StudyClientProps) {
	const [state, setState] = useState<StudyState>(toInitialStudyState(initialState));
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const currentSessionId = useMemo(() => {
		if (state.phase === "front" || state.phase === "back") {
			return state.card.sessionId;
		}

		return null;
	}, [state]);

	const handleReveal = () => {
		if (state.phase !== "front") {
			return;
		}

		const currentCard = state.card;
		setErrorMessage(null);
		setState({ phase: "loading" });

		startTransition(() => {
			revealCard(currentCard.sessionId)
				.then((backData) => {
					setState({
						phase: "back",
						card: currentCard,
						backData,
					});
				})
				.catch(() => {
					setErrorMessage("答えの表示に失敗しました。もう一度ためしてください。");
					setState({
						phase: "front",
						card: currentCard,
					});
				});
		});
	};

	const handleRate = (rating: Rating) => {
		if (state.phase !== "back") {
			return;
		}

		const previousState = state;
		setErrorMessage(null);
		setState({ phase: "loading" });

		startTransition(() => {
			rateCard(previousState.card.sessionId, rating)
				.then((result) => {
					if (result.nextCard) {
						setState({
							phase: "front",
							card: result.nextCard,
						});
						return;
					}

					setState({
						phase: "complete",
						summary: result.summary ?? {
							message: "今日の学習おわり！",
							studiedUniqueCards: previousState.card.progress.total,
						},
					});
				})
				.catch(() => {
					setErrorMessage("評価の保存に失敗しました。もう一度ためしてください。");
					setState(previousState);
				});
		});
	};

	return (
		<main className="mx-auto w-full max-w-lg px-4 py-2">
			{errorMessage ? (
				<div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{errorMessage}
				</div>
			) : null}

			{state.phase === "front" ? (
				<CardFront
					card={state.card}
					deckId={deckId}
					deckName={deckName}
					disabled={isPending}
					onReveal={handleReveal}
				/>
			) : null}

			{state.phase === "back" ? (
				<CardBack
					card={state.card}
					backData={state.backData}
					deckId={deckId}
					deckName={deckName}
					disabled={isPending}
					onRate={handleRate}
				/>
			) : null}

			{state.phase === "complete" ? (
				<SessionComplete deckName={deckName} summary={state.summary} />
			) : null}

			{state.phase === "loading" ? (
				<div className="flex min-h-[60dvh] items-center justify-center">
					<div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
						読み込み中...
					</div>
				</div>
			) : null}

			{currentSessionId ? (
				<p className="sr-only" data-session-id={currentSessionId}>
					session
				</p>
			) : null}
		</main>
	);
}
