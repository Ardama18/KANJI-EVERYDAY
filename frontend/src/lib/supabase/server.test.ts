import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerClient as createServerClientUnderTest } from "./server";

const createServerClientMock = vi.hoisted(() => vi.fn());
const createBrowserClientMock = vi.hoisted(() => vi.fn());
const getEnvConfigMock = vi.hoisted(() => vi.fn());

const cookieGetMock = vi.hoisted(() => vi.fn());
const cookieSetMock = vi.hoisted(() => vi.fn());

const cookiesMock = vi.hoisted(() =>
	vi.fn(() => ({
		get: cookieGetMock,
		set: cookieSetMock,
	}))
);

vi.mock("next/headers", () => ({
	cookies: cookiesMock,
}));

vi.mock("@supabase/ssr", () => ({
	createServerClient: createServerClientMock,
	createBrowserClient: createBrowserClientMock,
}));

vi.mock("../env", () => ({
	getEnvConfig: getEnvConfigMock,
}));

describe("frontend/src/lib/supabase/server.ts", () => {
	const envConfig = {
		supabaseUrl: "https://example.supabase.co",
		supabaseAnonKey: "anon-key",
		supabaseServiceRoleKey: "service-role-key",
		nodeEnv: "test",
	};

	beforeEach(() => {
		getEnvConfigMock.mockReset().mockReturnValue(envConfig);
		createServerClientMock.mockReset();
		createBrowserClientMock.mockReset();
		cookieGetMock.mockReset();
		cookieSetMock.mockReset();
		cookiesMock.mockClear();
	});

	afterEach(() => {
		expect(createBrowserClientMock).not.toHaveBeenCalled();
	});

	it("createServerClient は @supabase/ssr の createServerClient を使って初期化する", () => {
		const fakeClient = { id: "server-client" };
		createServerClientMock.mockReturnValue(fakeClient);

		const actual = createServerClientUnderTest();

		expect(createServerClientMock).toHaveBeenCalledTimes(1);
		expect(actual).toBe(fakeClient);
		expect(cookiesMock).toHaveBeenCalledTimes(1);
		expect(getEnvConfigMock).toHaveBeenCalledTimes(1);

		const [url, anonKey, options] = createServerClientMock.mock.calls[0];
		expect(url).toBe(envConfig.supabaseUrl);
		expect(anonKey).toBe(envConfig.supabaseAnonKey);
		expect(options).toMatchObject({
			cookies: expect.objectContaining({
				get: expect.any(Function),
				set: expect.any(Function),
				remove: expect.any(Function),
			}),
		});
	});

	it("cookieStore を createServerClient へ透過的に転送する", () => {
		const fakeClient = { id: "server-client" };
		cookieGetMock.mockReturnValue({ value: "cookie-value" });
		createServerClientMock.mockReturnValue(fakeClient);

		createServerClientUnderTest();

		const [, , options] = createServerClientMock.mock.calls[0];
		const { get, set, remove } = options.cookies;

		expect(get("sb-auth-token")).toBe("cookie-value");
		expect(cookieGetMock).toHaveBeenCalledWith("sb-auth-token");

		set("sb-auth-token", "next-token", { path: "/" });
		expect(cookieSetMock).toHaveBeenCalledWith({
			name: "sb-auth-token",
			value: "next-token",
			path: "/",
		});

		remove("sb-auth-token", { path: "/" });
		expect(cookieSetMock).toHaveBeenCalledWith({
			name: "sb-auth-token",
			value: "",
			path: "/",
		});
	});
});
