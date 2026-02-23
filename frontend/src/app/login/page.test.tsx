import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LoginPage, { LOGIN_STUB_MESSAGE } from "../../../app/login/page";

describe("frontend/app/login/page.tsx", () => {
	it("ログイン実装予定のスタブページを返す", () => {
		const html = renderToStaticMarkup(<LoginPage />);

		expect(html).toContain(LOGIN_STUB_MESSAGE);
	});
});
