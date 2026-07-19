import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMiddlewareClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/middleware", () => ({
	createMiddlewareClient: createMiddlewareClientMock,
}));

import { middleware, config as middlewareConfig } from "../middleware";

type ClaimsResult = {
	data: { claims: Record<string, unknown> };
	error: null;
};

type UserResult = {
	data: { user: { id: string } | null };
	error: null;
};

const createRequest = (pathname: string) =>
	new NextRequest(new URL(pathname, "https://example.com"));

const createAuthClient = (userId: string | null) => {
	const user = userId === null ? null : { id: userId };

	return {
		auth: {
			getClaims: vi.fn<() => Promise<ClaimsResult>>().mockResolvedValue({
				data: { claims: {} },
				error: null,
			}),
			getUser: vi.fn<() => Promise<UserResult>>().mockResolvedValue({
				data: { user },
				error: null,
			}),
		},
	};
};

describe("frontend/middleware.ts", () => {
	beforeEach(() => {
		createMiddlewareClientMock.mockReset();
	});

	it.each(["/decks", "/decks/unit-1", "/ai", "/ai/cards"])(
		"UT-AC15-MW-UNAUTH-PROTECTED: 未認証 %s は /login へリダイレクトする",
		async (pathname) => {
			const authClient = createAuthClient(null);
			createMiddlewareClientMock.mockReturnValue(authClient);

			const request = createRequest(pathname);
			const response = await middleware(request);

			expect(createMiddlewareClientMock).toHaveBeenCalledTimes(1);
			expect(response.status).toBe(307);
			expect(response.headers.get("location")).toBe("https://example.com/login");
		}
	);

	it.each(["/login", "/signup"])(
		"UT-AC16-MW-AUTH-GUESTONLY: 認証済み %s は /decks へリダイレクトする",
		async (pathname) => {
			const authClient = createAuthClient("user-1");
			createMiddlewareClientMock.mockReturnValue(authClient);

			const request = createRequest(pathname);
			const response = await middleware(request);

			expect(createMiddlewareClientMock).toHaveBeenCalledTimes(1);
			expect(response.status).toBe(307);
			expect(response.headers.get("location")).toBe("https://example.com/decks");
		}
	);

	it.each(["/login", "/signup"])(
		"UT-S14-MW-AUTH-SETUP-FAIL-GUEST: 認証初期化失敗時も guest route %s は 500 にしない",
		async (pathname) => {
			createMiddlewareClientMock.mockImplementation(() => {
				throw new Error("Missing required environment variables");
			});

			const response = await middleware(createRequest(pathname));

			expect(response.headers.get("x-middleware-next")).toBe("1");
		}
	);

	it("UT-S14-MW-AUTH-SETUP-FAIL-PROTECTED: 認証初期化失敗時の protected route は /login に逃がす", async () => {
		createMiddlewareClientMock.mockImplementation(() => {
			throw new Error("Missing required environment variables");
		});

		const response = await middleware(createRequest("/decks"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://example.com/login");
	});

	it("UT-AC17-MW-PUBLIC-PASS: 公開ルート / は認証有無に関係なく通過する", async () => {
		const request = createRequest("/");
		const response = await middleware(request);

		expect(createMiddlewareClientMock).not.toHaveBeenCalled();
		expect(response.headers.get("x-middleware-next")).toBe("1");
	});

	it("UT-AC18-MW-MATCHER-EXCLUDE: matcher が static/image/favicon を除外する", () => {
		expect(middlewareConfig.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
	});

	it.each(["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico"])(
		"UT-AC18-MW-MATCHER-EXCLUDE: 除外対象 %s は認証判定を実行しない",
		async (pathname) => {
			const request = createRequest(pathname);
			const response = await middleware(request);

			expect(createMiddlewareClientMock).not.toHaveBeenCalled();
			expect(response.headers.get("x-middleware-next")).toBe("1");
		}
	);
});
