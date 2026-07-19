import { normalizeDisplayText } from "@/lib/ai-import/normalize";
import { type ClientImportRequestInput, validateImportRequest } from "@/lib/ai-import/schema";
import { isCanonicalUuid } from "@/lib/ai-import/uuid";

import type { GenerateCardDraftInput, OpenAiConceptOutput } from "./contracts";
import { AiCardGenerationError } from "./errors";

export type GenerationInputValidationResult =
	| { readonly success: true; readonly data: GenerateCardDraftInput }
	| { readonly success: false; readonly field: string };

export function validateGenerationInput(
	value: GenerateCardDraftInput
): GenerationInputValidationResult {
	const instruction = normalizeDisplayText(value.instruction);
	if (!isCanonicalUuid(value.deckId)) return { success: false, field: "deckId" };
	if (instruction.length < 1 || Array.from(instruction).length > 4_000)
		return { success: false, field: "instruction" };
	if (
		!Number.isSafeInteger(value.requestedCardCount) ||
		value.requestedCardCount < 1 ||
		value.requestedCardCount > 50
	)
		return { success: false, field: "requestedCardCount" };
	if (value.pattern === "both" && value.requestedCardCount % 2 !== 0)
		return { success: false, field: "requestedCardCount" };
	if (!/^[\x21-\x7e]{1,128}$/u.test(value.generationReservationKey))
		return { success: false, field: "generationReservationKey" };
	if (value.tags.length > 10) return { success: false, field: "tags" };
	if (
		value.tags.some(
			(tag) =>
				Array.from(normalizeDisplayText(tag)).length < 1 ||
				Array.from(normalizeDisplayText(tag)).length > 30
		)
	)
		return { success: false, field: "tags" };
	return {
		success: true,
		data: { ...value, deckId: value.deckId.toLowerCase(), instruction },
	};
}

export function expectedConceptCount(
	input: Pick<GenerateCardDraftInput, "pattern" | "requestedCardCount">
): number {
	return input.pattern === "both" ? input.requestedCardCount / 2 : input.requestedCardCount;
}

export async function mapConceptsToImportRequest(
	input: GenerateCardDraftInput,
	concepts: readonly OpenAiConceptOutput[]
): Promise<ClientImportRequestInput> {
	const checked = validateGenerationInput(input);
	if (!checked.success || concepts.length !== expectedConceptCount(input)) {
		throw new AiCardGenerationError("OPENAI_OUTPUT_SCHEMA_MISMATCH");
	}
	const items: ClientImportRequestInput["items"] = [];
	for (const [index, concept] of concepts.entries()) {
		const conceptId = `concept-${String(index + 1).padStart(3, "0")}`;
		const image = input.illustration === "ai" ? { mode: "ai" as const } : { mode: "none" as const };
		if (input.pattern === "R1" || input.pattern === "both") {
			items.push({
				clientItemId: `${conceptId}-r1`,
				conceptId,
				pattern: "R1",
				front: concept.kanjiSide,
				back: concept.counterpartSide,
				tags: [...input.tags],
				image,
			});
		}
		if (input.pattern === "W1" || input.pattern === "both") {
			items.push({
				clientItemId: `${conceptId}-w1`,
				conceptId,
				pattern: "W1",
				front: concept.counterpartSide,
				back: concept.kanjiSide,
				tags: [...input.tags],
				image,
			});
		}
	}
	const request: ClientImportRequestInput = { deck: { id: input.deckId }, items };
	const validated = await validateImportRequest(request);
	if (!validated.success || items.length !== input.requestedCardCount) {
		throw new AiCardGenerationError("OPENAI_OUTPUT_SCHEMA_MISMATCH");
	}
	return request;
}
