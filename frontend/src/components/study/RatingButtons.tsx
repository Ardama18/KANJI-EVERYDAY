"use client";

import type { IntervalPreview, Rating } from "@/lib/srs/types";

type RatingButtonsProps = {
	intervalPreview: IntervalPreview;
	disabled?: boolean;
	onRate: (rating: Rating) => void;
};

type ButtonSpec = {
	rating: Rating;
	icon: string;
	label: string;
	hint: string;
	className: string;
};

export const RATING_BUTTON_ORDER: readonly Rating[] = ["again", "hard", "good"];

const buildButtonSpecs = (intervalPreview: IntervalPreview): ButtonSpec[] => {
	return [
		{
			rating: "again",
			icon: "❌",
			label: "むり",
			hint: intervalPreview.again.label,
			className: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
		},
		{
			rating: "hard",
			icon: "⚠️",
			label: "あやしい",
			hint: intervalPreview.hard.label,
			className: "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100",
		},
		{
			rating: "good",
			icon: "✅",
			label: "できた",
			hint: intervalPreview.good.label,
			className: "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
		},
	];
};

export function RatingButtons({ intervalPreview, disabled = false, onRate }: RatingButtonsProps) {
	const buttonSpecs = buildButtonSpecs(intervalPreview);

	return (
		<div className="grid grid-cols-3 gap-2">
			{buttonSpecs.map((button) => (
				<button
					key={button.rating}
					type="button"
					disabled={disabled}
					onClick={() => onRate(button.rating)}
					className={`flex min-h-16 flex-col items-center justify-center rounded-xl border px-2 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 ${button.className}`}
				>
					<p className="text-xl leading-none">{button.icon}</p>
					<p className="mt-1 text-sm font-semibold">{button.label}</p>
					<p className="mt-1 text-xs">{button.hint}</p>
				</button>
			))}
		</div>
	);
}
