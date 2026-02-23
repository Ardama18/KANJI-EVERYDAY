import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage, { ROOT_NAV_LINKS, ROOT_PAGE_NOTICE, ROOT_PAGE_TITLE } from "../../app/page";

describe("frontend/app/page.tsx", () => {
	it("トップページが /login と /decks への導線を返す", () => {
		const html = renderToStaticMarkup(<HomePage />);

		expect(html).toContain(ROOT_PAGE_TITLE);
		expect(html).toContain(ROOT_PAGE_NOTICE);
		for (const link of ROOT_NAV_LINKS) {
			expect(html).toContain(`href="${link.href}"`);
			expect(html).toContain(link.label);
		}
	});
});
