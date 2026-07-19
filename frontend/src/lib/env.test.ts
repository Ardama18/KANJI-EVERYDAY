import { afterEach, describe, expect, it } from "vitest";

import {
	getMcpEnvConfig,
	getOpenAiCardGenerationConfig,
	getPublicEnvConfig,
	isAiCardImportEnabled,
	isAiCardManagementEnabled,
} from "./env";

const keys = [
	"AI_CARD_IMPORT_ENABLED",
	"AI_CARD_MANAGEMENT_ENABLED",
	"OPENAI_API_KEY",
	"OPENAI_CARD_GENERATION_MODEL",
	"OPENAI_MODERATION_MODEL",
	"OPENAI_CARD_IMAGE_DETAIL",
	"OPENAI_CARD_GENERATION_TIMEOUT_MS",
	"OPENAI_MODERATION_TIMEOUT_MS",
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	"MCP_ENABLED",
	"MCP_PUBLIC_ORIGIN",
	"MCP_OAUTH_ISSUER",
	"MCP_ALLOWED_ORIGIN",
] as const;

afterEach(() => {
	for (const key of keys) Reflect.deleteProperty(process.env, key);
});

describe("S-14 MCP server config", () => {
	function setValidMcpEnv(): void {
		process.env.MCP_PUBLIC_ORIGIN = "https://cards.example.test";
		process.env.MCP_OAUTH_ISSUER = "https://project.supabase.co/auth/v1";
		process.env.MCP_ALLOWED_ORIGIN = "https://chat.example.test";
	}

	it("enables only trimmed exact true", () => {
		setValidMcpEnv();
		for (const value of [undefined, "", "false", "TRUE", "1"]) {
			if (value === undefined) Reflect.deleteProperty(process.env, "MCP_ENABLED");
			else process.env.MCP_ENABLED = value;
			expect(getMcpEnvConfig().enabled).toBe(false);
		}
		process.env.MCP_ENABLED = " true ";
		expect(getMcpEnvConfig().enabled).toBe(true);
	});

	it("normalizes strict HTTPS origins and the Supabase issuer", () => {
		setValidMcpEnv();
		expect(getMcpEnvConfig()).toMatchObject({
			publicOrigin: "https://cards.example.test",
			oauthIssuer: "https://project.supabase.co/auth/v1",
			allowedOrigin: "https://chat.example.test",
		});
	});

	it("rejects missing, non-HTTPS, credentialed, path-bearing, or malformed values", () => {
		setValidMcpEnv();
		for (const [key, value] of [
			["MCP_PUBLIC_ORIGIN", ""],
			["MCP_PUBLIC_ORIGIN", "http://cards.example.test"],
			["MCP_PUBLIC_ORIGIN", "https://user@cards.example.test"],
			["MCP_PUBLIC_ORIGIN", "https://cards.example.test/path"],
			["MCP_ALLOWED_ORIGIN", "not a url"],
			["MCP_OAUTH_ISSUER", "https://project.supabase.co"],
			["MCP_OAUTH_ISSUER", "https://project.supabase.co/auth/v1?x=1"],
		] as const) {
			process.env[key] = value;
			expect(() => getMcpEnvConfig()).toThrow();
			setValidMcpEnv();
		}
	});
});

describe("S-12 typed server config", () => {
	it("reads browser Supabase values through statically analyzable public env properties", () => {
		process.env.NEXT_PUBLIC_SUPABASE_URL = " http://127.0.0.1:54321 ";
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-key";
		expect(getPublicEnvConfig()).toEqual({
			supabaseUrl: " http://127.0.0.1:54321 ",
			supabaseAnonKey: "public-key",
		});
	});

	it("enables only trimmed exact true", () => {
		for (const value of [undefined, "", "false", "TRUE", "1"]) {
			if (value === undefined) Reflect.deleteProperty(process.env, "AI_CARD_IMPORT_ENABLED");
			else process.env.AI_CARD_IMPORT_ENABLED = value;
			expect(isAiCardImportEnabled()).toBe(false);
		}
		process.env.AI_CARD_IMPORT_ENABLED = " true ";
		expect(isAiCardImportEnabled()).toBe(true);
	});

	it("fails the management route closed unless the value is exact true", () => {
		for (const value of [undefined, "", "false", "TRUE", "1"]) {
			if (value === undefined) Reflect.deleteProperty(process.env, "AI_CARD_MANAGEMENT_ENABLED");
			else process.env.AI_CARD_MANAGEMENT_ENABLED = value;
			expect(isAiCardManagementEnabled()).toBe(false);
		}
		process.env.AI_CARD_MANAGEMENT_ENABLED = " true ";
		expect(isAiCardManagementEnabled()).toBe(false);
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		expect(isAiCardManagementEnabled()).toBe(true);
	});

	it("returns the bounded server-only OpenAI defaults", () => {
		process.env.OPENAI_API_KEY = "secret";
		expect(getOpenAiCardGenerationConfig()).toMatchObject({
			model: "gpt-5.6-luna",
			moderationModel: "omni-moderation-latest",
			imageDetail: "high",
			generationTimeoutMs: 60_000,
			moderationTimeoutMs: 10_000,
		});
	});

	it("fails closed for invalid model, detail, moderation, or timeout", () => {
		process.env.OPENAI_API_KEY = "secret";
		for (const [key, value] of [
			["OPENAI_CARD_GENERATION_MODEL", "bad model"],
			["OPENAI_MODERATION_MODEL", "other"],
			["OPENAI_CARD_IMAGE_DETAIL", "original"],
			["OPENAI_CARD_GENERATION_TIMEOUT_MS", "4999"],
			["OPENAI_MODERATION_TIMEOUT_MS", "30001"],
		] as const) {
			process.env[key] = value;
			expect(getOpenAiCardGenerationConfig()).toBeUndefined();
			Reflect.deleteProperty(process.env, key);
		}
	});
});
