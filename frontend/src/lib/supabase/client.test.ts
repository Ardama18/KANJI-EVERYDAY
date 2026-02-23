import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserClient as createBrowserClientUnderTest } from "./client";

const createBrowserClientMock = vi.hoisted(() => vi.fn());
const createServerClientMock = vi.hoisted(() => vi.fn());
const getEnvConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
	createBrowserClient: createBrowserClientMock,
	createServerClient: createServerClientMock,
}));

vi.mock("../env", () => ({
	getEnvConfig: getEnvConfigMock,
}));

describe("frontend/src/lib/supabase/client.ts", () => {
	const envConfig = {
		supabaseUrl: "https://example.supabase.co",
		supabaseAnonKey: "anon-key",
		supabaseServiceRoleKey: "service-role-key",
		nodeEnv: "test",
	};

	beforeEach(() => {
		getEnvConfigMock.mockReset().mockReturnValue(envConfig);
		createBrowserClientMock.mockReset();
		createServerClientMock.mockReset();
	});

	afterEach(() => {
		expect(createServerClientMock).not.toHaveBeenCalled();
	});

	it("createBrowserClient は @supabase/ssr の createBrowserClient を使って初期化する", () => {
		const fakeClient = { id: "browser-client" };
		createBrowserClientMock.mockReturnValue(fakeClient);

		const actual = createBrowserClientUnderTest();

		expect(createBrowserClientMock).toHaveBeenCalledTimes(1);
		expect(actual).toBe(fakeClient);
		expect(createBrowserClientMock).toHaveBeenCalledWith(
			envConfig.supabaseUrl,
			envConfig.supabaseAnonKey
		);
		expect(getEnvConfigMock).toHaveBeenCalledTimes(1);
	});
});
