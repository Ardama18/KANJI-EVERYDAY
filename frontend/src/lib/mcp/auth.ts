import { createClient } from "@supabase/supabase-js";

import { getMcpEnvConfig, getPublicEnvConfig } from "../env";
import {
	MCP_SCOPES,
	type McpMetadataConfig,
	getCanonicalMcpResource,
	getMcpBearerChallenge,
} from "./metadata";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const JWT_PART_PATTERN = /^[A-Za-z0-9_-]+$/u;
const ALLOWED_ALGORITHMS = new Set(["RS256", "ES256"]);

export type McpActorContext = Readonly<{
	userId: string;
	clientId: string;
	sessionId: string;
	issuer: string;
	audience: string;
	scopes: typeof MCP_SCOPES;
}>;

export interface VerifiedJwt {
	readonly header: unknown;
	readonly claims: unknown;
}

export interface McpGrant {
	readonly clientId: string;
	readonly scopes: readonly string[];
}

export interface McpAuthDependencies {
	readonly issuer: string;
	readonly audience: string;
	readonly nowSeconds: number;
	readonly verifyJwt: (token: string) => Promise<VerifiedJwt>;
	readonly getCurrentUserId: (token: string) => Promise<string | null>;
	readonly listActiveGrants: (token: string) => Promise<readonly McpGrant[]>;
}

export class McpAuthenticationError extends Error {
	constructor() {
		super("MCP authentication failed");
		this.name = "McpAuthenticationError";
	}
}

export async function authenticateMcpRequest(
	authorizationValues: readonly string[],
	dependencies: McpAuthDependencies
): Promise<McpActorContext> {
	try {
		const token = parseBearerToken(authorizationValues);
		const untrustedHeader = parseJwtHeader(token);
		if (!isAllowedHeader(untrustedHeader)) throw new McpAuthenticationError();

		const verified = await dependencies.verifyJwt(token);
		if (!isAllowedHeader(verified.header)) throw new McpAuthenticationError();
		if (
			verified.header.alg !== untrustedHeader.alg ||
			verified.header.kid !== untrustedHeader.kid
		) {
			throw new McpAuthenticationError();
		}
		const actor = validateClaims(verified.claims, dependencies);

		const [currentUserId, grants] = await Promise.all([
			dependencies.getCurrentUserId(token),
			dependencies.listActiveGrants(token),
		]);
		if (currentUserId !== actor.userId) throw new McpAuthenticationError();
		const matchingGrants = grants.filter((grant) => grant.clientId === actor.clientId);
		if (matchingGrants.length !== 1 || !hasExactScopes(matchingGrants[0]?.scopes ?? [])) {
			throw new McpAuthenticationError();
		}

		return actor;
	} catch (error) {
		if (error instanceof McpAuthenticationError) throw error;
		throw new McpAuthenticationError();
	}
}

export function parseBearerToken(authorizationValues: readonly string[]): string {
	if (authorizationValues.length !== 1) throw new McpAuthenticationError();
	const value = authorizationValues[0] ?? "";
	const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value);
	if (match === null || match[1] === undefined) throw new McpAuthenticationError();
	return match[1];
}

export function createMcpUnauthorizedResponse(config: McpMetadataConfig): Response {
	return Response.json(
		{ error: "unauthorized" },
		{
			status: 401,
			headers: {
				"Cache-Control": "no-store",
				"WWW-Authenticate": getMcpBearerChallenge(config),
			},
		}
	);
}

export function createDefaultMcpAuthDependencies(): McpAuthDependencies {
	const publicEnv = getPublicEnvConfig();
	const mcpEnv = getMcpEnvConfig();
	const authClient = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
	});
	return {
		issuer: mcpEnv.oauthIssuer,
		audience: getCanonicalMcpResource(mcpEnv),
		nowSeconds: Math.floor(Date.now() / 1000),
		verifyJwt: async (token) => {
			const result = await authClient.auth.getClaims(token);
			if (result.error !== null || result.data === null) throw new McpAuthenticationError();
			return { header: result.data.header, claims: result.data.claims };
		},
		getCurrentUserId: async (token) => {
			const result = await authClient.auth.getUser(token);
			return result.error === null ? (result.data.user?.id ?? null) : null;
		},
		listActiveGrants: async (token) =>
			await fetchActiveGrants(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, token),
	};
}

function parseJwtHeader(token: string): unknown {
	const [headerPart = ""] = token.split(".");
	if (!JWT_PART_PATTERN.test(headerPart)) throw new McpAuthenticationError();
	try {
		const base64 = headerPart.replaceAll("-", "+").replaceAll("_", "/");
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				Uint8Array.from(atob(padded), (value) => value.charCodeAt(0))
			)
		);
	} catch {
		throw new McpAuthenticationError();
	}
}

function isAllowedHeader(value: unknown): value is { alg: "RS256" | "ES256"; kid: string } {
	if (!isRecord(value)) return false;
	return (
		typeof value.alg === "string" &&
		ALLOWED_ALGORITHMS.has(value.alg) &&
		typeof value.kid === "string" &&
		value.kid.trim().length > 0
	);
}

function validateClaims(claims: unknown, dependencies: McpAuthDependencies): McpActorContext {
	if (!isRecord(claims)) throw new McpAuthenticationError();
	if (
		claims.iss !== dependencies.issuer ||
		claims.aud !== dependencies.audience ||
		claims.role !== "authenticated" ||
		typeof claims.sub !== "string" ||
		!UUID_PATTERN.test(claims.sub) ||
		typeof claims.client_id !== "string" ||
		claims.client_id.trim().length === 0 ||
		typeof claims.session_id !== "string" ||
		claims.session_id.trim().length === 0 ||
		typeof claims.exp !== "number" ||
		!Number.isSafeInteger(claims.exp) ||
		claims.exp <= dependencies.nowSeconds ||
		(claims.nbf !== undefined &&
			(typeof claims.nbf !== "number" ||
				!Number.isSafeInteger(claims.nbf) ||
				claims.nbf > dependencies.nowSeconds))
	) {
		throw new McpAuthenticationError();
	}
	return Object.freeze({
		userId: claims.sub,
		clientId: claims.client_id,
		sessionId: claims.session_id,
		issuer: dependencies.issuer,
		audience: dependencies.audience,
		scopes: MCP_SCOPES,
	});
}

function hasExactScopes(scopes: readonly string[]): boolean {
	return (
		scopes.length === MCP_SCOPES.length &&
		new Set(scopes).size === MCP_SCOPES.length &&
		MCP_SCOPES.every((scope) => scopes.includes(scope))
	);
}

async function fetchActiveGrants(
	supabaseUrl: string,
	anonKey: string,
	token: string
): Promise<readonly McpGrant[]> {
	const response = await fetch(`${supabaseUrl}/auth/v1/user/oauth/grants`, {
		method: "GET",
		headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
		cache: "no-store",
	});
	if (!response.ok) throw new McpAuthenticationError();
	const body: unknown = await response.json();
	if (!Array.isArray(body)) throw new McpAuthenticationError();
	return body.map((grant) => {
		if (!isRecord(grant) || !isRecord(grant.client) || !Array.isArray(grant.scopes)) {
			throw new McpAuthenticationError();
		}
		if (
			typeof grant.client.id !== "string" ||
			!grant.scopes.every((scope) => typeof scope === "string")
		) {
			throw new McpAuthenticationError();
		}
		return { clientId: grant.client.id, scopes: grant.scopes };
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
