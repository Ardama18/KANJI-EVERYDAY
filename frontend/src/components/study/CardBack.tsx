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
		<div className="flex h-[calc(100dvh-5rem)] flex-col">
			<header className="flex shrink-0 items-center justify-between py-2">
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

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 pt-4">
					<div className="flex min-h-full flex-col items-center justify-center text-center">
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
				</div>

				<div
					data-testid="study-rating-actions"
					className="sticky bottom-0 z-10 -mx-1 shrink-0 bg-gradient-to-t from-white via-white to-white/80 px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3"
				>
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
