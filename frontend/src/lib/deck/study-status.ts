import { formatJstMonthDay, getTomorrowJST } from "@/lib/date";

/**
 * デッキ一覧と詳細で共有する学習状態の判定と文言（S-19 FR-11）。
 * `next/headers` / Supabase / `server-only` に依存しない純粋モジュールにし、
 * 「今日」は呼び出し元（Server Component / Server Action）が決めた値を受け取る。
 */

export const DECK_STUDY_NO_CARDS_MESSAGE = "カードがまだありません";
export const DECK_STUDY_DONE_MESSAGE = "きょうのぶんは おわり！";
export const DECK_STUDY_LIMIT_REACHED_MESSAGE = "きょうはここまで！またあした";
export const DECK_STUDY_NO_NEXT_DUE_MESSAGE = "つぎの よていは まだないよ";

export const DECK_LABEL_NEW = "あたらしい";
export const DECK_LABEL_REVIEW = "ふくしゅう";
export const DECK_LABEL_STUDIED_TODAY = "きょうやった";

const NEXT_DUE_TOMORROW_LABEL = "あした";
const NEXT_DUE_MESSAGE_PREFIX = "つぎは ";

export type DeckStudyStatusKind = "no-cards" | "todo" | "limit-reached" | "done";

export interface DeckStudyStatusInput {
	totalCards: number;
	todayCount: number;
	studiedToday: number;
	dailyStudyLimit: number;
	nextDueDate: string | null;
	today: string;
}

export interface DeckStudyStatus {
	kind: DeckStudyStatusKind;
	remainingToday: number;
	/** kind に対応する主文言。`todo` は主文言を表示しないため空文字。 */
	message: string;
	/**
	 * `done` は常に非 null（次回予定が無ければ「予定なし」文言）。
	 * `limit-reached` は `nextDueDate` があるときだけ非 null。
	 * `todo` / `no-cards` は常に null。
	 */
	nextDueMessage: string | null;
}

export interface PlannedStudyInput {
	counts: Readonly<{
		new: number;
		learn: number;
		due: number;
	}>;
	studiedToday: number;
	dailyStudyLimit: number;
	newLimitPerDay: number;
}

export interface PlannedStudySummary {
	new: number;
	review: number;
	due: number;
	learn: number;
	total: number;
	remainingToday: number;
	newLimitReached: boolean;
}

export function formatNextDueLabel(nextDueDate: string, today: string): string {
	return nextDueDate === getTomorrowJST(today)
		? NEXT_DUE_TOMORROW_LABEL
		: formatJstMonthDay(nextDueDate);
}

const buildNextDueMessage = (nextDueDate: string | null, today: string): string =>
	nextDueDate === null
		? DECK_STUDY_NO_NEXT_DUE_MESSAGE
		: `${NEXT_DUE_MESSAGE_PREFIX}${formatNextDueLabel(nextDueDate, today)}`;

const normalizeCount = (value: number): number => {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.floor(value));
};

export function summarizePlannedStudy(input: PlannedStudyInput): PlannedStudySummary {
	const newLimit = normalizeCount(input.newLimitPerDay);
	let remaining = Math.max(
		0,
		normalizeCount(input.dailyStudyLimit) - normalizeCount(input.studiedToday)
	);

	const availableDue = normalizeCount(input.counts.due);
	const availableLearn = normalizeCount(input.counts.learn);
	const availableNew = normalizeCount(input.counts.new);

	const due = Math.min(availableDue, remaining);
	remaining -= due;

	const learn = Math.min(availableLearn, remaining);
	remaining -= learn;

	const newCount = Math.min(availableNew, newLimit, remaining);
	remaining -= newCount;

	return {
		new: newCount,
		review: due + learn,
		due,
		learn,
		total: due + learn + newCount,
		remainingToday: Math.max(0, remaining),
		newLimitReached: availableNew > newCount && newCount === newLimit,
	};
}

export function resolveDeckStudyStatus(input: DeckStudyStatusInput): DeckStudyStatus {
	const remainingToday = Math.max(0, input.dailyStudyLimit - input.studiedToday);

	if (input.totalCards === 0) {
		return {
			kind: "no-cards",
			remainingToday,
			message: DECK_STUDY_NO_CARDS_MESSAGE,
			nextDueMessage: null,
		};
	}

	if (input.todayCount > 0) {
		if (remainingToday === 0) {
			return {
				kind: "limit-reached",
				remainingToday,
				message: DECK_STUDY_LIMIT_REACHED_MESSAGE,
				// limit-reached は今日やるカードが残っている状態なので、「つぎの よていは まだないよ」を
				// 併記すると「またあした」と矛盾する。予定なし文言は FR-04 / FR-05 の done に限定する。
				nextDueMessage:
					input.nextDueDate === null ? null : buildNextDueMessage(input.nextDueDate, input.today),
			};
		}

		return {
			kind: "todo",
			remainingToday,
			message: "",
			nextDueMessage: null,
		};
	}

	return {
		kind: "done",
		remainingToday,
		message: DECK_STUDY_DONE_MESSAGE,
		nextDueMessage: buildNextDueMessage(input.nextDueDate, input.today),
	};
}
