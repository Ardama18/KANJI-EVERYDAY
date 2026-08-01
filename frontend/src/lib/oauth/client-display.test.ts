import { describe, expect, it } from "vitest";

import { TIMECOIN_OAUTH_CLIENT_ID, getOAuthClientDisplay } from "./client-display";

describe("S-28 OAuth client display classification", () => {
	it("uses the TimeCoin REST API copy only for the registered TimeCoin client id", () => {
		const display = getOAuthClientDisplay(TIMECOIN_OAUTH_CLIENT_ID, "TimeCoin");

		expect(display.kind).toBe("timecoin");
		expect(display.heading).toBe("TimeCoin との連携を確認");
		expect(display.permissions).toEqual(["本日の学習完了状態の確認"]);
		expect(display.description.join("\n")).toContain("contractVersion / date / state / completed");
		expect(display.description.join("\n")).toContain(
			"デッキ名、カード内容、学習枚数は共有しません。"
		);
		expect(display.permissions).not.toContain("デッキ名の参照");
		expect(display.permissions).not.toContain("非公開カードの作成・編集・削除");
	});

	it("keeps the MCP copy for non-TimeCoin clients even if the client name is TimeCoin", () => {
		const display = getOAuthClientDisplay("chatgpt-client_2222222222222222", "TimeCoin");

		expect(display.kind).toBe("mcp");
		expect(display.heading).toBe("外部AIとの連携を確認");
		expect(display.permissions).toEqual(["デッキ名の参照", "非公開カードの作成・編集・削除"]);
	});
});
