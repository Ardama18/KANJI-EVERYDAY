import { describe, expect, it } from "vitest";

import { createMcpError, createMcpSuccess } from "./error-result";

describe("MCP safe result mapping", () => {
	it("keeps text and structured success content identical", () => {
		const result = createMcpSuccess({ id: "safe" });
		expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
		expect(result.isError).toBeUndefined();
	});

	it("maps unknown failures without reflecting secret-like detail", () => {
		const result = createMcpError({
			code: "DATABASE_ERROR",
			stack: "secret-token",
			message: "raw SQL",
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "INTERNAL_ERROR" },
		});
		expect(result.content[0].text).not.toContain("secret-token");
	});

	it("keeps only allowlisted safe detail fields", () => {
		const result = createMcpError({
			code: "CONFLICT",
			message: "競合しました。",
			details: { cardId: "safe", sql: "select", token: "no" },
		});
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "CONFLICT", details: { cardId: "safe" } },
		});
	});
});
