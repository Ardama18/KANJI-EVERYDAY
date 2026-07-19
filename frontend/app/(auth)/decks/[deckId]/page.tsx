import { getDeckOverview } from "@/actions/deck-actions";
import { isAiCardImportEnabled } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";

export const DECK_OVERVIEW_EMPTY_MESSAGE = "今日の学習は完了しています";
export const DECK_OVERVIEW_START_LABEL = "はじめる";

type DeckOverviewPageProps = {
	params: {
		deckId: string;
	};
};

const StatCard = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
	<div className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-sm">
		<p className="text-xs font-medium text-slate-500">{label}</p>
		<p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
	</div>
);

export default async function DeckOverviewPage({ params }: DeckOverviewPageProps) {
	const overview = await getDeckOverview(params.deckId);
	if (!overview) {
		notFound();
	}

	const isComplete = overview.counts.total === 0;
	const studyHref = `/decks/${overview.id}/study`;

	return (
		<main className="mx-auto w-full max-w-lg px-4 py-6">
			<Link href="/decks" className="text-sm font-medium text-slate-600 hover:text-slate-900">
				← デッキ一覧へ
			</Link>
			<h1 className="mt-3 text-2xl font-bold text-slate-900">{overview.name}</h1>

			<section className="mt-5 grid grid-cols-3 gap-3">
				<StatCard
					label="New"
					value={overview.counts.new}
					tone={overview.counts.new === 0 ? "text-slate-500" : "text-blue-600"}
				/>
				<StatCard
					label="Learn"
					value={overview.counts.learn}
					tone={overview.counts.learn === 0 ? "text-slate-500" : "text-red-600"}
				/>
				<StatCard
					label="Due"
					value={overview.counts.due}
					tone={overview.counts.due === 0 ? "text-slate-500" : "text-green-600"}
				/>
			</section>

			<p className="mt-4 text-center text-sm font-medium text-slate-700">
				今日のカード: {overview.counts.total}枚
			</p>

			<div className="mt-6">
				{isComplete ? (
					<>
						<button
							type="button"
							disabled
							className="h-14 w-full rounded-xl bg-slate-300 text-base font-semibold text-slate-600"
						>
							{DECK_OVERVIEW_START_LABEL}
						</button>
						<p className="mt-3 text-center text-sm text-slate-600">{DECK_OVERVIEW_EMPTY_MESSAGE}</p>
					</>
				) : (
					<Link
						href={studyHref}
						className="flex h-14 w-full items-center justify-center rounded-xl bg-blue-600 text-base font-semibold text-white transition hover:bg-blue-700"
					>
						{DECK_OVERVIEW_START_LABEL}
					</Link>
				)}
			</div>

			{isAiCardImportEnabled() ? (
				<Link
					href={`/decks/${overview.id}/ai/new`}
					className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border border-blue-600 px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
				>
					AIでカードを作る
				</Link>
			) : null}
		</main>
	);
}
