import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserClient as createBrowserClientUnderTest } from "./client";

const createBrowserClientMock = vi.hoisted(() => vi.fn());
const createServerClientMock = vi.hoisted(() => vi.fn());
const getPublicEnvConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
	createBrowserClient: createBrowserClientMock,
	createServerClient: createServerClientMock,
}));

vi.mock("../env", () => ({
	getPublicEnvConfig: getPublicEnvConfigMock,
}));

describe("frontend/src/lib/supabase/client.ts", () => {
	const envConfig = {
		supabaseUrl: "https://example.supabase.co",
		supabaseAnonKey: "anon-key",
	};

	beforeEach(() => {
		getPublicEnvConfigMock.mockReset().mockReturnValue(envConfig);
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
		expect(getPublicEnvConfigMock).toHaveBeenCalledTimes(1);
	});

	it("Database 型を src/types/database.ts から import し createBrowserClient にジェネリクス適用している", () => {
		const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

		expect(source).toContain('import type { Database } from "@/types/database";');
		expect(source).toContain("createSupabaseBrowserClient<Database>(");
	});
});
