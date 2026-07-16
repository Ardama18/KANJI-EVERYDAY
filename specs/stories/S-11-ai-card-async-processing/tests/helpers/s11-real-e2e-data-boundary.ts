const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const OWNER_SAFE_OBJECT_COLUMNS = [
	"id",
	"owner_user_id",
	"illustration_id",
	"state",
	"reference_count",
	"error_code",
	"width",
	"height",
	"created_at",
	"updated_at",
	"deleted_at",
].join(",");

const OWNER_SENSITIVE_OBJECT_COLUMNS = [
	"job_id",
	"storage_bucket",
	"storage_path",
	"digest",
	"delete_due_at",
	"cleanup_claimed_at",
	"cleanup_claim_token",
	"cleanup_previous_state",
].join(",");

export interface S11PostgrestBoundary {
	readonly fetch: typeof fetch;
	readonly supabaseBase: string;
	readonly anonKey: string;
}

interface OwnerProjectionBoundary extends S11PostgrestBoundary {
	readonly ownerHeaders: Readonly<Record<string, string>>;
	readonly otherOwnerHeaders: Readonly<Record<string, string>>;
}

export async function fetchServiceOwnerRows(
	boundary: S11PostgrestBoundary,
	serviceHeaders: Readonly<Record<string, string>>,
	ownerId: string,
	resourceAndQuery: string
): Promise<Record<string, unknown>[]> {
	assertCanonicalUuid(ownerId, "service owner filter");
	const authorization = headerValue(serviceHeaders, "authorization");
	const apiKey = headerValue(serviceHeaders, "apikey");
	if (apiKey === undefined || authorization !== `Bearer ${apiKey}`) {
		throw new Error("service owner snapshot requires the service-role bearer/apikey pair");
	}
	if (/(?:\?|&)owner_user_id=/u.test(resourceAndQuery)) {
		throw new Error("service owner filter must be added by the boundary adapter");
	}
	const separator = resourceAndQuery.includes("?") ? "&" : "?";
	return await fetchRows(
		boundary,
		`${resourceAndQuery}${separator}owner_user_id=eq.${encodeURIComponent(ownerId)}`,
		serviceHeaders,
		"service-role owner-scoped snapshot"
	);
}

export async function assertOwnerProjectionBoundary(
	boundary: OwnerProjectionBoundary,
	objectId: string
): Promise<void> {
	assertCanonicalUuid(objectId, "owner projection object");
	const objectFilter = `id=eq.${encodeURIComponent(objectId)}`;
	const safeQuery =
		`ai_illustration_objects?select=${OWNER_SAFE_OBJECT_COLUMNS}&${objectFilter}`;
	const ownerRows = await fetchRows(
		boundary,
		safeQuery,
		boundary.ownerHeaders,
		"owner-safe illustration projection"
	);
	if (ownerRows.length !== 1 || ownerRows[0]?.id !== objectId) {
		throw new Error("owner-safe illustration projection did not return the owned row");
	}
	const otherRows = await fetchRows(
		boundary,
		safeQuery,
		boundary.otherOwnerHeaders,
		"cross-owner safe illustration projection"
	);
	if (otherRows.length !== 0) {
		throw new Error("cross-owner safe illustration projection exposed an owned row");
	}

	const sensitiveResponse = await boundary.fetch(
		`${boundary.supabaseBase}/rest/v1/ai_illustration_objects?select=${OWNER_SENSITIVE_OBJECT_COLUMNS}&${objectFilter}`,
		{ headers: { ...boundary.ownerHeaders, apikey: boundary.anonKey } }
	);
	const body: unknown = await sensitiveResponse.json();
	if (
		sensitiveResponse.status !== 403 ||
		!isRecord(body) ||
		body.code !== "42501"
	) {
		throw new Error(
			`owner-sensitive illustration projection was not denied with 403/42501: ${sensitiveResponse.status}`
		);
	}
}

async function fetchRows(
	boundary: S11PostgrestBoundary,
	resourceAndQuery: string,
	headers: Readonly<Record<string, string>>,
	label: string
): Promise<Record<string, unknown>[]> {
	const requestHeaders = new Headers(headers);
	if (!requestHeaders.has("apikey")) {
		requestHeaders.set("apikey", boundary.anonKey);
	}
	const response = await boundary.fetch(
		`${boundary.supabaseBase}/rest/v1/${resourceAndQuery}`,
		{ headers: requestHeaders }
	);
	const body: unknown = await response.json();
	if (response.status !== 200 || !Array.isArray(body) || !body.every(isRecord)) {
		throw new Error(`${label} failed: ${response.status}`);
	}
	return body;
}

function assertCanonicalUuid(value: string, label: string): void {
	if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a canonical UUID`);
}

function headerValue(
	headers: Readonly<Record<string, string>>,
	name: string
): string | undefined {
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
	return entry?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
