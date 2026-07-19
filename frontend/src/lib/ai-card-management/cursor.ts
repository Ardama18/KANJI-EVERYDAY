const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface AiCardCursor {
	readonly createdAt: string;
	readonly id: string;
}

const POSTGRES_TIMESTAMPTZ_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u;

export const isPostgresTimestamp = (value: string) => {
	const match = POSTGRES_TIMESTAMPTZ_PATTERN.exec(value);
	if (!match || !Number.isFinite(Date.parse(value))) return false;
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const local = new Date(Date.UTC(Number(match[1]), month - 1, day, hour, minute, second));
	if (
		local.getUTCFullYear() !== Number(match[1]) ||
		local.getUTCMonth() !== month - 1 ||
		local.getUTCDate() !== day ||
		local.getUTCHours() !== hour ||
		local.getUTCMinutes() !== minute ||
		local.getUTCSeconds() !== second
	)
		return false;
	if (match[8] !== "Z") {
		const offsetHour = Number(match[8].slice(1, 3));
		const offsetMinute = Number(match[8].slice(4, 6));
		if (offsetHour > 23 || offsetMinute > 59) return false;
	}
	return true;
};

export function encodeAiCardCursor(cursor: AiCardCursor): string {
	return Buffer.from(
		JSON.stringify({ v: 1, createdAt: cursor.createdAt, id: cursor.id }),
		"utf8"
	).toString("base64url");
}

export function decodeAiCardCursor(value: string): AiCardCursor | null {
	try {
		if (value.length < 16 || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
		const bytes = Buffer.from(value, "base64url");
		if (bytes.toString("base64url") !== value) return null;
		const decoded: unknown = JSON.parse(bytes.toString("utf8"));
		if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
		const record = decoded as Record<string, unknown>;
		if (
			Object.keys(record).sort().join(",") !== "createdAt,id,v" ||
			record.v !== 1 ||
			typeof record.createdAt !== "string" ||
			typeof record.id !== "string" ||
			!isPostgresTimestamp(record.createdAt) ||
			!UUID_PATTERN.test(record.id)
		) {
			return null;
		}
		return { createdAt: record.createdAt, id: record.id };
	} catch {
		return null;
	}
}
