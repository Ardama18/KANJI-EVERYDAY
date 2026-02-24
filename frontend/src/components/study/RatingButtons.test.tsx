import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RATING_BUTTON_ORDER, RatingButtons } from "./RatingButtons";

describe("frontend/src/components/study/RatingButtons.tsx", () => {
	it("Again -> Hard -> Good の順で表示する", () => {
		const html = renderToStaticMarkup(
			<RatingButtons
				intervalPreview={{
					again: { label: "今日さいご + 明日" },
					hard: { interval: 2, label: "2日後" },
					good: { interval: 3, label: "3日後" },
				}}
				onRate={vi.fn()}
			/>
		);

		expect(RATING_BUTTON_ORDER).toEqual(["again", "hard", "good"]);
		expect(html.indexOf("むり")).toBeLessThan(html.indexOf("あやしい"));
		expect(html.indexOf("あやしい")).toBeLessThan(html.indexOf("できた"));
		expect(html).toContain("今日さいご + 明日");
		expect(html).toContain("2日後");
		expect(html).toContain("3日後");
	});
});
