import { describe, expect, it } from "vitest";

import {
	DECK_STUDY_DONE_MESSAGE,
	DECK_STUDY_LIMIT_REACHED_MESSAGE,
	DECK_STUDY_NO_CARDS_MESSAGE,
	DECK_STUDY_NO_NEXT_DUE_MESSAGE,
	type DeckStudyStatusInput,
	formatNextDueLabel,
	resolveDeckStudyStatus,
	summarizePlannedStudy,
} from "./study-status";

const TODAY = "2026-02-24";

const createInput = (overrides: Partial<DeckStudyStatusInput> = {}): DeckStudyStatusInput => ({
	totalCards: 12,
	todayCount: 5,
	studiedToday: 0,
	dailyStudyLimit: 20,
	nextDueDate: null,
	today: TODAY,
	...overrides,
});

describe("formatNextDueLabel", () => {
	it("UT-S19-NEXT-DUE-LABEL-TOMORROW: 翌日は あした を返す", () => {
		expect(formatNextDueLabel("2026-02-25", TODAY)).toBe("あした");
	});

	it("UT-S19-NEXT-DUE-LABEL-DATE: 翌日以外は M月D日 を返す", () => {
		expect(formatNextDueLabel("2026-03-01", TODAY)).toBe("3月1日");
		expect(formatNextDueLabel("2026-02-26", TODAY)).toBe("2月26日");
	});
});

describe("resolveDeckStudyStatus", () => {
	it("UT-S19-STATUS-NO-CARDS: カード0枚は他条件より優先して no-cards を返す", () => {
		const status = resolveDeckStudyStatus(
			createInput({
				totalCards: 0,
				todayCount: 0,
				studiedToday: 20,
				dailyStudyLimit: 20,
				nextDueDate: "2026-03-01",
			})
		);

		expect(status).toEqual({
			kind: "no-cards",
			remainingToday: 0,
			message: DECK_STUDY_NO_CARDS_MESSAGE,
			nextDueMessage: null,
		});
	});

	it("UT-S19-STATUS-NO-CARDS-OVER-TODO: カード0枚は todo 条件より優先する", () => {
		const status = resolveDeckStudyStatus(
			createInput({
				totalCards: 0,
				todayCount: 3,
				studiedToday: 0,
				dailyStudyLimit: 20,
				nextDueDate: "2026-03-01",
			})
		);

		expect(status).toEqual({
			kind: "no-cards",
			remainingToday: 20,
			message: DECK_STUDY_NO_CARDS_MESSAGE,
			nextDueMessage: null,
		});
	});

	it("UT-S19-STATUS-NO-CARDS-OVER-LIMIT: カード0枚は limit-reached 条件より優先する", () => {
		const status = resolveDeckStudyStatus(
			createInput({
				totalCards: 0,
				todayCount: 3,
				studiedToday: 20,
				dailyStudyLimit: 20,
				nextDueDate: "2026-03-01",
			})
		);

		expect(status).toEqual({
			kind: "no-cards",
			remainingToday: 0,
			message: DECK_STUDY_NO_CARDS_MESSAGE,
			nextDueMessage: null,
		});
	});

	it("UT-S19-STATUS-TODO: 今日やることと残り枠があるなら todo を返す", () => {
		const status = resolveDeckStudyStatus(
			createInput({ todayCount: 5, studiedToday: 3, dailyStudyLimit: 20 })
		);

		expect(status.kind).toBe("todo");
		expect(status.remainingToday).toBe(17);
		expect(status.nextDueMessage).toBeNull();
	});

	it("UT-S19-STATUS-TODO-IGNORES-NEXT-DUE: todo では次回予定を表示しない", () => {
		const status = resolveDeckStudyStatus(createInput({ nextDueDate: "2026-03-01" }));

		expect(status.kind).toBe("todo");
		expect(status.nextDueMessage).toBeNull();
	});

	it("UT-S19-STATUS-LIMIT-REACHED: 今日やることがあっても残り枠0なら limit-reached を返す", () => {
		const status = resolveDeckStudyStatus(
			createInput({
				todayCount: 3,
				studiedToday: 20,
				dailyStudyLimit: 20,
				nextDueDate: "2026-02-25",
			})
		);

		expect(status).toEqual({
			kind: "limit-reached",
			remainingToday: 0,
			message: DECK_STUDY_LIMIT_REACHED_MESSAGE,
			nextDueMessage: "つぎは あした",
		});
	});

	it("UT-S19-STATUS-LIMIT-REACHED-NO-NEXT-DUE: 上限到達で次回予定が無いなら次回予定文言を出さない", () => {
		// limit-reached は todayCount > 0（明日やることがある）状態なので、
		// 「つぎの よていは まだないよ」を併記すると矛盾する（FR-04 / FR-05 は done 限定）。
		const status = resolveDeckStudyStatus(
			createInput({
				todayCount: 3,
				studiedToday: 20,
				dailyStudyLimit: 20,
				nextDueDate: null,
			})
		);

		expect(status).toEqual({
			kind: "limit-reached",
			remainingToday: 0,
			message: DECK_STUDY_LIMIT_REACHED_MESSAGE,
			nextDueMessage: null,
		});
	});

	it("UT-S19-STATUS-DONE: 今日やることが0でカードがあるなら done を返す", () => {
		const status = resolveDeckStudyStatus(
			createInput({ todayCount: 0, studiedToday: 12, dailyStudyLimit: 20, nextDueDate: null })
		);

		expect(status).toEqual({
			kind: "done",
			remainingToday: 8,
			message: DECK_STUDY_DONE_MESSAGE,
			nextDueMessage: DECK_STUDY_NO_NEXT_DUE_MESSAGE,
		});
	});

	it("UT-S19-STATUS-DONE-NEXT-DUE-DATE: 翌日以外の次回予定日を日付で示す", () => {
		const status = resolveDeckStudyStatus(
			createInput({ todayCount: 0, studiedToday: 4, nextDueDate: "2026-03-01" })
		);

		expect(status.kind).toBe("done");
		expect(status.nextDueMessage).toBe("つぎは 3月1日");
	});

	it("UT-S19-STATUS-REMAINING-FLOOR: 残り枠は負数にならない", () => {
		const status = resolveDeckStudyStatus(
			createInput({ todayCount: 0, studiedToday: 25, dailyStudyLimit: 20 })
		);

		expect(status.remainingToday).toBe(0);
		// 残り枠0でも todayCount が0なら limit-reached ではなく done（D-5 の判定順序）。
		expect(status.kind).toBe("done");
	});
});

