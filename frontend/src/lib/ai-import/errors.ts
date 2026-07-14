export const AI_IMPORT_ERROR_CODES = [
	"VALIDATION_ERROR",
	"DUPLICATE_IN_REQUEST",
	"DUPLICATE_EXISTING",
	"DECK_NOT_FOUND",
	"DECK_AMBIGUOUS",
	"QUOTA_EXCEEDED",
	"ACTIVE_SESSION",
	"CARD_MODIFIED",
	"CONFLICT",
	"UNAUTHORIZED",
	"INTERNAL_ERROR",
] as const;

export type AiImportErrorCode = (typeof AI_IMPORT_ERROR_CODES)[number];
export type AiImportErrorDetail = Readonly<Record<string, string | number>>;

export interface AiImportError {
	readonly code: AiImportErrorCode;
	readonly httpStatus: number;
	readonly detail?: AiImportErrorDetail;
}

interface ErrorContract {
	readonly code: AiImportErrorCode;
	readonly httpStatus: number;
}

const SQL_STATE_CONTRACTS: Readonly<Record<string, ErrorContract>> = Object.freeze({
	P1000: { code: "VALIDATION_ERROR", httpStatus: 400 },
	P1001: { code: "DUPLICATE_IN_REQUEST", httpStatus: 409 },
	P1002: { code: "DUPLICATE_EXISTING", httpStatus: 409 },
	P1003: { code: "DECK_NOT_FOUND", httpStatus: 404 },
	P1004: { code: "DECK_AMBIGUOUS", httpStatus: 409 },
	P1005: { code: "QUOTA_EXCEEDED", httpStatus: 429 },
	P1006: { code: "ACTIVE_SESSION", httpStatus: 409 },
	P1007: { code: "CARD_MODIFIED", httpStatus: 409 },
	P1008: { code: "CONFLICT", httpStatus: 409 },
	"42501": { code: "UNAUTHORIZED", httpStatus: 403 },
});

const DUPLICATE_EXISTING_CONSTRAINT = "cards_private_owner_card_key_uidx";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const SAFE_PATH_PATTERN = /^\$?[A-Za-z0-9_.\[\]-]+$/u;
const SAFE_RULE_PATTERN = /^[a-z0-9_]+$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function mapAiImportError(error: unknown, correlationId: string): AiImportError {
	const source = isRecord(error) ? error : {};
	const sqlState = readString(source.code) ?? readString(source.sqlState);
	const constraint = readString(source.constraint) ?? readString(source.constraintName);
	let contract = sqlState === undefined ? undefined : SQL_STATE_CONTRACTS[sqlState];
	if (sqlState === "23505" && constraint === DUPLICATE_EXISTING_CONSTRAINT) {
		contract = { code: "DUPLICATE_EXISTING", httpStatus: 409 };
	}
	if (contract === undefined) {
		return {
			code: "INTERNAL_ERROR",
			httpStatus: 500,
			detail: { correlationId: safeCorrelationId(correlationId) },
		};
	}
	const detail = safeDetail(contract.code, source);
	return detail === undefined ? contract : { ...contract, detail };
}

function safeDetail(
	code: AiImportErrorCode,
	source: Readonly<Record<string, unknown>>
): AiImportErrorDetail | undefined {
	if (code === "DECK_NOT_FOUND" || code === "CONFLICT" || code === "UNAUTHORIZED") return undefined;
	const detail = readDetail(source);
	if (detail === undefined) return undefined;
	if (code === "VALIDATION_ERROR") {
		const path =
			safeString(detail.path, SAFE_PATH_PATTERN, 256) ??
			safeString(detail.field, SAFE_PATH_PATTERN, 256);
		const rule = safeString(detail.rule, SAFE_RULE_PATTERN, 64);
		return compactDetail({ path, rule });
	}
	if (code === "DUPLICATE_IN_REQUEST") {
		return compactDetail({ clientItemId: safeString(detail.clientItemId, SAFE_ID_PATTERN, 64) });
	}
	if (code === "DUPLICATE_EXISTING") {
		return compactDetail({ itemId: safeString(detail.itemId, SAFE_ID_PATTERN, 64) });
	}
	if (code === "DECK_AMBIGUOUS") {
		return compactDetail({ normalizedName: safeBoundedText(detail.normalizedName, 200) });
	}
	if (code === "QUOTA_EXCEEDED") {
		return compactDetail({
			limit: safeNonNegativeInteger(detail.limit),
			current: safeNonNegativeInteger(detail.current),
			requested: safeNonNegativeInteger(detail.requested),
			date: safeString(detail.date, DATE_PATTERN, 10),
		});
	}
	if (code === "ACTIVE_SESSION") {
		return compactDetail({
			sessionId: safeUuid(detail.sessionId),
			deckId: safeUuid(detail.deckId),
		});
	}
	if (code === "CARD_MODIFIED") {
		return compactDetail({ cardId: safeUuid(detail.cardId) });
	}
	return undefined;
}

function readDetail(
	source: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> | undefined {
	for (const candidate of [source.safeDetail, source.detail, source.details]) {
		if (isRecord(candidate)) return candidate;
		if (typeof candidate === "string") {
			try {
				const parsed: unknown = JSON.parse(candidate);
				if (isRecord(parsed)) return parsed;
			} catch {
				// PostgreSQL's prose detail is intentionally ignored.
			}
		}
	}
	return undefined;
}

function compactDetail(
	values: Readonly<Record<string, string | number | undefined>>
): AiImportErrorDetail | undefined {
	const result: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(values)) if (value !== undefined) result[key] = value;
	return Object.keys(result).length === 0 ? undefined : result;
}

function safeCorrelationId(value: string): string {
	return safeString(value, SAFE_ID_PATTERN, 128) ?? "unavailable";
}

function safeUuid(value: unknown): string | undefined {
	return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function safeBoundedText(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== "string" || value.length < 1 || value.length > maxLength) return undefined;
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 31 || codePoint === 127) return undefined;
	}
	return value;
}

function safeString(value: unknown, pattern: RegExp, maxLength: number): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		pattern.test(value)
		? value
		: undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
