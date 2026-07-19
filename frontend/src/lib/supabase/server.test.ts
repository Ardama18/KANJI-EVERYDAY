import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createJwtScopedClient as createJwtScopedClientUnderTest,
	createServerClient as createServerClientUnderTest,
	createServiceRoleClient as createServiceRoleClientUnderTest,
} from "./server";

const createServerClientMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());
const getEnvConfigMock = vi.hoisted(() => vi.fn());
const getPublicEnvConfigMock = vi.hoisted(() => vi.fn());

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
}));

vi.mock("@supabase/supabase-js", () => ({
	createClient: createClientMock,
}));

vi.mock("../env", () => ({
	getEnvConfig: getEnvConfigMock,
	getPublicEnvConfig: getPublicEnvConfigMock,
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
		getPublicEnvConfigMock.mockReset().mockReturnValue({
			supabaseUrl: envConfig.supabaseUrl,
			supabaseAnonKey: envConfig.supabaseAnonKey,
		});
		createServerClientMock.mockReset();
		createClientMock.mockReset();
		cookieGetMock.mockReset();
		cookieSetMock.mockReset();
		cookiesMock.mockClear();
	});

	it("createServerClient は @supabase/ssr の createServerClient を使って初期化する", () => {
		const fakeClient = { id: "server-client" };
		createServerClientMock.mockReturnValue(fakeClient);

		const actual = createServerClientUnderTest();

		expect(createServerClientMock).toHaveBeenCalledTimes(1);
		expect(actual).toBe(fakeClient);
		expect(cookiesMock).toHaveBeenCalledTimes(1);
		expect(getEnvConfigMock).not.toHaveBeenCalled();
		expect(getPublicEnvConfigMock).toHaveBeenCalledTimes(1);

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

	it("Database 型を src/types/database.ts から import し createServerClient にジェネリクス適用している", () => {
		const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

		expect(source).toContain('import type { Database } from "@/types/database";');
		expect(source).toContain("createSupabaseServerClient<Database>(");
		expect(source).toContain("createSupabaseClient<Database>(");
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

	it("createServiceRoleClient は service role key で Supabase client を初期化する", () => {
		const fakeClient = { id: "service-role-client" };
		createClientMock.mockReturnValue(fakeClient);

		const actual = createServiceRoleClientUnderTest();

		expect(actual).toBe(fakeClient);
		expect(createClientMock).toHaveBeenCalledTimes(1);
		expect(cookiesMock).not.toHaveBeenCalled();
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(createClientMock).toHaveBeenCalledWith(
			envConfig.supabaseUrl,
			envConfig.supabaseServiceRoleKey,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
				},
			}
		);
	});

	it("createJwtScopedClient uses only the anon key and a request token callback", async () => {
		const fakeClient = { id: "jwt-scoped-client" };
		createClientMock.mockReturnValue(fakeClient);

		const actual = createJwtScopedClientUnderTest("header.payload.signature");

		expect(actual).toBe(fakeClient);
		expect(createClientMock).toHaveBeenCalledTimes(1);
		const [url, key, options] = createClientMock.mock.calls[0];
		expect(url).toBe(envConfig.supabaseUrl);
		expect(key).toBe(envConfig.supabaseAnonKey);
		expect(key).not.toBe(envConfig.supabaseServiceRoleKey);
		expect(await options.accessToken()).toBe("header.payload.signature");
		expect(options.auth).toMatchObject({
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		});
		expect(options.global).toBeUndefined();
		expect(cookiesMock).not.toHaveBeenCalled();
	});

	it("createJwtScopedClient rejects an empty token before client creation", () => {
		expect(() => createJwtScopedClientUnderTest("  ")).toThrow(
			"JWT-scoped Supabase client requires a token"
		);
		expect(createClientMock).not.toHaveBeenCalled();
	});
});
