import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeckCard } from "./DeckCard";

describe("frontend/src/components/deck/DeckCard.tsx", () => {
	it("カウントと遷移リンクを表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={{
					id: "deck-1",
					name: "小学3年生の漢字",
					counts: {
						new: 10,
						learn: 3,
						due: 5,
					},
				}}
			/>
		);

		expect(html).toContain('href="/decks/deck-1"');
		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain(">10<");
		expect(html).toContain(">3<");
		expect(html).toContain(">5<");
	});

	it("0件のバッジをグレー配色で表示する", () => {
		const html = renderToStaticMarkup(
			<DeckCard
				deck={{
					id: "deck-2",
					name: "小学4年生の漢字",
					counts: {
						new: 0,
						learn: 0,
						due: 0,
					},
				}}
			/>
		);

		expect(html).toContain("bg-slate-200 text-slate-700");
	});
});
