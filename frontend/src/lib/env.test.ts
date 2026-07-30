import { afterEach, describe, expect, it } from "vitest";

import {
	getMcpAutoMnemonicConfig,
	getMcpEnvConfig,
	getOpenAiCardGenerationConfig,
	getPublicEnvConfig,
	getTimeCoinApiEnvConfig,
	isAiCardImportEnabled,
	isAiCardManagementEnabled,
	isTimeCoinApiEnabled,
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
	"MCP_AUTO_MNEMONIC_MAX_CONCEPTS",
	"MCP_AUTO_MNEMONIC_BUDGET_MS",
	"TIMECOIN_API_ENABLED",
	"TIMECOIN_API_ALLOWED_ORIGIN",
	"TIMECOIN_API_OAUTH_ISSUER",
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
			allowedOrigins: ["https://chat.example.test"],
		});
	});

	it("accepts comma-separated strict HTTPS allowed origins", () => {
		setValidMcpEnv();
		process.env.MCP_ALLOWED_ORIGIN =
			"https://chatgpt.com, https://timecoin-cloud.vercel.app,https://claude.ai";
		expect(getMcpEnvConfig().allowedOrigins).toEqual([
			"https://chatgpt.com",
			"https://timecoin-cloud.vercel.app",
			"https://claude.ai",
		]);
	});

	it("rejects missing, non-HTTPS, credentialed, path-bearing, or malformed values", () => {
		setValidMcpEnv();
		for (const [key, value] of [
			["MCP_PUBLIC_ORIGIN", ""],
			["MCP_PUBLIC_ORIGIN", "http://cards.example.test"],
			["MCP_PUBLIC_ORIGIN", "https://user@cards.example.test"],
			["MCP_PUBLIC_ORIGIN", "https://cards.example.test/path"],
			["MCP_ALLOWED_ORIGIN", "not a url"],
			["MCP_ALLOWED_ORIGIN", "https://chat.example.test,https://chat.example.test"],
			["MCP_ALLOWED_ORIGIN", "https://chat.example.test,"],
			["MCP_ALLOWED_ORIGIN", "https://chat.example.test,https://claude.ai/path"],
			["MCP_OAUTH_ISSUER", "https://project.supabase.co"],
			["MCP_OAUTH_ISSUER", "https://project.supabase.co/auth/v1?x=1"],
		] as const) {
			process.env[key] = value;
			expect(() => getMcpEnvConfig()).toThrow();
			setValidMcpEnv();
		}
	});
});

describe("S-27 TimeCoin REST API config", () => {
	function setValidTimeCoinApiEnv(): void {
		process.env.TIMECOIN_API_ENABLED = "true";
		process.env.TIMECOIN_API_ALLOWED_ORIGIN = "https://timecoin-cloud.vercel.app";
		process.env.TIMECOIN_API_OAUTH_ISSUER = "https://project.supabase.co/auth/v1";
	}

	it("enables only exact true without trimming", () => {
		for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
			if (value === undefined) Reflect.deleteProperty(process.env, "TIMECOIN_API_ENABLED");
			else process.env.TIMECOIN_API_ENABLED = value;
			expect(isTimeCoinApiEnabled()).toBe(false);
		}
		process.env.TIMECOIN_API_ENABLED = "true";
		expect(isTimeCoinApiEnabled()).toBe(true);
	});

	it("normalizes the strict HTTPS TimeCoin origin and Supabase issuer", () => {
		setValidTimeCoinApiEnv();

		expect(getTimeCoinApiEnvConfig()).toEqual({
			enabled: true,
			allowedOrigin: "https://timecoin-cloud.vercel.app",
			oauthIssuer: "https://project.supabase.co/auth/v1",
		});
	});

	it("fails closed for missing, non-HTTPS, credentialed, path-bearing, or malformed values", () => {
		setValidTimeCoinApiEnv();
		for (const [key, value] of [
			["TIMECOIN_API_ALLOWED_ORIGIN", ""],
			["TIMECOIN_API_ALLOWED_ORIGIN", "http://timecoin-cloud.vercel.app"],
			["TIMECOIN_API_ALLOWED_ORIGIN", "https://user@timecoin-cloud.vercel.app"],
			["TIMECOIN_API_ALLOWED_ORIGIN", "https://timecoin-cloud.vercel.app/path"],
			["TIMECOIN_API_ALLOWED_ORIGIN", "not a url"],
			["TIMECOIN_API_OAUTH_ISSUER", ""],
			["TIMECOIN_API_OAUTH_ISSUER", "http://project.supabase.co/auth/v1"],
			["TIMECOIN_API_OAUTH_ISSUER", "https://user@project.supabase.co/auth/v1"],
			["TIMECOIN_API_OAUTH_ISSUER", "https://project.supabase.co"],
			["TIMECOIN_API_OAUTH_ISSUER", "https://project.supabase.co/auth/v1?x=1"],
			["TIMECOIN_API_OAUTH_ISSUER", "not a url"],
		] as const) {
			process.env[key] = value;
			expect(() => getTimeCoinApiEnvConfig(), `${key}=${value}`).toThrow();
			setValidTimeCoinApiEnv();
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

	it("S-21: bounds the MCP auto-mnemonic limits with documented defaults", () => {
		expect(getMcpAutoMnemonicConfig()).toEqual({ maxConcepts: 20, budgetMs: 45_000 });
		process.env.MCP_AUTO_MNEMONIC_MAX_CONCEPTS = "5";
		process.env.MCP_AUTO_MNEMONIC_BUDGET_MS = "10000";
		expect(getMcpAutoMnemonicConfig()).toEqual({ maxConcepts: 5, budgetMs: 10_000 });
		// 0 is the kill switch, so it must stay a valid value.
		process.env.MCP_AUTO_MNEMONIC_MAX_CONCEPTS = "0";
		expect(getMcpAutoMnemonicConfig()).toEqual({ maxConcepts: 0, budgetMs: 10_000 });
	});

	it("S-21: fails closed for out-of-range or non-numeric auto-mnemonic limits", () => {
		for (const [key, value] of [
			["MCP_AUTO_MNEMONIC_MAX_CONCEPTS", "51"],
			["MCP_AUTO_MNEMONIC_MAX_CONCEPTS", "-1"],
			["MCP_AUTO_MNEMONIC_MAX_CONCEPTS", "twenty"],
			["MCP_AUTO_MNEMONIC_BUDGET_MS", "4999"],
			["MCP_AUTO_MNEMONIC_BUDGET_MS", "120001"],
			["MCP_AUTO_MNEMONIC_BUDGET_MS", "45s"],
		] as const) {
			process.env[key] = value;
			expect(getMcpAutoMnemonicConfig(), `${key}=${value}`).toBeUndefined();
			Reflect.deleteProperty(process.env, key);
		}
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
