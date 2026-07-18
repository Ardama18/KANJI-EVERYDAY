import type { ClientImportRequestInput } from "@/lib/ai-import/schema";
import type { OpenAiCardGenerationConfig } from "@/lib/env";

export type GenerationPattern = "R1" | "W1" | "both";
export type GenerationIllustrationMode = "none" | "ai" | "upload";

export interface GenerateCardDraftInput {
	readonly deckId: string;
	readonly instruction: string;
	readonly pattern: GenerationPattern;
	readonly requestedCardCount: number;
	readonly tags: readonly string[];
	readonly illustration: GenerationIllustrationMode;
	readonly generationReservationKey: string;
}

export interface SanitizedSourceImage {
	readonly mime: "image/png";
	readonly bytes: Uint8Array;
}

export interface OpenAiConceptOutput {
	readonly kanjiSide: string;
	readonly counterpartSide: string;
}

export interface PreviewEnvelope {
	readonly request: ClientImportRequestInput;
	readonly importRequestHash: string;
	readonly previewToken: string;
	readonly previewExpiresAt: number;
	readonly cardReservationKey: string;
	readonly warnings: readonly ["accuracy", "privacy", "copyright"];
}

export interface DraftEnvelope {
	readonly request: ClientImportRequestInput;
	readonly requiresIllustrationUploads: readonly string[];
}

export type GenerateCardDraftResponse = PreviewEnvelope | DraftEnvelope;

export type ResponsesPayload = {
	readonly model: string;
	readonly store: false;
	readonly background: false;
	readonly max_output_tokens: 32768;
	readonly input: readonly [
		{
			readonly role: "developer";
			readonly content: readonly [{ readonly type: "input_text"; readonly text: string }];
		},
		{
			readonly role: "user";
			readonly content: readonly (
				| { readonly type: "input_text"; readonly text: string }
				| {
						readonly type: "input_image";
						readonly image_url: string;
						readonly detail: OpenAiCardGenerationConfig["imageDetail"];
				  }
			)[];
		},
	];
	readonly text: {
		readonly format: {
			readonly type: "json_schema";
			readonly name: "kanji_card_concepts";
			readonly strict: true;
			readonly schema: {
				readonly type: "object";
				readonly additionalProperties: false;
				readonly required: readonly ["concepts"];
				readonly properties: {
					readonly concepts: {
						readonly type: "array";
						readonly minItems: number;
						readonly maxItems: number;
						readonly items: Readonly<Record<string, unknown>>;
					};
				};
			};
		};
	};
};

export const PREVIEW_WARNINGS = ["accuracy", "privacy", "copyright"] as const;
