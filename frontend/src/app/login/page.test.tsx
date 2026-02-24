import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LOGIN_PAGE_DESCRIPTION, LOGIN_PAGE_TITLE } from "../../../app/login/page";

describe("frontend/app/login/page.tsx", () => {
	it("ログインページがフォーム導線を表示する", () => {
		const source = readFileSync(new URL("../../../app/login/page.tsx", import.meta.url), "utf8");

		expect(source).toContain("LoginForm");
		expect(source).toContain("max-w-[28rem]");
		expect(source).toContain(LOGIN_PAGE_TITLE);
		expect(source).toContain(LOGIN_PAGE_DESCRIPTION);
	});
});
