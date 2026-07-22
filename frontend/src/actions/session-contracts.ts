export const STUDY_SESSION_COMPLETE_MESSAGE = "今日の学習おわり！";
export const STUDY_SESSION_EMPTY_MESSAGE = "今日の学習は完了しています";
export const ILLUSTRATION_DISPLAY_STATUSES = [
	"ready",
	"pending",
	"generating",
	"failed",
	"none",
] as const;

export type IllustrationDisplayStatus = (typeof ILLUSTRATION_DISPLAY_STATUSES)[number];

/**
 * 答え側カードに表示するニーモニック説明（S-16F）。
 * `card_mnemonics.explanation`（S-16A）の表示用に検証済みの形。
 */
export interface MnemonicExplanationMapping {
	part: string;
	meaning: string;
}

export interface MnemonicExplanation {
	summary: string;
	mappings: MnemonicExplanationMapping[];
}
