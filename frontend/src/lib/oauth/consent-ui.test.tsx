import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("S-14 OAuth consent UI", () => {
	it("renders Japanese permissions and equal, keyboard-accessible approve/deny actions", () => {
		const page = readFileSync(
			new URL("../../../app/oauth/consent/page.tsx", import.meta.url),
			"utf8"
		);
		const form = readFileSync(
			new URL("../../components/oauth/consent-form.tsx", import.meta.url),
			"utf8"
		);
		expect(page).toContain("外部AIとの連携を確認");
		expect(page).toContain("デッキ名の参照");
		expect(page).toContain("非公開カードの作成・編集・削除");
		expect(form).toContain("許可する");
		expect(form).toContain("拒否する");
		expect(form).toContain("min-h-12");
		expect(form).toContain("focus-visible:outline");
	});
});
