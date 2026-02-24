import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/auth/signout-button.tsx", () => {
	it("UT-AC19-SIGNOUT-REDIRECT: signOut をフォーム導線から実行できる", () => {
		const source = readFileSync(new URL("./signout-button.tsx", import.meta.url), "utf8");

		expect(source).toContain("action={signOut}");
		expect(source).toContain('type="submit"');
		expect(source).toContain("ログアウト");
	});
});
