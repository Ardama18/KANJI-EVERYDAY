import { describe, expect, it } from "vitest";

import {
	buildRecentJstDateWindow,
	summarizeDeckLearningMetrics,
	summarizeRatingBreakdown,
} from "@/lib/deck/learning-metrics";

const TODAY = "2026-02-24";

describe("frontend/src/lib/deck/learning-metrics.ts", () => {
	it("buildRecentJstDateWindow returns seven JST dates ending today", () => {
		expect(buildRecentJstDateWindow(TODAY)).toEqual([
			"2026-02-18",
			"2026-02-19",
			"2026-02-20",
			"2026-02-21",
			"2026-02-22",
			"2026-02-23",
			"2026-02-24",
		]);
	});

	it("summarizeRatingBreakdown counts rating labels and returns integer rates", () => {
		expect(
			summarizeRatingBreakdown([
				{ lastRating: "again" },
				{ lastRating: "hard" },
				{ lastRating: "good" },
				{ lastRating: "good" },
				{ lastRating: "unknown" },
				{ lastRating: null },
			])
		).toEqual({
			total: 4,
			again: 1,
			hard: 1,
			good: 2,
			againRate: 25,
			hardRate: 25,
			goodRate: 50,
		});
	});

	it("summarizeRatingBreakdown uses null rates when the denominator is zero", () => {
		expect(summarizeRatingBreakdown([{ lastRating: null }])).toEqual({
			total: 0,
			again: 0,
			hard: 0,
			good: 0,
			againRate: null,
			hardRate: null,
			goodRate: null,
		});
	});

	it("summarizes recent sessions, latest ratings, and JST boundary dates", () => {
		const result = summarizeDeckLearningMetrics({
			today: TODAY,
			deckCardIds: ["card-again", "card-hard", "card-good", "card-outside"],
			studySessions: [
				{ id: "session-before-jst-midnight", finishedAt: "2026-02-23T14:59:59.999Z" },
				{ id: "session-after-jst-midnight", finishedAt: "2026-02-23T15:00:00.000Z" },
				{ id: "session-unfinished", finishedAt: null },
				{ id: "session-outside", finishedAt: "2026-02-10T00:00:00.000Z" },
			],
			reviewStates: [
				{
					cardId: "card-again",
					lastRating: "again",
					lastReviewedAt: "2026-02-18T03:00:00.000Z",
				},
				{
					cardId: "card-hard",
					lastRating: "hard",
					lastReviewedAt: "2026-02-23T15:00:00.000Z",
				},
				{
					cardId: "card-good",
					lastRating: "good",
					lastReviewedAt: "2026-02-24T03:00:00.000Z",
				},
				{
					cardId: "card-outside",
					lastRating: "good",
					lastReviewedAt: "2026-02-10T00:00:00.000Z",
				},
			],
			cards: [
				{ id: "card-again", illustrationKey: "key-1" },
				{ id: "card-hard", illustrationKey: null },
				{ id: "card-good", illustrationKey: "key-2" },
				{ id: "card-outside", illustrationKey: "key-3" },
			],
			approvedMnemonicKeys: ["key-1", "key-2"],
		});

		expect(result).toMatchObject({
			contractVersion: 1,
			today: TODAY,
			windowStart: "2026-02-18",
			windowEnd: TODAY,
			activeDays: 3,
			latestRatings: {
				total: 3,
				again: 1,
				hard: 1,
				good: 1,
				againRate: 33,
				hardRate: 33,
				goodRate: 33,
			},
			mnemonicTrend: {
				withMnemonic: {
					total: 2,
					again: 1,
					hard: 0,
					good: 1,
					againRate: 50,
					hardRate: 0,
					goodRate: 50,
				},
				withoutMnemonic: {
					total: 1,
					again: 0,
					hard: 1,
					good: 0,
					againRate: 0,
					hardRate: 100,
					goodRate: 0,
				},
				comparable: true,
			},
		});
		expect(result.recentDays).toEqual([
			{ date: "2026-02-18", completedSessions: 0, reviewedCards: 1 },
			{ date: "2026-02-19", completedSessions: 0, reviewedCards: 0 },
			{ date: "2026-02-20", completedSessions: 0, reviewedCards: 0 },
			{ date: "2026-02-21", completedSessions: 0, reviewedCards: 0 },
			{ date: "2026-02-22", completedSessions: 0, reviewedCards: 0 },
			{ date: "2026-02-23", completedSessions: 1, reviewedCards: 0 },
			{ date: "2026-02-24", completedSessions: 1, reviewedCards: 2 },
		]);
	});

	it("ignores invalid timestamps, outside-window rows, unknown ratings, and non-deck cards", () => {
		const result = summarizeDeckLearningMetrics({
			today: TODAY,
			deckCardIds: ["card-1"],
			studySessions: [
				{ id: "invalid", finishedAt: "not-a-date" },
				{ id: "outside", finishedAt: "2026-01-01T00:00:00.000Z" },
			],
			reviewStates: [
				{ cardId: "card-1", lastRating: "good", lastReviewedAt: "not-a-date" },
				{ cardId: "card-1", lastRating: "unknown", lastReviewedAt: "2026-02-23T15:00:00.000Z" },
				{ cardId: "other-card", lastRating: "again", lastReviewedAt: "2026-02-23T15:00:00.000Z" },
			],
			cards: [{ id: "card-1", illustrationKey: "key-1" }],
			approvedMnemonicKeys: ["key-1"],
		});

		expect(result.activeDays).toBe(0);
		expect(result.latestRatings.total).toBe(0);
		expect(result.recentDays.every((day) => day.completedSessions === 0)).toBe(true);
		expect(result.recentDays.every((day) => day.reviewedCards === 0)).toBe(true);
		expect(result.mnemonicTrend.comparable).toBe(false);
	});

	it("keeps the most recent reviewed row when duplicate fixture rows exist for one card", () => {
		const result = summarizeDeckLearningMetrics({
			today: TODAY,
			deckCardIds: ["card-1"],
			studySessions: [],
			reviewStates: [
				{
					cardId: "card-1",
					lastRating: "again",
					lastReviewedAt: "2026-02-20T00:00:00.000Z",
				},
				{
					cardId: "card-1",
					lastRating: "good",
					lastReviewedAt: "2026-02-23T15:00:00.000Z",
				},
			],
			cards: [{ id: "card-1", illustrationKey: null }],
			approvedMnemonicKeys: [],
		});

		expect(result.latestRatings).toMatchObject({
			total: 1,
			again: 0,
			hard: 0,
			good: 1,
			goodRate: 100,
		});
		expect(result.recentDays.at(-1)).toMatchObject({ date: TODAY, reviewedCards: 1 });
	});

	it("renders safely shaped metrics for card0, session0, review0, and non-comparable mnemonic data", () => {
		const result = summarizeDeckLearningMetrics({
			today: TODAY,
			deckCardIds: [],
			studySessions: [],
			reviewStates: [],
			cards: [],
			approvedMnemonicKeys: [],
		});

		expect(result.activeDays).toBe(0);
		expect(result.recentDays).toHaveLength(7);
		expect(result.latestRatings.total).toBe(0);
		expect(result.latestRatings.goodRate).toBeNull();
		expect(result.mnemonicTrend.withMnemonic.total).toBe(0);
		expect(result.mnemonicTrend.withoutMnemonic.total).toBe(0);
		expect(result.mnemonicTrend.comparable).toBe(false);
	});
});
