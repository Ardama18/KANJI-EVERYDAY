import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("S-14 OAuth connections UI", () => {
	it("shows only connection names and dates with a separate revoke confirmation", () => {
		const source = readFileSync(
			new URL("../../components/oauth/connections-client.tsx", import.meta.url),
			"utf8"
		);
		expect(source).toContain("許可日:");
		expect(source).toContain("連携解除へ進む");
		expect(source).toContain("との連携を解除する");
		expect(source).toContain('type="hidden" name="client_id"');
		expect(source).toContain("min-h-12");
	});
});
