import { describe, expect, it, vi } from "vitest";

import type { DailyStudyStatusData } from "@/lib/deck/daily-study-status";

import type { TimeCoinActorContext } from "./auth";
import {
	type TimeCoinDailyStatusRouteDependencies,
	handleTimeCoinDailyStudyStatusRoute,
} from "./daily-study-status-route";

const token = "header.payload.signature";
const actor: TimeCoinActorContext = {
	userId: "11111111-1111-4111-8111-111111111111",
	issuer: "https://project.supabase.co/auth/v1",
};
const allowedOrigin = "https://timecoin-cloud.vercel.app";

function request(
	method = "GET",
	url = "https://kanji.example.test/api/timecoin/daily-study-status",
	headers: Record<string, string> = {}
): Request {
	return new Request(url, {
		method,
		headers: {
			accept: "application/json",
			...(method === "GET" ? { authorization: `Bearer ${token}` } : {}),
			...headers,
		},
	});
}

function successStatus(overrides: Partial<DailyStudyStatusData> = {}): DailyStudyStatusData {
	return {
		contractVersion: 1,
		date: "2026-07-30",
		state: "COMPLETED",
		completed: true,
		...overrides,
	};
}

function createDependencies(overrides: Partial<TimeCoinDailyStatusRouteDependencies> = {}) {
	const client = {};
	const dependencies: TimeCoinDailyStatusRouteDependencies = {
		isEnabled: vi.fn(() => true),
		getEnv: vi.fn(() => ({
			enabled: true,
			allowedOrigin,
			oauthIssuer: actor.issuer,
		})),
		authenticate: vi.fn(async () => actor),
		parseToken: vi.fn(() => token),
		createClient: vi.fn(() => client as never),
		getStatus: vi.fn(async () => successStatus()),
		...overrides,
	};
	return { dependencies, client };
}

describe("TimeCoin daily study status route", () => {
	it("returns 404 while disabled without auth, client, or status service calls", async () => {
		const { dependencies } = createDependencies({ isEnabled: vi.fn(() => false) });

		const response = await handleTimeCoinDailyStudyStatusRoute(request(), dependencies);

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("");
		expect(dependencies.getEnv).not.toHaveBeenCalled();
		expect(dependencies.authenticate).not.toHaveBeenCalled();
		expect(dependencies.createClient).not.toHaveBeenCalled();
		expect(dependencies.getStatus).not.toHaveBeenCalled();
	});

	it("returns 404 for invalid env without auth, client, or status service calls", async () => {
		const { dependencies } = createDependencies({
			getEnv: vi.fn(() => {
				throw new Error("invalid env raw value");
			}),
		});

		const response = await handleTimeCoinDailyStudyStatusRoute(request(), dependencies);

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("");
		expect(dependencies.authenticate).not.toHaveBeenCalled();
		expect(dependencies.createClient).not.toHaveBeenCalled();
		expect(dependencies.getStatus).not.toHaveBeenCalled();
	});

	it("allows the configured TimeCoin origin preflight without auth", async () => {
		const { dependencies } = createDependencies();

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("OPTIONS", undefined, {
				origin: allowedOrigin,
				"access-control-request-method": "GET",
			}),
			dependencies
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Accept");
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});

	it("rejects a disallowed browser origin before authentication", async () => {
		const { dependencies } = createDependencies();

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("GET", undefined, { origin: "https://attacker.example.test" }),
			dependencies
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "forbidden" });
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});

	it("returns 405 for unsupported methods", async () => {
		const { dependencies } = createDependencies();

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("POST", undefined, { authorization: `Bearer ${token}` }),
			dependencies
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("GET, OPTIONS");
		expect(await response.text()).toBe("");
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});

	it.each(["userId", "ownerId", "date", "deckId", "cardId", "anything"])(
		"rejects query selector %s before authentication",
		async (key) => {
			const { dependencies } = createDependencies();

			const response = await handleTimeCoinDailyStudyStatusRoute(
				request("GET", `https://kanji.example.test/api/timecoin/daily-study-status?${key}=x`),
				dependencies
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: "bad_request" });
			expect(dependencies.authenticate).not.toHaveBeenCalled();
			expect(dependencies.getStatus).not.toHaveBeenCalled();
		}
	);

	it.each(["text/html", "application/json;q=0", "*/*;q=0"])(
		"rejects requests with non-JSON or disabled JSON Accept %s before authentication",
		async (accept) => {
			const { dependencies } = createDependencies();

			const response = await handleTimeCoinDailyStudyStatusRoute(
				request("GET", undefined, { accept }),
				dependencies
			);

			expect(response.status).toBe(406);
			expect(await response.json()).toEqual({ error: "not_acceptable" });
			expect(dependencies.authenticate).not.toHaveBeenCalled();
		}
	);

	it("accepts JSON when the media range has nonzero quality", async () => {
		const { dependencies } = createDependencies();

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("GET", undefined, { accept: "text/html, application/json;q=0.1" }),
			dependencies
		);

		expect(response.status).toBe(200);
		expect(dependencies.authenticate).toHaveBeenCalledOnce();
	});

	it("returns one stable 401 shape for missing or invalid Bearer auth", async () => {
		const { dependencies } = createDependencies({
			parseToken: vi.fn(() => {
				throw new Error("authorization diagnostic");
			}),
		});

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("GET", undefined, { authorization: "" }),
			dependencies
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toBe('Bearer scope="openid email profile"');
		expect(await response.json()).toEqual({ error: "unauthorized" });
		expect(dependencies.authenticate).not.toHaveBeenCalled();
		expect(dependencies.createClient).not.toHaveBeenCalled();
	});

	it("creates a JWT-scoped client from the verified token and returns the four-field status", async () => {
		const leakedStatus = {
			...successStatus(),
			extraDeckField: "nonpublic-deck-value",
			extraCardField: "nonpublic-card-value",
			studiedCount: 99,
			lastReviewedAt: "2026-07-30T00:00:00.000Z",
		} as DailyStudyStatusData;
		const { dependencies, client } = createDependencies({
			getStatus: vi.fn(async () => leakedStatus),
		});

		const response = await handleTimeCoinDailyStudyStatusRoute(
			request("GET", undefined, { origin: allowedOrigin }),
			dependencies
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
		expect(dependencies.parseToken).toHaveBeenCalledWith([`Bearer ${token}`]);
		expect(dependencies.authenticate).toHaveBeenCalledWith([`Bearer ${token}`]);
		expect(dependencies.createClient).toHaveBeenCalledWith(token);
		expect(dependencies.getStatus).toHaveBeenCalledWith(client, { userId: actor.userId });
		const body = await response.json();
		expect(body).toEqual({
			contractVersion: 1,
			date: "2026-07-30",
			state: "COMPLETED",
			completed: true,
		});
		expect(Object.keys(body)).toEqual(["contractVersion", "date", "state", "completed"]);
		expect(JSON.stringify(body)).not.toContain("nonpublic-deck-value");
		expect(JSON.stringify(body)).not.toContain("nonpublic-card-value");
		expect(JSON.stringify(body)).not.toContain("studiedCount");
		expect(JSON.stringify(body)).not.toContain("lastReviewedAt");
	});

	it("returns a safe internal error when the status service fails", async () => {
		const { dependencies } = createDependencies({
			getStatus: vi.fn(async () => {
				throw new Error("database diagnostic");
			}),
		});

		const response = await handleTimeCoinDailyStudyStatusRoute(request(), dependencies);

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body).toEqual({ error: "internal_error" });
		expect(body).not.toHaveProperty("detail");
	});
});
