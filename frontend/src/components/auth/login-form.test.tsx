import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/auth/login-form.tsx", () => {
	it("UT-AC12-UI-SIZING-RULES: フォーム幅と入力高さの制約を持つ", () => {
		const source = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

		expect(source).toContain("max-w-[28rem]");
		expect(source).toContain("h-12");
		expect(source).toContain("w-full");
	});

	it("UT-AC20-SERVER-ACTIONS-FORM-BINDING: signIn を form action に接続する", () => {
		const source = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(signIn");
		expect(source).toContain("action={formAction}");
	});

	it("UT-SH01-SUBMIT-DISABLE: submit-button で送信中無効化を行う", () => {
		const submitButtonSource = readFileSync(
			new URL("./submit-button.tsx", import.meta.url),
			"utf8"
		);

		expect(submitButtonSource).toContain("useFormStatus");
		expect(submitButtonSource).toContain("disabled={pending}");
	});

	it("UT-SH02-CROSS-LINK-RENDER: signup への相互導線リンクを表示する", () => {
		const source = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

		expect(source).toContain('href="/signup"');
		expect(source).toContain("アカウントを作成する");
	});
});
