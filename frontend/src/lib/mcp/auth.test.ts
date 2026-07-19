import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type McpAuthDependencies,
	McpAuthenticationError,
	authenticateMcpRequest,
	createMcpUnauthorizedResponse,
	parseBearerToken,
} from "./auth";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const issuer = "https://project.supabase.co/auth/v1";
const audience = "https://cards.example.test/api/mcp";
const nowSeconds = 2_000_000_000;

function jwt(alg: string, kid = "key-1"): string {
	const encode = (value: unknown) =>
		btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
	return `${encode({ alg, kid, typ: "JWT" })}.${encode({ fixture: true })}.signature`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		iss: issuer,
		aud: audience,
		sub: userId,
		role: "authenticated",
		client_id: "client-1",
		session_id: "session-1",
		exp: nowSeconds + 60,
		nbf: nowSeconds - 60,
		...overrides,
	};
}

function dependencies(
	alg: "RS256" | "ES256" = "ES256",
	overrides: Partial<McpAuthDependencies> = {}
): McpAuthDependencies {
	return {
		issuer,
		audience,
		nowSeconds,
		verifyJwt: vi.fn(async () => ({ header: { alg, kid: "key-1" }, claims: claims() })),
		getCurrentUserId: vi.fn(async () => userId),
		listActiveGrants: vi.fn(async () => [
			{ clientId: "client-1", scopes: ["openid", "email", "profile"] },
		]),
		...overrides,
	};
}

