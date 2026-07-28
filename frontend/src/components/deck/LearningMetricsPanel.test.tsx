import type { DeckLearningMetrics } from "@/lib/deck/learning-metrics";
import type { DeckStudyStatus } from "@/lib/deck/study-status";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LearningMetricsPanel } from "./LearningMetricsPanel";

const TODO_STATUS: DeckStudyStatus = {
	kind: "todo",
	remainingToday: 8,
	message: "",
	nextDueMessage: null,
};

const METRICS: DeckLearningMetrics = {
	contractVersion: 1,
	today: "2026-02-24",
	windowStart: "2026-02-18",
	windowEnd: "2026-02-24",
	activeDays: 3,
	recentDays: [
		{ date: "2026-02-18", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-19", completedSessions: 1, reviewedCards: 1 },
		{ date: "2026-02-20", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-21", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-22", completedSessions: 1, reviewedCards: 1 },
		{ date: "2026-02-23", completedSessions: 0, reviewedCards: 0 },
		{ date: "2026-02-24", completedSessions: 1, reviewedCards: 2 },
	],
	latestRatings: {
		total: 4,
		again: 1,
		hard: 1,
		good: 2,
		againRate: 25,
		hardRate: 25,
		goodRate: 50,
	},
	mnemonicTrend: {
		withMnemonic: {
			total: 2,
			again: 0,
			hard: 0,
			good: 2,
			againRate: 0,
			hardRate: 0,
			goodRate: 100,
		},
		withoutMnemonic: {
			total: 2,
			again: 1,
			hard: 1,
			good: 0,
			againRate: 50,
			hardRate: 50,
			goodRate: 0,
		},
		comparable: true,
	},
};

describe("frontend/src/components/deck/LearningMetricsPanel.tsx", () => {
	it("renders recent learning days, latest rating labels, and comparable mnemonic trend", () => {
		const html = renderToStaticMarkup(
			<LearningMetricsPanel status={TODO_STATUS} metrics={METRICS} />
		);

		expect(html).toContain("最近の学習メモ");
		expect(html).toContain("今日やることがあります");
		expect(html).toContain("学習した日 3日 / 7日");
		expect(html).toContain('aria-label="直近7日の日別学習実績"');
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
		expect(html).toContain("あり: できた 100%");
		expect(html).toContain("なし: できた 0%");
		expect(html).not.toContain("すごい");
		expect(html).not.toContain("ランキング");
	});

	it("renders safe empty-state copy for zero latest ratings and non-comparable mnemonic data", () => {
		const html = renderToStaticMarkup(
			<LearningMetricsPanel
				status={{ ...TODO_STATUS, kind: "done", message: "きょうのぶんは おわり！" }}
				metrics={{
					...METRICS,
					activeDays: 0,
					recentDays: METRICS.recentDays.map((day) => ({
						...day,
						completedSessions: 0,
						reviewedCards: 0,
					})),
					latestRatings: {
						total: 0,
						again: 0,
						hard: 0,
						good: 0,
						againRate: null,
						hardRate: null,
						goodRate: null,
					},
					mnemonicTrend: {
						...METRICS.mnemonicTrend,
						comparable: false,
					},
				}}
			/>
		);

		expect(html).toContain("今日の対象はありません");
		expect(html).toContain("学習した日 0日 / 7日");
		expect(html).toContain("直近7日に評価されたカードはまだありません。");
		expect(html).toContain("比較できる学習データがまだありません。");
	});

	it("renders a defensive fallback when metrics are missing", () => {
		const html = renderToStaticMarkup(<LearningMetricsPanel status={TODO_STATUS} metrics={null} />);

		expect(html).toContain("最近の学習メモを読み込めませんでした");
		expect(html).not.toContain("最新評価");
	});
});
