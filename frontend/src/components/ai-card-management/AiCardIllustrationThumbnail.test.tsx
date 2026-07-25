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

import type { AiCardIllustration } from "@/lib/ai-card-management/types";
import { AiCardIllustrationThumbnail } from "./AiCardIllustrationThumbnail";

const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/illustrations/x?token=t";

const render = (illustration: AiCardIllustration | null) =>
	renderToStaticMarkup(<AiCardIllustrationThumbnail illustration={illustration} altText="山" />);

describe("frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.tsx", () => {
	beforeEach(() => {
		imageMock.mockClear();
	});

	it("AC-1: renders the thumbnail with the signed URL and the card front text as alt", () => {
		const html = render({ id: "ill-1", status: "ready", url: SIGNED_URL });

		expect(html).toContain('data-testid="ai-card-illustration-thumbnail"');
		expect(html).toContain("イラスト: ");
		expect(html).toContain("設定済み");
		expect(imageMock).toHaveBeenCalledTimes(1);
		expect(imageMock.mock.calls[0][0]).toMatchObject({
			src: SIGNED_URL,
			alt: "山",
			width: 96,
			height: 96,
		});
		expect(html).not.toContain("ill-1");
	});

	it("AC-2/AC-4: keeps the text-only row when a ready illustration has no signed URL", () => {
		const html = render({ id: "ill-1", status: "ready", url: null });

		expect(html).toContain("設定済み");
		expect(html).not.toContain('data-testid="ai-card-illustration-thumbnail"');
		expect(imageMock).not.toHaveBeenCalled();
	});

	it("AC-2: keeps the text-only row for missing and not-ready illustrations", () => {
		const missing = render(null);
		const pending = render({ id: "ill-1", status: "pending", url: null });

		for (const html of [missing, pending]) {
			expect(html).toContain("イラスト: ");
			expect(html).toContain("なし");
			expect(html).not.toContain("設定済み");
			expect(html).not.toContain('data-testid="ai-card-illustration-thumbnail"');
		}
		expect(imageMock).not.toHaveBeenCalled();
	});
});
