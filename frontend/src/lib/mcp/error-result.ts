const SAFE_CODES = new Set([
	"VALIDATION_ERROR",
	"DUPLICATE_IN_REQUEST",
	"DUPLICATE_EXISTING",
	"DECK_NOT_FOUND",
	"DECK_AMBIGUOUS",
	"QUOTA_EXCEEDED",
	"ACTIVE_SESSION",
	"CARD_MODIFIED",
	"CONFLICT",
	"SERVICE_UNAVAILABLE",
	"UNAUTHORIZED",
	"NOT_FOUND",
	"INTERNAL_ERROR",
]);

export interface McpSafeFailure {
	readonly code: string;
	readonly message?: string;
	readonly details?: Readonly<Record<string, string | number>>;
}

export type McpToolResult = Readonly<{
	content: readonly [{ readonly type: "text"; readonly text: string }];
	structuredContent:
		| Readonly<{ ok: true; data: unknown }>
		| Readonly<{
				ok: false;
				error: Readonly<{
					code: string;
					message: string;
					details?: Readonly<Record<string, string | number>>;
				}>;
		  }>;
	isError?: true;
	_meta?: Readonly<Record<string, unknown>>;
}>;

export function createMcpSuccess(data: unknown): McpToolResult {
	const structuredContent = { ok: true as const, data };
	return {
		content: [{ type: "text", text: JSON.stringify(structuredContent) }],
		structuredContent,
	};
}

export function createMcpError(failure: unknown): McpToolResult {
	const normalized = normalizeMcpFailure(failure);
	const structuredContent = {
		ok: false as const,
		error: {
			code: normalized.code,
			message: normalized.message ?? "処理を完了できませんでした。",
			...(normalized.details === undefined ? {} : { details: normalized.details }),
		},
	};
	return {
		content: [{ type: "text", text: JSON.stringify(structuredContent) }],
		structuredContent,
		isError: true,
	};
}

export function normalizeMcpFailure(value: unknown): McpSafeFailure {
	if (!isRecord(value) || typeof value.code !== "string" || !SAFE_CODES.has(value.code)) {
		return { code: "INTERNAL_ERROR", message: "処理を完了できませんでした。" };
	}
	const details = sanitizeDetails(value.details);
	return {
		code: value.code,
		message: safeMessage(value.message),
		...(details === undefined ? {} : { details }),
	};
}

function safeMessage(value: unknown): string {
	if (typeof value !== "string" || value.length < 1 || value.length > 120) {
		return "処理を完了できませんでした。";
	}
	return value;
}

function sanitizeDetails(value: unknown): Readonly<Record<string, string | number>> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, string | number> = {};
	for (const [key, detail] of Object.entries(value)) {
		if (!/^(field|limit|current|requested|date|cardId|sessionId|deckId)$/u.test(key)) continue;
		if (typeof detail === "number" && Number.isSafeInteger(detail)) result[key] = detail;
		if (typeof detail === "string" && detail.length > 0 && detail.length <= 128) {
			result[key] = detail;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
