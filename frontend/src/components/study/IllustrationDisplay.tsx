"use client";

import type { IllustrationDisplayStatus } from "@/actions/session-actions";
import Image from "next/image";
import { useState } from "react";

type IllustrationDisplayProps = {
	illustrationStatus: IllustrationDisplayStatus;
	illustrationUrl: string | null;
};

type IllustrationRenderState = "hidden" | "loading" | "failed" | "image" | "fallback";

const TEST_IDS = {
	region: "illustration-region",
	image: "illustration-image",
	loading: "illustration-loading",
	failed: "illustration-failed",
	fallback: "illustration-fallback",
} as const;

const REGION_CLASS_NAME =
	"mt-6 flex w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50";
const PLACEHOLDER_CLASS_NAME = "flex h-28 w-full items-center justify-center px-3 text-center";

export const resolveIllustrationRenderState = (
	illustrationStatus: IllustrationDisplayStatus,
	imageLoadFailed: boolean,
	illustrationUrl: string | null
): IllustrationRenderState => {
	if (illustrationStatus === "none") {
		return "hidden";
	}

	if (illustrationStatus === "pending" || illustrationStatus === "generating") {
		return "loading";
	}

	if (illustrationStatus === "failed") {
		return "failed";
	}

	if (imageLoadFailed || illustrationUrl === null) {
		return "fallback";
	}

	return "image";
};

const renderPlaceholder = (
	testId: typeof TEST_IDS.failed | typeof TEST_IDS.loading | typeof TEST_IDS.fallback,
	message: string
) => (
	<div data-testid={testId} className={PLACEHOLDER_CLASS_NAME}>
		<p className="text-sm text-slate-500">{message}</p>
	</div>
);

export function IllustrationDisplay({
	illustrationStatus,
	illustrationUrl,
}: IllustrationDisplayProps) {
	const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
	const imageLoadFailed = illustrationUrl !== null && failedImageUrl === illustrationUrl;

	const renderState = resolveIllustrationRenderState(
		illustrationStatus,
		imageLoadFailed,
		illustrationUrl
	);

	if (renderState === "hidden") {
		return null;
	}

	return (
		<div data-testid={TEST_IDS.region} className={REGION_CLASS_NAME}>
			{renderState === "loading" &&
				renderPlaceholder(TEST_IDS.loading, "イラストを準備しています...")}
			{renderState === "failed" && renderPlaceholder(TEST_IDS.failed, "イラストは準備中です")}
			{renderState === "fallback" && renderPlaceholder(TEST_IDS.fallback, "イラストは準備中です")}
			{renderState === "image" && illustrationUrl !== null && (
				<Image
					data-testid={TEST_IDS.image}
					src={illustrationUrl}
					alt="カードのイラスト"
					width={512}
					height={512}
					sizes="(max-width: 768px) 280px, 280px"
					loading="lazy"
					className="h-auto w-full rounded-xl object-cover"
					onError={() => {
						setFailedImageUrl(illustrationUrl);
					}}
				/>
			)}
		</div>
	);
}