describe("MCP request authentication", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each(["RS256", "ES256"] as const)(
		"accepts a verified %s token and returns no raw token or claims",
		async (alg) => {
			const deps = dependencies(alg);
			const token = jwt(alg);

			const actor = await authenticateMcpRequest([`Bearer ${token}`], deps);

			expect(actor).toEqual({
				userId,
				clientId: "client-1",
				sessionId: "session-1",
				issuer,
				audience,
				scopes: ["openid", "email", "profile"],
			});
			expect(actor).not.toHaveProperty("token");
			expect(actor).not.toHaveProperty("claims");
			expect(deps.verifyJwt).toHaveBeenCalledOnce();
			expect(deps.getCurrentUserId).toHaveBeenCalledOnce();
			expect(deps.listActiveGrants).toHaveBeenCalledOnce();
		}
	);

	it("accepts only one strict Authorization Bearer JWT and rejects alternate token sources", () => {
		const token = jwt("ES256");
		expect(parseBearerToken([`Bearer ${token}`])).toBe(token);
		for (const values of [
			[],
			[`bearer ${token}`],
			[`Bearer  ${token}`],
			[`Bearer ${token} `],
			["Bearer "],
			[`Bearer ${token}`, `Bearer ${token}`],
			[`Bearer ${token}, Bearer ${token}`],
		]) {
			expect(() => parseBearerToken(values)).toThrow(McpAuthenticationError);
		}
	});

	it.each(["HS256", "none", "PS256", ""])(
		"rejects unapproved algorithm %s before verification",
		async (alg) => {
			const verifyJwt = vi.fn();
			await expect(
				authenticateMcpRequest([`Bearer ${jwt(alg)}`], dependencies("ES256", { verifyJwt }))
			).rejects.toThrow(McpAuthenticationError);
			expect(verifyJwt).not.toHaveBeenCalled();
		}
	);

	it("rejects signature, unknown kid, or verifier failures without running liveness", async () => {
		const getCurrentUserId = vi.fn();
		const listActiveGrants = vi.fn();
		for (const verifyJwt of [
			vi.fn(async () => {
				throw new Error("signature rejected");
			}),
			vi.fn(async () => ({ header: { alg: "ES256", kid: "other-key" }, claims: claims() })),
		]) {
			await expect(
				authenticateMcpRequest(
					[`Bearer ${jwt("ES256")}`],
					dependencies("ES256", { verifyJwt, getCurrentUserId, listActiveGrants })
				)
			).rejects.toThrow(McpAuthenticationError);
		}
		expect(getCurrentUserId).not.toHaveBeenCalled();
		expect(listActiveGrants).not.toHaveBeenCalled();
	});

	it.each([
		["issuer", { iss: "https://other.example/auth/v1" }],
		["audience", { aud: "authenticated" }],
		["array audience", { aud: ["authenticated", audience] }],
		["expired", { exp: nowSeconds }],
		["future nbf", { nbf: nowSeconds + 1 }],
		["role", { role: "anon" }],
		["sub", { sub: "not-a-uuid" }],
		["client", { client_id: "" }],
		["session", { session_id: "" }],
	] as const)("rejects invalid %s claim before liveness", async (_name, claimOverrides) => {
		const getCurrentUserId = vi.fn();
		const listActiveGrants = vi.fn();
		const verifyJwt = vi.fn(async () => ({
			header: { alg: "ES256", kid: "key-1" },
			claims: claims({ ...claimOverrides }),
		}));
		await expect(
			authenticateMcpRequest(
				[`Bearer ${jwt("ES256")}`],
				dependencies("ES256", { verifyJwt, getCurrentUserId, listActiveGrants })
			)
		).rejects.toThrow(McpAuthenticationError);
		expect(getCurrentUserId).not.toHaveBeenCalled();
		expect(listActiveGrants).not.toHaveBeenCalled();
	});

	it.each([
		["revoked session", null, [{ clientId: "client-1", scopes: ["openid", "email", "profile"] }]],
		[
			"wrong user",
			"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			[{ clientId: "client-1", scopes: ["openid", "email", "profile"] }],
		],
		["missing grant", userId, []],
		["wrong client", userId, [{ clientId: "client-2", scopes: ["openid", "email", "profile"] }]],
		["missing scope", userId, [{ clientId: "client-1", scopes: ["openid", "email"] }]],
		[
			"extra scope",
			userId,
			[{ clientId: "client-1", scopes: ["openid", "email", "profile", "phone"] }],
		],
		["duplicate scope", userId, [{ clientId: "client-1", scopes: ["openid", "email", "email"] }]],
	] as const)("rejects %s liveness or grant state", async (_name, currentUserId, grants) => {
		await expect(
			authenticateMcpRequest(
				[`Bearer ${jwt("ES256")}`],
				dependencies("ES256", {
					getCurrentUserId: vi.fn(async () => currentUserId),
					listActiveGrants: vi.fn(async () => grants),
				})
			)
		).rejects.toThrow(McpAuthenticationError);
	});

	it("does not cache successful verification or liveness between requests", async () => {
		const deps = dependencies();
		const authorization = [`Bearer ${jwt("ES256")}`];
		await authenticateMcpRequest(authorization, deps);
		await authenticateMcpRequest(authorization, deps);
		expect(deps.verifyJwt).toHaveBeenCalledTimes(2);
		expect(deps.getCurrentUserId).toHaveBeenCalledTimes(2);
		expect(deps.listActiveGrants).toHaveBeenCalledTimes(2);
	});

	it("allows a verifier to recover after a JWKS rotation without caching failure", async () => {
		const verifyJwt = vi
			.fn()
			.mockRejectedValueOnce(new Error("unknown kid"))
			.mockResolvedValueOnce({ header: { alg: "ES256", kid: "key-1" }, claims: claims() });
		const deps = dependencies("ES256", { verifyJwt });
		const authorization = [`Bearer ${jwt("ES256")}`];
		await expect(authenticateMcpRequest(authorization, deps)).rejects.toThrow(
			McpAuthenticationError
		);
		await expect(authenticateMcpRequest(authorization, deps)).resolves.toMatchObject({ userId });
		expect(verifyJwt).toHaveBeenCalledTimes(2);
	});

	it("returns one stable 401 shape and exact Bearer challenge", async () => {
		const response = createMcpUnauthorizedResponse({
			publicOrigin: "https://cards.example.test",
			oauthIssuer: issuer,
		});
		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toBe(
			'Bearer resource_metadata="https://cards.example.test/.well-known/oauth-protected-resource/api/mcp", scope="openid email profile"'
		);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});
});
