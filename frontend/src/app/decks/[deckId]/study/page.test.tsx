import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StudyPlaceholderPage, {
	STUDY_PLACEHOLDER_MESSAGE,
	STUDY_PLACEHOLDER_TITLE,
} from "../../../../../app/(auth)/decks/[deckId]/study/page";

describe("frontend/app/(auth)/decks/[deckId]/study/page.tsx", () => {
	it("S-06用プレースホルダを表示する", () => {
		const html = renderToStaticMarkup(<StudyPlaceholderPage params={{ deckId: "deck-1" }} />);

		expect(html).toContain(STUDY_PLACEHOLDER_TITLE);
		expect(html).toContain(STUDY_PLACEHOLDER_MESSAGE);
		expect(html).toContain("対象デッキID: deck-1");
		expect(html).toContain('href="/decks/deck-1"');
	});
});
