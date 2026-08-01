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
		const display = readFileSync(
			new URL("../../lib/oauth/client-display.ts", import.meta.url),
			"utf8"
		);
		const connections = readFileSync(
			new URL("../../components/oauth/connections-client.tsx", import.meta.url),
			"utf8"
		);
		expect(page).toContain("getOAuthClientDisplay");
		expect(page).toContain("display.heading");
		expect(page).toContain("display.permissions");
		expect(page).toContain("外部サービスからもう一度連携を開始してください。");
		expect(display).toContain("外部AIとの連携を確認");
		expect(display).toContain("デッキ名の参照");
		expect(display).toContain("非公開カードの作成・編集・削除");
		expect(display).toContain("TimeCoin との連携を確認");
		expect(display).toContain("本日の学習完了状態の確認");
		expect(display).toContain("contractVersion / date / state / completed");
		expect(display).toContain("デッキ名、カード内容、学習枚数は共有しません。");
		expect(connections).toContain("外部サービス連携一覧");
		expect(connections).toContain("連携中の外部サービスはありません。");
		expect(form).toContain("許可する");
		expect(form).toContain("拒否する");
		expect(form).toContain("min-h-12");
		expect(form).toContain("focus-visible:outline");
	});
});
