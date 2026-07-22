"use client";

import type { CardBackData, CardFrontData } from "@/actions/session-actions";
import type { Rating } from "@/lib/srs/types";
import Link from "next/link";

import { IllustrationDisplay } from "./IllustrationDisplay";
import { MnemonicExplanation } from "./MnemonicExplanation";
import { RatingButtons } from "./RatingButtons";

type CardBackProps = {
	card: CardFrontData;
	backData: CardBackData;
	deckName: string;
	deckId: string;
	disabled?: boolean;
	onRate: (rating: Rating) => void;
};

export function CardBack({
	card,
	backData,
	deckName,
	deckId,
	disabled = false,
	onRate,
}: CardBackProps) {
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

			<div className="flex flex-1 flex-col">
				<div className="flex flex-1 flex-col items-center justify-center text-center">
					<p className="text-3xl font-semibold text-slate-900">{backData.frontText}</p>
					<p className="mt-2 text-4xl font-bold text-blue-700">{backData.backText}</p>
					<IllustrationDisplay
						illustrationStatus={backData.illustrationStatus}
						illustrationUrl={backData.illustrationUrl}
					/>
					<MnemonicExplanation
						illustrationStatus={backData.illustrationStatus}
						explanation={backData.explanation}
					/>
				</div>

				<div className="pb-2">
					<RatingButtons
						intervalPreview={backData.intervalPreview}
						disabled={disabled}
						onRate={onRate}
					/>
				</div>
			</div>
		</div>
	);
}
