import { hashGenerationRequest } from "@/lib/ai-import/canonical-request";

import type {
	DraftEnvelope,
	GenerateCardDraftInput,
	OpenAiConceptOutput,
	PreviewEnvelope,
	SanitizedSourceImage,
} from "./contracts";
import { mapConceptsToImportRequest } from "./output-mapper";

export interface GenerationSource extends SanitizedSourceImage {
	readonly digest: string;
}

export interface GenerationServiceDependencies {
	readonly moderateText: (text: string, stage: "input" | "output") => Promise<void>;
	readonly moderateImage: (image: SanitizedSourceImage) => Promise<void>;
	readonly reserveUsage: (value: {
		readonly reservationKey: string;
		readonly generationRequestHash: string;
		readonly units: number;
	}) => Promise<void>;
	readonly requestConcepts: (
		input: GenerateCardDraftInput,
		images: readonly SanitizedSourceImage[]
	) => Promise<readonly OpenAiConceptOutput[]>;
	readonly createPreview: (
		request: Awaited<ReturnType<typeof mapConceptsToImportRequest>>,
		reservationKey: string
	) => Promise<PreviewEnvelope>;
}

export async function generateCardDraft(
	input: GenerateCardDraftInput,
	sources: readonly GenerationSource[],
	dependencies: GenerationServiceDependencies
): Promise<PreviewEnvelope | DraftEnvelope> {
	await dependencies.moderateText(input.instruction, "input");
	for (const source of sources) await dependencies.moderateImage(source);
	const generationRequestHash = await hashGenerationRequest({
		input: {
			instruction: input.instruction,
			sourceDigests: sources.map((source) => source.digest),
		},
		options: { pattern: input.pattern, tags: [...input.tags], illustration: input.illustration },
		requestedUnits: { cardGeneration: input.requestedCardCount, illustrationConcept: 0 },
	});
	await dependencies.reserveUsage({
		reservationKey: input.generationReservationKey,
		generationRequestHash,
		units: input.requestedCardCount,
	});
	const concepts = await dependencies.requestConcepts(input, sources);
	const request = await mapConceptsToImportRequest(input, concepts);
	const outputText = request.items
		.map((item, index) => `[CARD ${index + 1} FRONT]\n${item.front}\n[BACK]\n${item.back}`)
		.join("\n");
	await dependencies.moderateText(outputText, "output");
	if (input.illustration === "upload") {
		return {
			request,
			requiresIllustrationUploads: [...new Set(request.items.map((item) => item.conceptId))],
		};
	}
	return await dependencies.createPreview(request, input.generationReservationKey);
}
