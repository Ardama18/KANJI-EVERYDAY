import { isValidElement } from "react";
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

	it("各評価ボタンはbutton semanticsと48px以上のタップ領域を維持する", () => {
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

		expect(html.match(/type="button"/g)?.length).toBe(3);
		expect(html.match(/min-h-16/g)?.length).toBe(3);
		expect(html.match(/focus-visible:outline-blue-600/g)?.length).toBe(3);
	});

	it("UT-AC16-RATING-HANDLER-ALIVE: onRate ハンドラが3ボタンで呼び出せる", () => {
		const onRate = vi.fn<(rating: "again" | "hard" | "good") => void>();
		const element = RatingButtons({
			intervalPreview: {
				again: { label: "今日さいご + 明日" },
				hard: { interval: 2, label: "2日後" },
				good: { interval: 3, label: "3日後" },
			},
			onRate,
		});

		if (!isValidElement<{ children: unknown }>(element) || !Array.isArray(element.props.children)) {
			throw new Error("Expected RatingButtons to render three button elements");
		}

		for (const child of element.props.children) {
			if (!isValidElement<{ onClick?: () => void }>(child) || !child.props.onClick) {
				throw new Error("Expected each rating button to provide an onClick handler");
			}
			child.props.onClick();
		}

		expect(onRate.mock.calls.map(([rating]) => rating)).toEqual(RATING_BUTTON_ORDER);
	});
});
