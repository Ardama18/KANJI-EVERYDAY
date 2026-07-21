import type { DeckWithCounts } from "@/actions/deck-actions";
import Link from "next/link";

type DeckCardProps = {
	deck: DeckWithCounts;
};

type BadgeKind = "new" | "learn" | "due";

const badgeClassByKind: Record<BadgeKind, string> = {
	new: "bg-blue-500 text-white",
	learn: "bg-red-500 text-white",
	due: "bg-green-500 text-white",
};

const zeroBadgeClass = "bg-slate-200 text-slate-700";

const CountBadge = ({ label, value, kind }: { label: string; value: number; kind: BadgeKind }) => {
	const toneClass = value === 0 ? zeroBadgeClass : badgeClassByKind[kind];

	return (
		<span
			className={`inline-flex min-w-[4.5rem] items-center justify-between rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass}`}
		>
			<span>{label}</span>
			<span>{value}</span>
		</span>
	);
};

export function DeckCard({ deck }: DeckCardProps) {
	return (
		<Link
			href={`/decks/${deck.id}`}
			className="flex min-h-[88px] flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
		>
			<span className="min-w-0">
				<span className="block break-words text-base font-semibold text-slate-900">
					{deck.name}
				</span>
				<span className="mt-1 block text-sm text-slate-600">
					カード {deck.totalCards}枚 / 学習済み {deck.learnedCards}枚 / 予定 {deck.scheduledCards}枚
				</span>
			</span>
			<span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
				<CountBadge label="New" value={deck.counts.new} kind="new" />
				<CountBadge label="Learn" value={deck.counts.learn} kind="learn" />
				<CountBadge label="Due" value={deck.counts.due} kind="due" />
			</span>
		</Link>
	);
}
