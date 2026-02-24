import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionComplete } from "./SessionComplete";

describe("frontend/src/components/study/SessionComplete.tsx", () => {
	it("完了メッセージとデッキ一覧導線を表示する", () => {
		const html = renderToStaticMarkup(
			<SessionComplete
				deckName="小学3年生の漢字"
				summary={{
					message: "今日の学習おわり！",
					studiedUniqueCards: 12,
				}}
			/>
		);

		expect(html).toContain("今日の学習おわり！");
		expect(html).toContain("学習したカード数: 12");
		expect(html).toContain('href="/decks"');
	});
});
