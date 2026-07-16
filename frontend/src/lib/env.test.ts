import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAiPreviewHmacSecret, getEnvConfig } from "./env";

const REQUIRED_KEYS = [
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
] as const;
const OPTIONAL_KEYS = ["GEMINI_API_KEY", "AI_PREVIEW_HMAC_SECRET"] as const;
const TEST_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS] as const;

const SNAPSHOT: Partial<Record<(typeof TEST_KEYS)[number], string>> = {};
let nodeEnvSnapshot: string | undefined;
type MutableProcessEnv = { [key: string]: string | undefined };
const processEnv = process.env as MutableProcessEnv;

const BASELINE_ENV: Record<string, string> = {
	NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
	NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
	SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

beforeEach(() => {
	for (const key of TEST_KEYS) {
		SNAPSHOT[key] = process.env[key];
		delete process.env[key];
	}
	nodeEnvSnapshot = processEnv.NODE_ENV;
	processEnv.NODE_ENV = undefined;
});

afterEach(() => {
	processEnv.NODE_ENV = nodeEnvSnapshot;
	for (const key of TEST_KEYS) {
		if (SNAPSHOT[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = SNAPSHOT[key];
		}
	}
	for (const key of TEST_KEYS) {
		delete SNAPSHOT[key];
	}
	nodeEnvSnapshot = undefined;
});

describe("getEnvConfig", () => {
	it("NEXT_PUBLIC_SUPABASE_URL が未設定のとき例外を投げる", () => {
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
		process.env.SUPABASE_SERVICE_ROLE_KEY = BASELINE_ENV.SUPABASE_SERVICE_ROLE_KEY;

		expect(() => getEnvConfig()).toThrowError(
			"Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL"
		);
	});

	it("NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定のとき例外を投げる", () => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_URL;
		process.env.SUPABASE_SERVICE_ROLE_KEY = BASELINE_ENV.SUPABASE_SERVICE_ROLE_KEY;

		expect(() => getEnvConfig()).toThrowError(
			"Missing required environment variables: NEXT_PUBLIC_SUPABASE_ANON_KEY"
		);
	});

	it("SUPABASE_SERVICE_ROLE_KEY が未設定のとき例外を投げる", () => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_URL;
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

		expect(() => getEnvConfig()).toThrowError(
			"Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY"
		);
	});

	it("NODE_ENV=test でも SUPABASE_SERVICE_ROLE_KEY 未設定は例外になる", () => {
		processEnv.NODE_ENV = "test";
		process.env.NEXT_PUBLIC_SUPABASE_URL = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_URL;
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

		expect(() => getEnvConfig()).toThrowError(
			"Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY"
		);
	});

	it("不足キー一覧を不足順で一度に返す", () => {
		expect(() => getEnvConfig()).toThrowError(
			"Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
		);
	});

	it("全ての必須キーがある場合に設定オブジェクトを返す", () => {
		Object.assign(process.env, BASELINE_ENV);

		const config = getEnvConfig();

		expect(config).toEqual({
			supabaseUrl: BASELINE_ENV.NEXT_PUBLIC_SUPABASE_URL,
			supabaseAnonKey: BASELINE_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
			supabaseServiceRoleKey: BASELINE_ENV.SUPABASE_SERVICE_ROLE_KEY,
			geminiApiKey: undefined,
			nodeEnv: process.env.NODE_ENV,
		});
	});

	it("GEMINI_API_KEY が未設定でも例外を投げずに undefined を返す", () => {
		Object.assign(process.env, BASELINE_ENV);

		const config = getEnvConfig();

		expect(Object.hasOwn(config, "geminiApiKey")).toBe(true);
		expect(config.geminiApiKey).toBeUndefined();
	});

	it("AI_PREVIEW_HMAC_SECRET をtrimし、missing/blankはundefinedとして安全に扱う", () => {
		expect(getAiPreviewHmacSecret()).toBeUndefined();
		process.env.AI_PREVIEW_HMAC_SECRET = "   ";
		expect(getAiPreviewHmacSecret()).toBeUndefined();
		process.env.AI_PREVIEW_HMAC_SECRET = "  preview-secret  ";
		expect(getAiPreviewHmacSecret()).toBe("preview-secret");
	});
});
