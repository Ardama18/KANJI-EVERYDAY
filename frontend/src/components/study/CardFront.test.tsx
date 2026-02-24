import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CardFront } from "./CardFront";

describe("frontend/src/components/study/CardFront.tsx", () => {
	it("R1カードで prompt と進捗、答えを見るボタンを表示する", () => {
		const html = renderToStaticMarkup(
			<CardFront
				deckId="deck-1"
				deckName="小学3年生の漢字"
				card={{
					sessionId: "session-1",
					cardId: "card-1",
					skill: "reading",
					pattern: "R1",
					frontText: "温かい",
					progress: {
						current: 3,
						total: 18,
						remaining: 16,
					},
				}}
				onReveal={vi.fn()}
			/>
		);

		expect(html).toContain("よみがなは？");
		expect(html).toContain("温かい");
		expect(html).toContain("3 / 18");
		expect(html).toContain("答えを見る");
	});
});
