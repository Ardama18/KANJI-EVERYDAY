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
					totalCards: 18,
					learnedCards: 8,
					scheduledCards: 2,
					dailyStudyLimit: 20,
				}}
			/>
		);

		expect(html).toContain('href="/decks/deck-1"');
		expect(html).toContain("小学3年生の漢字");
		expect(html).toContain(">10<");
		expect(html).toContain(">3<");
		expect(html).toContain(">5<");
		expect(html).toContain("カード 18枚");
		expect(html).toContain("学習済み 8枚");
		expect(html).toContain("予定");
		expect(html).toContain("2枚");
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
					totalCards: 12,
					learnedCards: 12,
					scheduledCards: 12,
					dailyStudyLimit: 20,
				}}
			/>
		);

		expect(html).toContain("bg-slate-200 text-slate-700");
		expect(html).toContain("カード 12枚");
		expect(html).toContain("学習済み 12枚");
		expect(html).toContain("予定");
	});
});
