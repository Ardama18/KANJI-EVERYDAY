import { hashGenerationRequest } from "@/lib/ai-import/canonical-request";

import type {
	DraftEnvelope,
	GenerateCardDraftInput,
	MnemonicDraftEntry,
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
	const cardText = request.items
		.map((item, index) => `[CARD ${index + 1} FRONT]\n${item.front}\n[BACK]\n${item.back}`)
		.join("\n");
	const mnemonicText = concepts
		.map((concept, index) => {
			const { slots, explanation } = concept.mnemonic;
			const mappings = explanation.mappings
				.map((mapping) => `${mapping.part} -> ${mapping.meaning}`)
				.join("\n");
			return `[MNEMONIC ${index + 1}]\n${slots.kanji}\n${slots.shapeHint.part}\n${slots.shapeHint.picture}\n${slots.meaningHint}\n${slots.story}\n${explanation.summary}\n${mappings}`;
		})
		.join("\n");
	await dependencies.moderateText(`${cardText}\n${mnemonicText}`, "output");
	const mnemonicDraft: readonly MnemonicDraftEntry[] = concepts.map((concept, index) => ({
		conceptId: `concept-${String(index + 1).padStart(3, "0")}`,
		slots: concept.mnemonic.slots,
		explanation: concept.mnemonic.explanation,
	}));
	if (input.illustration === "upload") {
		return {
			request,
			requiresIllustrationUploads: [...new Set(request.items.map((item) => item.conceptId))],
			mnemonicDraft,
		};
	}
	const preview = await dependencies.createPreview(request, input.generationReservationKey);
	return { ...preview, mnemonicDraft };
}
