import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DecksPage, { DECKS_STUB_MESSAGE } from "../../../app/decks/page";

describe("frontend/app/decks/page.tsx", () => {
	it("デッキ一覧実装予定のスタブページを返す", () => {
		const html = renderToStaticMarkup(<DecksPage />);

		expect(html).toContain(DECKS_STUB_MESSAGE);
	});
});
