import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CardBack } from "./CardBack";

describe("frontend/src/components/study/CardBack.tsx", () => {
	it("裏面表示で答えとプレースホルダを表示する", () => {
		const html = renderToStaticMarkup(
			<CardBack
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
				backData={{
					cardId: "card-1",
					skill: "reading",
					pattern: "R1",
					frontText: "温かい",
					backText: "あたたかい",
					illustrationUrl: null,
					illustrationStatus: "pending",
					intervalPreview: {
						again: { label: "今日さいご + 明日" },
						hard: { interval: 2, label: "2日後" },
						good: { interval: 3, label: "3日後" },
					},
				}}
				onRate={vi.fn()}
			/>
		);

		expect(html).toContain("温かい");
		expect(html).toContain("あたたかい");
		expect(html).toContain("イラスト準備中");
		expect(html).toContain("むり");
		expect(html).toContain("あやしい");
		expect(html).toContain("できた");
	});
});
