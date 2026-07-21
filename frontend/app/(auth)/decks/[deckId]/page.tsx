import { getDeckOverview } from "@/actions/deck-actions";
import { DeckStudyLimitForm } from "@/components/deck/DeckStudyLimitForm";
import { isAiCardImportEnabled } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";

export const DECK_OVERVIEW_EMPTY_MESSAGE = "今日の学習は完了しています";
export const DECK_OVERVIEW_LIMIT_REACHED_MESSAGE = "今日の学習上限に達しています。";
export const DECK_OVERVIEW_SCHEDULED_MESSAGE = "今日の学習はありません。次の予定カードがあります。";
export const DECK_OVERVIEW_NO_CARDS_MESSAGE = "カードがまだありません";
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

	const canStartStudy = overview.counts.total > 0 && overview.remainingToday > 0;
	const completeMessage =
		overview.totalCards === 0
			? DECK_OVERVIEW_NO_CARDS_MESSAGE
			: overview.counts.total > 0 && overview.remainingToday === 0
				? DECK_OVERVIEW_LIMIT_REACHED_MESSAGE
				: overview.scheduledCards > 0
					? DECK_OVERVIEW_SCHEDULED_MESSAGE
					: DECK_OVERVIEW_EMPTY_MESSAGE;
	const studyHref = `/decks/${overview.id}/study`;

	return (
		<main className="mx-auto w-full max-w-lg px-4 py-6">
			<Link href="/decks" className="text-sm font-medium text-slate-600 hover:text-slate-900">
				← デッキ一覧へ
			</Link>
			<h1 className="mt-3 text-2xl font-bold text-slate-900">{overview.name}</h1>

			<section className="mt-5" aria-labelledby="today-study-heading">
				<h2 id="today-study-heading" className="text-sm font-bold text-slate-800">
					今日の学習
				</h2>
				<div className="mt-3 grid grid-cols-3 gap-3">
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
				</div>
				<p className="mt-4 text-center text-sm font-medium text-slate-700">
					今日のカード: {overview.counts.total}枚 / 残り枠: {overview.remainingToday}枚
				</p>
			</section>

			<section className="mt-6" aria-labelledby="whole-study-heading">
				<h2 id="whole-study-heading" className="text-sm font-bold text-slate-800">
					全体状態
				</h2>
				<div className="mt-3 grid grid-cols-3 gap-3">
					<StatCard label="カード総数" value={overview.totalCards} tone="text-slate-900" />
					<StatCard label="学習済み" value={overview.learnedCards} tone="text-indigo-700" />
					<StatCard label="将来予定" value={overview.scheduledCards} tone="text-amber-700" />
				</div>
			</section>

			<div className="mt-6">
				{canStartStudy ? (
					<Link
						href={studyHref}
						className="flex h-14 w-full items-center justify-center rounded-xl bg-blue-600 text-base font-semibold text-white transition hover:bg-blue-700"
					>
						{DECK_OVERVIEW_START_LABEL}
					</Link>
				) : (
					<>
						<button
							type="button"
							disabled
							className="h-14 w-full rounded-xl bg-slate-300 text-base font-semibold text-slate-600"
						>
							{DECK_OVERVIEW_START_LABEL}
						</button>
						<p className="mt-3 text-center text-sm text-slate-600">{completeMessage}</p>
					</>
				)}
			</div>

			<section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
				<h2 className="text-sm font-bold text-slate-800">学習設定</h2>
				<p className="mt-1 text-sm text-slate-600">
					一日最大 {overview.dailyStudyLimit}枚 / 今日の学習済み {overview.studiedToday}枚
				</p>
				<DeckStudyLimitForm
					key={`${overview.id}:${overview.dailyStudyLimit}`}
					deckId={overview.id}
					dailyStudyLimit={overview.dailyStudyLimit}
					newLimitPerDay={overview.newLimitPerDay}
				/>
			</section>

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
