"use client";

import type { CardBackData, CardFrontData } from "@/actions/session-actions";
import type { Rating } from "@/lib/srs/types";
import Link from "next/link";

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

					<div className="mt-6 flex h-28 w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
						イラスト準備中
					</div>
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
