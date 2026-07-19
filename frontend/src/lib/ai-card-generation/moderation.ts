import type { OpenAiCardGenerationConfig } from "@/lib/env";

import type { SanitizedSourceImage } from "./contracts";
import { AiCardGenerationError, type AiCardGenerationErrorCode } from "./errors";
import { toImageDataUrl } from "./image-data-url";

export type ModerationInput =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "image"; readonly image: SanitizedSourceImage };

export function buildModerationPayload(
	model: string,
	input: ModerationInput
): Readonly<Record<string, unknown>> {
	return input.kind === "text"
		? { model, input: input.text }
		: { model, input: [{ type: "image_url", image_url: { url: toImageDataUrl(input.image) } }] };
}

export function parseModerationResponse(value: unknown): boolean {
	if (
		!isRecord(value) ||
		!Array.isArray(value.results) ||
		value.results.length !== 1 ||
		!isRecord(value.results[0]) ||
		typeof value.results[0].flagged !== "boolean"
	) {
		throw new AiCardGenerationError("OPENAI_MODERATION_UNAVAILABLE");
	}
	return value.results[0].flagged;
}

export async function moderate(args: {
	readonly config: OpenAiCardGenerationConfig;
	readonly input: ModerationInput;
	readonly flaggedCode: Extract<
		AiCardGenerationErrorCode,
		"OPENAI_INPUT_TEXT_MODERATION" | "OPENAI_INPUT_IMAGE_MODERATION" | "OPENAI_OUTPUT_MODERATION"
	>;
	readonly fetcher?: typeof fetch;
}): Promise<void> {
	const fetcher = args.fetcher ?? fetch;
	let response: Response;
	try {
		response = await fetcher("https://api.openai.com/v1/moderations", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${args.config.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildModerationPayload(args.config.moderationModel, args.input)),
			signal: AbortSignal.timeout(args.config.moderationTimeoutMs),
		});
	} catch {
		throw new AiCardGenerationError("OPENAI_MODERATION_UNAVAILABLE");
	}
	if (!response.ok) {
		try {
			await response.body?.cancel();
		} catch {
			/* availability result remains authoritative */
		}
		throw new AiCardGenerationError("OPENAI_MODERATION_UNAVAILABLE");
	}
	let value: unknown;
	try {
		value = await response.json();
	} catch {
		throw new AiCardGenerationError("OPENAI_MODERATION_UNAVAILABLE");
	}
	if (parseModerationResponse(value)) throw new AiCardGenerationError(args.flaggedCode);
}

export function serializeCardsForModeration(
	cards: readonly { readonly front: string; readonly back: string }[]
): string {
	return cards
		.map((card, index) => `[CARD ${index + 1} FRONT]\n${card.front}\n[BACK]\n${card.back}`)
		.join("\n");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
