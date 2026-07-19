import { MCP_SCOPES } from "@/lib/mcp/metadata";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface OAuthServerApi {
	getAuthorizationDetails(authorizationId: string): Promise<unknown>;
	approveAuthorization(
		authorizationId: string,
		options: { skipBrowserRedirect: true }
	): Promise<unknown>;
	denyAuthorization(
		authorizationId: string,
		options: { skipBrowserRedirect: true }
	): Promise<unknown>;
	listGrants(): Promise<unknown>;
	revokeGrant(options: Readonly<{ clientId: string }>): Promise<unknown>;
}

export type VerifiedAuthorization = Readonly<{
	authorizationId: string;
	clientName: string;
}>;

export type OAuthConnection = Readonly<{
	clientId: string;
	clientName: string;
	grantedAt: string;
}>;

export function isAuthorizationId(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function getVerifiedAuthorization(
	oauth: OAuthServerApi,
	userId: string,
	authorizationId: string
): Promise<VerifiedAuthorization | Readonly<{ redirectUrl: string }> | null> {
	if (!isAuthorizationId(authorizationId)) return null;
	try {
		const result = await oauth.getAuthorizationDetails(authorizationId);
		const response = unwrapResponse(result);
		if (response === null) return null;
		if (isRecord(response) && isSafeRedirect(response.redirect_url)) {
			return { redirectUrl: response.redirect_url };
		}
		if (!isRecord(response) || response.authorization_id !== authorizationId) return null;
		if (
			!hasExactMcpScopes(response.scope) ||
			!isRecord(response.user) ||
			response.user.id !== userId
		) {
			return null;
		}
		if (!isRecord(response.client) || !isAuthorizationId(response.client.id)) return null;
		const clientName = response.client.name;
		if (typeof clientName !== "string" || clientName.trim().length < 1 || clientName.length > 200) {
			return null;
		}
		return { authorizationId, clientName: clientName.trim() };
	} catch {
		return null;
	}
}

export async function getOAuthConnections(
	oauth: OAuthServerApi
): Promise<readonly OAuthConnection[] | null> {
	try {
		const data = unwrapResponse(await oauth.listGrants());
		if (!Array.isArray(data)) return null;
		const connections: OAuthConnection[] = [];
		for (const grant of data) {
			if (!isRecord(grant) || !isRecord(grant.client) || !hasExactMcpScopes(grant.scopes)) continue;
			if (!isAuthorizationId(grant.client.id) || typeof grant.client.name !== "string") continue;
			if (grant.client.name.trim().length < 1 || grant.client.name.length > 200) continue;
			if (typeof grant.granted_at !== "string" || !Number.isFinite(Date.parse(grant.granted_at))) {
				continue;
			}
			connections.push({
				clientId: grant.client.id,
				clientName: grant.client.name.trim(),
				grantedAt: grant.granted_at,
			});
		}
		return connections;
	} catch {
		return null;
	}
}

export async function getOfficialRedirect(result: unknown): Promise<string | null> {
	const data = unwrapResponse(result);
	return isRecord(data) && isSafeRedirect(data.redirect_url) ? data.redirect_url : null;
}

export function hasExactMcpScopes(value: unknown): boolean {
	const scopes =
		typeof value === "string"
			? value.split(" ").filter((scope) => scope.length > 0)
			: Array.isArray(value) && value.every((scope) => typeof scope === "string")
				? value
				: null;
	return (
		scopes !== null &&
		scopes.length === MCP_SCOPES.length &&
		new Set(scopes).size === MCP_SCOPES.length &&
		MCP_SCOPES.every((scope) => scopes.includes(scope))
	);
}

function unwrapResponse(result: unknown): unknown | null {
	if (!isRecord(result) || result.error !== null || !("data" in result)) return null;
	return result.data;
}

function isSafeRedirect(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.username.length === 0 && url.password.length === 0;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