describe("summarizePlannedStudy", () => {
	it("UT-S26-PLAN-NEW-LIMIT: 新規20枚だけなら新規上限10枚を予定にする", () => {
		expect(
			summarizePlannedStudy({
				counts: { new: 20, learn: 0, due: 0 },
				studiedToday: 0,
				dailyStudyLimit: 20,
				newLimitPerDay: 10,
			})
		).toMatchObject({
			new: 10,
			review: 0,
			total: 10,
			newLimitReached: true,
		});
	});

	it("UT-S26-PLAN-NEW-AND-REVIEW: 新規20枚と復習5枚なら合計15枚を予定にする", () => {
		expect(
			summarizePlannedStudy({
				counts: { new: 20, learn: 2, due: 3 },
				studiedToday: 0,
				dailyStudyLimit: 20,
				newLimitPerDay: 10,
			})
		).toMatchObject({
			due: 3,
			learn: 2,
			new: 10,
			review: 5,
			total: 15,
			newLimitReached: true,
		});
	});

	it("UT-S26-PLAN-DAILY-LIMIT: Due と Learn を優先し、New は総上限の残枠までにする", () => {
		expect(
			summarizePlannedStudy({
				counts: { new: 20, learn: 4, due: 6 },
				studiedToday: 0,
				dailyStudyLimit: 20,
				newLimitPerDay: 10,
			})
		).toMatchObject({
			due: 6,
			learn: 4,
			review: 10,
			new: 10,
			total: 20,
			newLimitReached: true,
		});
	});

	it("UT-S26-PLAN-REMAINING-TODAY: 今日すでに学習済みなら残り枠だけ予定にする", () => {
		expect(
			summarizePlannedStudy({
				counts: { new: 20, learn: 5, due: 10 },
				studiedToday: 15,
				dailyStudyLimit: 20,
				newLimitPerDay: 10,
			})
		).toMatchObject({
			due: 5,
			learn: 0,
			new: 0,
			review: 5,
			total: 5,
			newLimitReached: false,
		});
	});

	it("UT-S26-PLAN-NORMALIZE: 小数、負数、NaN を buildSessionQueue と同じ方針で正規化する", () => {
		expect(
			summarizePlannedStudy({
				counts: { new: 3.9, learn: Number.NaN, due: -1 },
				studiedToday: -2,
				dailyStudyLimit: 2.9,
				newLimitPerDay: 1.9,
			})
		).toMatchObject({
			due: 0,
			learn: 0,
			new: 1,
			review: 0,
			total: 1,
			newLimitReached: true,
		});
	});
});
