"use client";

import type { AiCardIllustration } from "@/lib/ai-card-management/types";
import Image from "next/image";
import { useState } from "react";

interface Props {
	readonly illustration: AiCardIllustration | null;
	readonly altText: string;
}

export const AI_CARD_ILLUSTRATION_THUMBNAIL_TEST_ID = "ai-card-illustration-thumbnail";

/**
 * Illustration row of one managed card.  The text line keeps the pre-existing
 * wording and spacing; the thumbnail is added below it only when the server
 * produced a signed URL, so cards without an image keep their former height.
 */
export function AiCardIllustrationThumbnail({ illustration, altText }: Props) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const isReady = illustration !== null && illustration.status === "ready";
	const url = isReady ? illustration.url : null;
	const showThumbnail = url !== null && url !== failedUrl;

	return (
		<>
			<p className="mt-1 text-xs text-slate-500">イラスト: {isReady ? "設定済み" : "なし"}</p>
			{showThumbnail ? (
				<Image
					data-testid={AI_CARD_ILLUSTRATION_THUMBNAIL_TEST_ID}
					src={url}
					alt={altText}
					width={96}
					height={96}
					sizes="96px"
					loading="lazy"
					className="mt-2 h-24 w-24 rounded-lg border border-slate-200 object-cover"
					onError={() => setFailedUrl(url)}
				/>
			) : null}
		</>
	);
}
