"use client";

import type { CardFrontData } from "@/actions/session-actions";
import Link from "next/link";

type CardFrontProps = {
	card: CardFrontData;
	deckName: string;
	deckId: string;
	disabled?: boolean;
	onReveal: () => void;
};

const getPromptLabel = (pattern: CardFrontData["pattern"]): string => {
	return pattern === "R1" ? "よみがなは？" : "かんじでかくと？";
};

export function CardFront({ card, deckName, deckId, disabled = false, onReveal }: CardFrontProps) {
	return (
		<div className="flex min-h-[calc(100dvh-2rem)] flex-col">
			<header className="flex items-center justify-between py-2">
				<Link
					href={`/decks/${deckId}`}
					className="text-sm font-medium text-slate-600 hover:text-slate-900"
				>
					← {deckName}
				</Link>
				<p className="text-sm font-semibold text-slate-700">
					{card.progress.current} / {card.progress.total}
				</p>
			</header>

			<div className="flex flex-1 flex-col items-center justify-center text-center">
				<p className="text-sm font-medium text-slate-500">{getPromptLabel(card.pattern)}</p>
				<p className="mt-4 text-4xl font-bold text-slate-900">{card.frontText}</p>
				<p className="mt-4 text-sm text-slate-500">のこり {card.progress.remaining} 枚</p>
			</div>

			<button
				type="button"
				disabled={disabled}
				onClick={onReveal}
				className="mb-2 h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
			>
				答えを見る
			</button>
		</div>
	);
}
