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
			className="flex min-h-[72px] items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
		>
			<span className="text-base font-semibold text-slate-900">{deck.name}</span>
			<span className="ml-3 flex flex-wrap items-center justify-end gap-1.5">
				<CountBadge label="New" value={deck.counts.new} kind="new" />
				<CountBadge label="Learn" value={deck.counts.learn} kind="learn" />
				<CountBadge label="Due" value={deck.counts.due} kind="due" />
			</span>
		</Link>
	);
}
