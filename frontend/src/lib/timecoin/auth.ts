import { createClient } from "@supabase/supabase-js";

import { getPublicEnvConfig, getTimeCoinApiEnvConfig } from "@/lib/env";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const JWT_PART_PATTERN = /^[A-Za-z0-9_-]+$/u;
const ALLOWED_ALGORITHMS = new Set(["RS256", "ES256"]);

export type TimeCoinActorContext = Readonly<{
	userId: string;
	issuer: string;
}>;

export interface VerifiedTimeCoinJwt {
	readonly header: unknown;
	readonly claims: unknown;
}

export interface TimeCoinAuthDependencies {
	readonly issuer: string;
	readonly nowSeconds: number;
	readonly verifyJwt: (token: string) => Promise<VerifiedTimeCoinJwt>;
	readonly getCurrentUserId: (token: string) => Promise<string | null>;
}

export class TimeCoinAuthenticationError extends Error {
	constructor() {
		super("TimeCoin authentication failed");
		this.name = "TimeCoinAuthenticationError";
	}
}

export async function authenticateTimeCoinRequest(
	authorizationValues: readonly string[],
	dependencies: TimeCoinAuthDependencies
): Promise<TimeCoinActorContext> {
	try {
		const token = parseTimeCoinBearerToken(authorizationValues);
		const untrustedHeader = parseJwtHeader(token);
		if (!isAllowedHeader(untrustedHeader)) throw new TimeCoinAuthenticationError();

		const verified = await dependencies.verifyJwt(token);
		if (!isAllowedHeader(verified.header)) throw new TimeCoinAuthenticationError();
		if (
			verified.header.alg !== untrustedHeader.alg ||
			verified.header.kid !== untrustedHeader.kid
		) {
			throw new TimeCoinAuthenticationError();
		}

		const actor = validateClaims(verified.claims, dependencies);
		const currentUserId = await dependencies.getCurrentUserId(token);
		if (currentUserId !== actor.userId) throw new TimeCoinAuthenticationError();
		return actor;
	} catch (error) {
		if (error instanceof TimeCoinAuthenticationError) throw error;
		throw new TimeCoinAuthenticationError();
	}
}

export function parseTimeCoinBearerToken(authorizationValues: readonly string[]): string {
	if (authorizationValues.length !== 1) throw new TimeCoinAuthenticationError();
	const value = authorizationValues[0] ?? "";
	const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value);
	if (match === null || match[1] === undefined) throw new TimeCoinAuthenticationError();
	return match[1];
}

export function createDefaultTimeCoinAuthDependencies(): TimeCoinAuthDependencies {
	const publicEnv = getPublicEnvConfig();
	const timeCoinEnv = getTimeCoinApiEnvConfig();
	const authClient = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
	});
	return {
		issuer: timeCoinEnv.oauthIssuer,
		nowSeconds: Math.floor(Date.now() / 1_000),
		verifyJwt: async (token) => {
			const result = await authClient.auth.getClaims(token);
			if (result.error !== null || result.data === null) throw new TimeCoinAuthenticationError();
			return { header: result.data.header, claims: result.data.claims };
		},
		getCurrentUserId: async (token) => {
			const result = await authClient.auth.getUser(token);
			return result.error === null ? (result.data.user?.id ?? null) : null;
		},
	};
}

function parseJwtHeader(token: string): unknown {
	const [headerPart = ""] = token.split(".");
	if (!JWT_PART_PATTERN.test(headerPart)) throw new TimeCoinAuthenticationError();
	try {
		const base64 = headerPart.replaceAll("-", "+").replaceAll("_", "/");
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				Uint8Array.from(atob(padded), (value) => value.charCodeAt(0))
			)
		);
	} catch {
		throw new TimeCoinAuthenticationError();
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

function validateClaims(
	claims: unknown,
	dependencies: TimeCoinAuthDependencies
): TimeCoinActorContext {
	if (!isRecord(claims)) throw new TimeCoinAuthenticationError();
	if (
		claims.iss !== dependencies.issuer ||
		claims.role !== "authenticated" ||
		typeof claims.sub !== "string" ||
		!UUID_PATTERN.test(claims.sub) ||
		typeof claims.exp !== "number" ||
		!Number.isSafeInteger(claims.exp) ||
		claims.exp <= dependencies.nowSeconds ||
		(claims.nbf !== undefined &&
			(typeof claims.nbf !== "number" ||
				!Number.isSafeInteger(claims.nbf) ||
				claims.nbf > dependencies.nowSeconds))
	) {
		throw new TimeCoinAuthenticationError();
	}
	return Object.freeze({
		userId: claims.sub,
		issuer: dependencies.issuer,
	});
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
