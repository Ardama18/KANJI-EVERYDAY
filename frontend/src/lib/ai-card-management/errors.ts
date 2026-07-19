import type { AiCardManagementError } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const ERROR_BY_SQLSTATE: Record<string, Omit<AiCardManagementError, "detail">> = {
	P1000: { code: "VALIDATION_ERROR", status: 400, message: "入力内容を確認してください。" },
	P1003: { code: "NOT_FOUND", status: 404, message: "対象が見つかりません。" },
	P1006: { code: "ACTIVE_SESSION", status: 409, message: "学習中のカードは変更できません。" },
	P1007: {
		code: "CARD_MODIFIED",
		status: 409,
		message: "編集済みのカードがあるため取り消せません。",
	},
	P1008: {
		code: "CONFLICT",
		status: 409,
		message: "ほかの操作と競合しました。再読み込みしてください。",
	},
	42501: { code: "UNAUTHORIZED", status: 401, message: "ログインが必要です。" },
};

const safeActiveDetail = (details: unknown): { sessionId: string; deckId: string } | undefined => {
	if (typeof details !== "string" || details.length > 500) return undefined;
	try {
		const parsed: unknown = JSON.parse(details);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		const value = parsed as Record<string, unknown>;
		return typeof value.sessionId === "string" &&
			UUID_PATTERN.test(value.sessionId) &&
			typeof value.deckId === "string" &&
			UUID_PATTERN.test(value.deckId)
			? { sessionId: value.sessionId, deckId: value.deckId }
			: undefined;
	} catch {
		return undefined;
	}
};

export function mapAiCardManagementError(error: unknown): AiCardManagementError {
	if (typeof error !== "object" || error === null) {
		return {
			code: "INTERNAL_ERROR",
			status: 500,
			message: "処理に失敗しました。時間をおいて再試行してください。",
		};
	}
	const value = error as Record<string, unknown>;
	const mapped = typeof value.code === "string" ? ERROR_BY_SQLSTATE[value.code] : undefined;
	if (mapped === undefined) {
		return {
			code: "INTERNAL_ERROR",
			status: 500,
			message: "処理に失敗しました。時間をおいて再試行してください。",
		};
	}
	const detail = mapped.code === "ACTIVE_SESSION" ? safeActiveDetail(value.details) : undefined;
	return detail === undefined ? mapped : { ...mapped, detail };
}
