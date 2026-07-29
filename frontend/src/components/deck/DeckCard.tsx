import type { DeckWithCounts } from "@/actions/deck-actions";
import {
	DECK_LABEL_NEW,
	DECK_LABEL_REVIEW,
	DECK_LABEL_STUDIED_TODAY,
	resolveDeckStudyStatus,
} from "@/lib/deck/study-status";
import Link from "next/link";

import { DeleteDeckForm } from "./DeleteDeckForm";

type DeckCardProps = {
	deck: DeckWithCounts;
	/** Server 側で決めた JST の今日。Client で現在時刻を評価しないため props で受け取る（NFR-03）。 */
	today: string;
};

type BadgeKind = "new" | "review";

const badgeClassByKind: Record<BadgeKind, string> = {
	new: "bg-blue-500 text-white",
	review: "bg-green-500 text-white",
};

const zeroBadgeClass = "bg-slate-200 text-slate-700";

const CountBadge = ({ label, value, kind }: { label: string; value: number; kind: BadgeKind }) => {
	const toneClass = value === 0 ? zeroBadgeClass : badgeClassByKind[kind];

	return (
		<span
			className={`inline-flex min-w-[4.5rem] items-center justify-between gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass}`}
		>
			<span>{label}</span>
			<span>{value}</span>
		</span>
	);
};

const StudiedTodayPill = ({ value }: { value: number }) => (
	<span
		className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
			value === 0 ? zeroBadgeClass : "bg-amber-100 text-amber-800"
		}`}
	>
		<span>{DECK_LABEL_STUDIED_TODAY}</span>
		<span>{value}枚</span>
	</span>
);

export function DeckCard({ deck, today }: DeckCardProps) {
	const status = resolveDeckStudyStatus({
		totalCards: deck.totalCards,
		todayCount: deck.counts.new + deck.counts.learn + deck.counts.due,
		studiedToday: deck.studiedToday,
		dailyStudyLimit: deck.dailyStudyLimit,
		nextDueDate: deck.nextDueDate,
		today,
	});
	const reviewCount = deck.counts.learn + deck.counts.due;

	return (
		<article className="flex min-h-[88px] flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
			<Link
				href={`/decks/${deck.id}`}
				className="min-w-0 flex-1 rounded-md transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
			>
				<span className="block min-w-0">
					<span className="block break-words text-base font-semibold text-slate-900">
						{deck.name}
					</span>
					<span className="mt-1 block text-sm text-slate-600">
						カード {deck.totalCards}枚 ・ 学習した {deck.learnedCards}枚
					</span>
				</span>
				<span className="mt-3 flex flex-wrap items-center gap-2 sm:justify-start">
					{status.kind === "todo" ? (
						<span className="flex flex-wrap items-center gap-1.5">
							<CountBadge label={DECK_LABEL_NEW} value={deck.counts.new} kind="new" />
							<CountBadge label={DECK_LABEL_REVIEW} value={reviewCount} kind="review" />
						</span>
					) : (
						<span className="flex flex-col">
							<span className="text-sm font-medium text-slate-700">{status.message}</span>
							{status.nextDueMessage === null ? null : (
								<span className="text-xs text-slate-500">{status.nextDueMessage}</span>
							)}
						</span>
					)}
					<StudiedTodayPill value={deck.studiedToday} />
				</span>
			</Link>
			<div className="sm:ml-4">
				<DeleteDeckForm deckId={deck.id} deckName={deck.name} />
			</div>
		</article>
	);
}
