import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const envExamplePath = new URL("../../.env.local.example", import.meta.url);
const runbookPath = new URL("../../../docs/runbooks/local-development.md", import.meta.url);

const requiredS21EnvKeys = [
	"AI_CARD_IMPORT_ENABLED",
	"AI_CARD_MANAGEMENT_ENABLED",
	"MCP_ENABLED",
	"MCP_PUBLIC_ORIGIN",
	"MCP_OAUTH_ISSUER",
	"MCP_ALLOWED_ORIGIN",
] as const;

const readText = (url: URL): string => readFileSync(url, "utf8");

const countEnvKeyDefinitions = (source: string, key: string): number =>
	source.split("\n").filter((line) => line.startsWith(`${key}=`)).length;

describe("S-21 local development contract", () => {
	it("defines the S-21 feature flag and MCP env keys once without real credentials", () => {
		const source = readText(envExamplePath);

		for (const key of requiredS21EnvKeys) {
			expect(countEnvKeyDefinitions(source, key)).toBe(1);
		}
		expect(source).toContain("AI_CARD_IMPORT_ENABLED=false");
		expect(source).toContain("AI_CARD_MANAGEMENT_ENABLED=false");
		expect(source).toContain("MCP_ENABLED=false");
		expect(source).toContain("MCP_PUBLIC_ORIGIN=");
		expect(source).toContain("MCP_OAUTH_ISSUER=");
		expect(source).toContain("MCP_ALLOWED_ORIGIN=");
		expect(source).not.toMatch(/sk-[A-Za-z0-9_-]+/u);
		expect(source).not.toMatch(/sbp_[A-Za-z0-9_-]+/u);
		expect(source).not.toMatch(/https:\/\/[A-Za-z0-9.-]+\.supabase\.co/u);
	});

	it("documents setup, feature flags, MCP URL formats, and quality gates", () => {
		const source = readText(runbookPath);

		for (const phrase of [
			"frontend/.env.local.example",
			"frontend/.env.local",
			"commit",
			"cd frontend",
			"npm exec -- next dev",
			"http://localhost:3000",
			"AI_CARD_IMPORT_ENABLED",
			"AI_CARD_MANAGEMENT_ENABLED",
			"MCP_ENABLED",
			"MCP_PUBLIC_ORIGIN",
			"MCP_OAUTH_ISSUER",
			"MCP_ALLOWED_ORIGIN",
			"HTTPS origin",
			"/auth/v1",
			"npm --prefix frontend run lint",
			"npm --prefix frontend run typecheck",
			"npm --prefix frontend run check",
			"S10_TEST_DATABASE_URL",
			"fail-fast",
			"未実行",
			"共有DB",
			"production DB",
		]) {
			expect(source).toContain(phrase);
		}
	});

	it("does not provide non-existent scripts, browser test tools, or credential-looking values", () => {
		const source = readText(runbookPath);

		expect(source).not.toMatch(/^npm run dev$/mu);
		expect(source).not.toContain("Playwright");
		expect(source).not.toMatch(/sk-[A-Za-z0-9_-]+/u);
		expect(source).not.toMatch(/sbp_[A-Za-z0-9_-]+/u);
		expect(source).not.toMatch(/https:\/\/[A-Za-z0-9.-]+\.supabase\.co/u);
	});
});
