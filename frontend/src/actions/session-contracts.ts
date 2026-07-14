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
