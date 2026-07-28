import { getDeckLearningMetrics, getDeckOverview } from "@/actions/deck-actions";
import { DeckStudyLimitForm } from "@/components/deck/DeckStudyLimitForm";
import { LearningMetricsPanel } from "@/components/deck/LearningMetricsPanel";
import { getTodayJST } from "@/lib/date";
import {
	DECK_LABEL_NEW,
	DECK_LABEL_REVIEW,
	DECK_LABEL_STUDIED_TODAY,
	resolveDeckStudyStatus,
} from "@/lib/deck/study-status";
import { isAiCardImportEnabled } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";

// 完了・上限到達・カード未登録の文言は一覧と共有する（FR-11）。@/lib/deck/study-status を正本とする。
export const DECK_OVERVIEW_START_LABEL = "はじめる";

/**
 * 開始できない理由の文言 id。バナー（done / limit-reached）とボタン下（no-cards）は
 * 排他的に描画されるため、どちらか一方だけがこの id を持ち、disabled ボタンから常に参照できる。
 */
const STUDY_STATUS_MESSAGE_ID = "deck-study-status-message";

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

	const today = getTodayJST();
	const metrics = await getDeckLearningMetrics(params.deckId);
	const status = resolveDeckStudyStatus({
		totalCards: overview.totalCards,
		todayCount: overview.counts.total,
		studiedToday: overview.studiedToday,
		dailyStudyLimit: overview.dailyStudyLimit,
		nextDueDate: overview.nextDueDate,
		today,
	});
	const canStartStudy = status.kind === "todo";
	// 完了・上限到達では 0 の羅列ではなく完了メッセージを主表示にする（FR-03 / AC-2）。
	const showCompletionBanner = status.kind === "done" || status.kind === "limit-reached";
	const reviewCount = overview.counts.learn + overview.counts.due;
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
				{showCompletionBanner ? (
					<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
						<p id={STUDY_STATUS_MESSAGE_ID} className="text-base font-bold text-amber-900">
							{status.message}
						</p>
						{status.nextDueMessage === null ? null : (
							<p className="mt-1 text-sm text-amber-800">{status.nextDueMessage}</p>
						)}
					</div>
				) : null}
				<div className="mt-3 grid grid-cols-3 gap-3">
					<StatCard
						label={DECK_LABEL_NEW}
						value={overview.counts.new}
						tone={overview.counts.new === 0 ? "text-slate-500" : "text-blue-600"}
					/>
					<StatCard
						label={DECK_LABEL_REVIEW}
						value={reviewCount}
						tone={reviewCount === 0 ? "text-slate-500" : "text-green-600"}
					/>
					<StatCard
						label={DECK_LABEL_STUDIED_TODAY}
						value={overview.studiedToday}
						tone={overview.studiedToday === 0 ? "text-slate-500" : "text-amber-700"}
					/>
				</div>
				<p className="mt-4 text-center text-sm font-medium text-slate-700">
					今日やること {overview.counts.total}枚 / 今日やれる残り {status.remainingToday}枚
				</p>
			</section>

			<LearningMetricsPanel status={status} metrics={metrics} />

			<section className="mt-6" aria-labelledby="whole-study-heading">
				<h2 id="whole-study-heading" className="text-sm font-bold text-slate-800">
					これまでの記録
				</h2>
				<div className="mt-3 grid grid-cols-3 gap-3">
					<StatCard label="カード総数" value={overview.totalCards} tone="text-slate-900" />
					<StatCard label="学習した数" value={overview.learnedCards} tone="text-indigo-700" />
					<StatCard label="つぎの予定" value={overview.scheduledCards} tone="text-amber-700" />
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
							aria-describedby={STUDY_STATUS_MESSAGE_ID}
							className="h-14 w-full rounded-xl bg-slate-300 text-base font-semibold text-slate-600"
						>
							{DECK_OVERVIEW_START_LABEL}
						</button>
						{/* done / limit-reached は「今日の学習」先頭のバナーが主表示のため、ここでは重複表示しない。 */}
						{status.kind === "no-cards" ? (
							<p id={STUDY_STATUS_MESSAGE_ID} className="mt-3 text-center text-sm text-slate-600">
								{status.message}
							</p>
						) : null}
					</>
				)}
			</div>

			<section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
				<h2 className="text-sm font-bold text-slate-800">学習設定</h2>
				<p className="mt-1 text-sm text-slate-600">
					{`一日最大 ${overview.dailyStudyLimit}枚 / ${DECK_LABEL_STUDIED_TODAY} ${overview.studiedToday}枚`}
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
