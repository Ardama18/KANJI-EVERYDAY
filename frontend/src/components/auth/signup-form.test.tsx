import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/auth/signup-form.tsx", () => {
	it("UT-AC12-UI-SIZING-RULES: フォーム幅と入力高さの制約を持つ", () => {
		const source = readFileSync(new URL("./signup-form.tsx", import.meta.url), "utf8");

		expect(source).toContain("max-w-[28rem]");
		expect(source).toContain("h-12");
		expect(source).toContain("w-full");
	});

	it("UT-AC20-SERVER-ACTIONS-FORM-BINDING: signUp を form action に接続する", () => {
		const source = readFileSync(new URL("./signup-form.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(signUp");
		expect(source).toContain("action={formAction}");
	});

	it("UT-SH02-CROSS-LINK-RENDER: login への相互導線リンクを表示する", () => {
		const source = readFileSync(new URL("./signup-form.tsx", import.meta.url), "utf8");

		expect(source).toContain('href="/login"');
		expect(source).toContain("ログインはこちら");
	});
});
