import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type TimeCoinAuthDependencies,
	TimeCoinAuthenticationError,
	authenticateTimeCoinRequest,
	parseTimeCoinBearerToken,
} from "./auth";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const issuer = "https://project.supabase.co/auth/v1";
const nowSeconds = 2_000_000_000;

function jwt(alg: string, kid = "key-1"): string {
	const encode = (value: unknown) =>
		btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
	return `${encode({ alg, kid, typ: "JWT" })}.${encode({ fixture: true })}.signature`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		iss: issuer,
		aud: "authenticated",
		sub: userId,
		role: "authenticated",
		exp: nowSeconds + 60,
		nbf: nowSeconds - 60,
		...overrides,
	};
}

function dependencies(
	alg: "RS256" | "ES256" = "ES256",
	overrides: Partial<TimeCoinAuthDependencies> = {}
): TimeCoinAuthDependencies {
	return {
		issuer,
		nowSeconds,
		verifyJwt: vi.fn(async () => ({ header: { alg, kid: "key-1" }, claims: claims() })),
		getCurrentUserId: vi.fn(async () => userId),
		...overrides,
	};
}

describe("TimeCoin REST actor authentication", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each(["RS256", "ES256"] as const)(
		"accepts a verified %s token and returns only actor context",
		async (alg) => {
			const deps = dependencies(alg);
			const token = jwt(alg);

			const actor = await authenticateTimeCoinRequest([`Bearer ${token}`], deps);

			expect(actor).toEqual({ userId, issuer });
			expect(actor).not.toHaveProperty("token");
			expect(actor).not.toHaveProperty("claims");
			expect(deps.verifyJwt).toHaveBeenCalledWith(token);
			expect(deps.getCurrentUserId).toHaveBeenCalledWith(token);
		}
	);

	it("accepts only one strict Authorization Bearer JWT", () => {
		const token = jwt("ES256");
		expect(parseTimeCoinBearerToken([`Bearer ${token}`])).toBe(token);
		for (const values of [
			[],
			[`bearer ${token}`],
			[`Bearer  ${token}`],
			[`Bearer ${token} `],
			["Bearer "],
			[`Bearer ${token}`, `Bearer ${token}`],
			[`Bearer ${token}, Bearer ${token}`],
		]) {
			expect(() => parseTimeCoinBearerToken(values)).toThrow(TimeCoinAuthenticationError);
		}
	});

	it.each(["HS256", "none", "PS256", ""])(
		"rejects unapproved algorithm %s before verification",
		async (alg) => {
			const verifyJwt = vi.fn();
			await expect(
				authenticateTimeCoinRequest([`Bearer ${jwt(alg)}`], dependencies("ES256", { verifyJwt }))
			).rejects.toThrow(TimeCoinAuthenticationError);
			expect(verifyJwt).not.toHaveBeenCalled();
		}
	);

	it("rejects verifier failure or header mismatch before user liveness", async () => {
		const getCurrentUserId = vi.fn();
		for (const verifyJwt of [
			vi.fn(async () => {
				throw new Error("provider diagnostic");
			}),
			vi.fn(async () => ({ header: { alg: "ES256", kid: "other-key" }, claims: claims() })),
		]) {
			await expect(
				authenticateTimeCoinRequest(
					[`Bearer ${jwt("ES256")}`],
					dependencies("ES256", { verifyJwt, getCurrentUserId })
				)
			).rejects.toThrow(TimeCoinAuthenticationError);
		}
		expect(getCurrentUserId).not.toHaveBeenCalled();
	});

	it.each([
		["issuer", { iss: "https://other.example/auth/v1" }],
		["expired", { exp: nowSeconds }],
		["future nbf", { nbf: nowSeconds + 1 }],
		["role", { role: "anon" }],
		["sub", { sub: "not-a-uuid" }],
	] as const)("rejects invalid %s claim before user liveness", async (_name, claimOverrides) => {
		const getCurrentUserId = vi.fn();
		const verifyJwt = vi.fn(async () => ({
			header: { alg: "ES256", kid: "key-1" },
			claims: claims({ ...claimOverrides }),
		}));
		await expect(
			authenticateTimeCoinRequest(
				[`Bearer ${jwt("ES256")}`],
				dependencies("ES256", { verifyJwt, getCurrentUserId })
			)
		).rejects.toThrow(TimeCoinAuthenticationError);
		expect(getCurrentUserId).not.toHaveBeenCalled();
	});

	it.each([
		["revoked session", null],
		["wrong user", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
	] as const)("rejects %s", async (_name, currentUserId) => {
		await expect(
			authenticateTimeCoinRequest(
				[`Bearer ${jwt("ES256")}`],
				dependencies("ES256", { getCurrentUserId: vi.fn(async () => currentUserId) })
			)
		).rejects.toThrow(TimeCoinAuthenticationError);
	});

	it("does not expose verifier detail in auth failures", async () => {
		const token = jwt("ES256");
		await expect(
			authenticateTimeCoinRequest(
				[`Bearer ${token}`],
				dependencies("ES256", {
					verifyJwt: vi.fn(async () => {
						throw new Error("provider diagnostic");
					}),
				})
			)
		).rejects.toThrow("TimeCoin authentication failed");
		await expect(
			authenticateTimeCoinRequest(
				[`Bearer ${token}`],
				dependencies("ES256", {
					verifyJwt: vi.fn(async () => {
						throw new Error("provider diagnostic");
					}),
				})
			)
		).rejects.not.toThrow("provider diagnostic");
	});
});
