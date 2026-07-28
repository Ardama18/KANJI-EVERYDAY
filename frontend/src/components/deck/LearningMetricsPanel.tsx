import type {
	DeckLearningMetrics,
	LearningMetricRatingBreakdown,
} from "@/lib/deck/learning-metrics";
import type { DeckStudyStatus } from "@/lib/deck/study-status";

type LearningMetricsPanelProps = Readonly<{
	status: DeckStudyStatus;
	metrics: DeckLearningMetrics | null;
}>;

const RATING_LABELS: readonly Readonly<{
	key: keyof Pick<LearningMetricRatingBreakdown, "again" | "hard" | "good">;
	label: string;
}>[] = [
	{ key: "again", label: "むり" },
	{ key: "hard", label: "あやしい" },
	{ key: "good", label: "できた" },
];

export function LearningMetricsPanel({ status, metrics }: LearningMetricsPanelProps) {
	const todayMessage = formatTodayStatusMessage(status);

	return (
		<section
			className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
			aria-labelledby="learning-metrics-heading"
		>
			<h2 id="learning-metrics-heading" className="text-sm font-bold text-slate-800">
				最近の学習メモ
			</h2>
			<p className="mt-2 text-sm text-slate-700">
				今日: <span className="font-medium text-slate-900">{todayMessage}</span>
			</p>

			{metrics === null ? (
				<p className="mt-3 text-sm text-slate-600">
					最近の学習メモを読み込めませんでした。時間をおいて再度確認してください。
				</p>
			) : (
				<>
					<p className="mt-3 text-sm text-slate-700">
						直近7日:{" "}
						<span className="font-medium text-slate-900">
							学習した日 {metrics.activeDays}日 / 7日
						</span>
					</p>
					<ol className="mt-3 grid grid-cols-7 gap-1" aria-label="直近7日の日別学習実績">
						{metrics.recentDays.map((day) => (
							<li
								key={day.date}
								className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-1 py-2 text-center"
							>
								<span className="block truncate text-[11px] font-medium text-slate-500">
									{formatDayLabel(day.date)}
								</span>
								<span className="mt-1 block text-sm font-bold text-slate-900">
									{day.completedSessions}
								</span>
								<span className="block text-[10px] text-slate-500">完了</span>
								<span className="block truncate text-[10px] text-slate-500">
									評価 {day.reviewedCards}
								</span>
							</li>
						))}
					</ol>

					<div className="mt-4 border-t border-slate-100 pt-4">
						<p className="text-sm font-medium text-slate-800">最新評価</p>
						{metrics.latestRatings.total === 0 ? (
							<p className="mt-1 text-sm text-slate-600">
								直近7日に評価されたカードはまだありません。
							</p>
						) : (
							<div className="mt-2 grid grid-cols-3 gap-2">
								{RATING_LABELS.map((rating) => (
									<div key={rating.key} className="min-w-0 rounded-md bg-slate-50 px-2 py-2">
										<p className="truncate text-xs text-slate-500">{rating.label}</p>
										<p className="mt-1 text-lg font-bold text-slate-900">
											{metrics.latestRatings[rating.key]}
											<span className="ml-0.5 text-xs font-medium text-slate-500">枚</span>
										</p>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="mt-4 border-t border-slate-100 pt-4">
						<p className="text-sm font-medium text-slate-800">ニーモニック傾向</p>
						{metrics.mnemonicTrend.comparable ? (
							<p className="mt-1 text-sm text-slate-700">
								あり: できた {formatRate(metrics.mnemonicTrend.withMnemonic.goodRate)} / なし:
								できた {formatRate(metrics.mnemonicTrend.withoutMnemonic.goodRate)}
							</p>
						) : (
							<p className="mt-1 text-sm text-slate-600">比較できる学習データがまだありません。</p>
						)}
					</div>
				</>
			)}
		</section>
	);
}

function formatDayLabel(date: string): string {
	const [, month, day] = date.split("-");
	return `${Number(month)}/${Number(day)}`;
}

function formatRate(value: number | null): string {
	return value === null ? "まだありません" : `${value}%`;
}

function formatTodayStatusMessage(status: DeckStudyStatus): string {
	switch (status.kind) {
		case "no-cards":
			return "カードがまだありません";
		case "todo":
			return "今日やることがあります";
		case "limit-reached":
			return "今日の上限まで学習済みです";
		case "done":
			return "今日の対象はありません";
	}
}
