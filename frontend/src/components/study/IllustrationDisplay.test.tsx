import type { ComponentPropsWithoutRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockImageProps = ComponentPropsWithoutRef<"img"> & {
	src: string;
};

const imageMock = vi.hoisted(() =>
	vi.fn((props: MockImageProps) => <img {...props} alt={props.alt ?? ""} />)
);

vi.mock("next/image", () => ({
	default: (props: MockImageProps) => imageMock(props),
}));

import { IllustrationDisplay, resolveIllustrationRenderState } from "./IllustrationDisplay";

const countByTestId = (html: string, testId: string): number =>
	html.match(new RegExp(`data-testid="${testId}"`, "g"))?.length ?? 0;

const renderDisplay = (
	illustrationStatus: Parameters<typeof IllustrationDisplay>[0]["illustrationStatus"],
	illustrationUrl: string | null
) =>
	renderToStaticMarkup(
		<IllustrationDisplay
			illustrationStatus={illustrationStatus}
			illustrationUrl={illustrationUrl}
		/>
	);

describe("frontend/src/components/study/IllustrationDisplay.tsx", () => {
	beforeEach(() => {
		imageMock.mockClear();
	});

	it("UT-AC03: none はイラスト領域を描画しない", () => {
		const html = renderDisplay("none", null);

		expect(countByTestId(html, "illustration-region")).toBe(0);
		expect(countByTestId(html, "illustration-loading")).toBe(0);
		expect(countByTestId(html, "illustration-failed")).toBe(0);
		expect(countByTestId(html, "illustration-image")).toBe(0);
		expect(countByTestId(html, "illustration-fallback")).toBe(0);
	});

	it("UT-AC12: pending はローディングのみを表示する", () => {
		const html = renderDisplay("pending", null);

		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-loading")).toBe(1);
		expect(countByTestId(html, "illustration-image")).toBe(0);
	});

	it("UT-AC13: generating は pending と同じローディング表示になる", () => {
		const html = renderDisplay("generating", null);

		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-loading")).toBe(1);
		expect(countByTestId(html, "illustration-image")).toBe(0);
		expect(html).toContain("イラストを準備しています...");
	});

	it("UT-AC14: failed は失敗プレースホルダを表示し再試行UIを表示しない", () => {
		const html = renderDisplay("failed", null);

		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-failed")).toBe(1);
		expect(html).not.toContain("再試行");
	});

	it("UT-AC15: ready はイラスト画像を表示する", () => {
		const html = renderDisplay("ready", "https://example.com/illustration.png");

		expect(countByTestId(html, "illustration-region")).toBe(1);
		expect(countByTestId(html, "illustration-image")).toBe(1);
		expect(html).toContain("https://example.com/illustration.png");
	});

	it("UT-AC19: ready の Image props は priority未使用で width/height/sizes/lazy を維持する", () => {
		renderDisplay("ready", "https://example.com/illustration.png");

		expect(imageMock).toHaveBeenCalledTimes(1);
		const imageProps = imageMock.mock.calls[0]?.[0];
		expect(imageProps).toBeDefined();
		if (!imageProps) {
			throw new Error("Expected next/image mock call arguments");
		}

		expect(imageProps).not.toHaveProperty("priority");
		expect(imageProps.width).toBe(512);
		expect(imageProps.height).toBe(512);
		expect(imageProps.sizes).toBe("(max-width: 768px) 280px, 280px");
		expect(imageProps.loading).toBe("lazy");
	});

	it("UT-AC16-READY-LOAD-ERROR-FALLBACK: ready画像のonError発火時はfallbackへ遷移する", () => {
		expect(
			resolveIllustrationRenderState("ready", false, "https://example.com/illustration.png")
		).toBe("image");
		expect(
			resolveIllustrationRenderState("ready", true, "https://example.com/illustration.png")
		).toBe("fallback");
	});
});
