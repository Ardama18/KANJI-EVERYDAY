import { PREVIEW_WARNINGS, type PreviewEnvelope } from "../ai-card-generation/contracts";
import { hashImportRequest } from "./canonical-request";
import {
	PREVIEW_TOKEN_TTL_SECONDS,
	signPreviewToken,
	signRemotePreviewToken,
} from "./preview-token";
import { type ClientImportRequestInput, validateImportRequest } from "./schema";

export interface PreviewServiceDependencies {
	readonly validateDatabase: (value: {
		readonly deckId: string;
		readonly reservationKey: string;
		readonly importRequestHash: string;
		readonly uploadIds: readonly string[];
		readonly items: readonly { readonly clientItemId: string; readonly cardKey: string }[];
	}) => Promise<void>;
	readonly secret: string;
	readonly nowSeconds: number;
}

export async function createImportPreview(
	actorUserId: string,
	request: unknown,
	cardReservationKey: string,
	dependencies: PreviewServiceDependencies
): Promise<PreviewEnvelope> {
	return await createPreview(actorUserId, request, cardReservationKey, dependencies, undefined);
}

export async function createRemoteImportPreview(
	actor: Readonly<{ userId: string; clientId: string }>,
	request: unknown,
	cardReservationKey: string,
	dependencies: PreviewServiceDependencies
): Promise<PreviewEnvelope> {
	return await createPreview(
		actor.userId,
		request,
		cardReservationKey,
		dependencies,
		actor.clientId
	);
}

async function createPreview(
	actorUserId: string,
	request: unknown,
	cardReservationKey: string,
	dependencies: PreviewServiceDependencies,
	remoteClientId: string | undefined
): Promise<PreviewEnvelope> {
	const validated = await validateImportRequest(request);
	if (!validated.success || !("id" in validated.data.deck))
		throw new PreviewValidationError(validated.success ? "DECK_NOT_FOUND" : validated.code);
	const normalized: ClientImportRequestInput = {
		deck: { id: validated.data.deck.id },
		items: validated.data.items.map((item) => ({
			clientItemId: item.clientItemId,
			conceptId: item.conceptId,
			pattern: item.pattern,
			front: item.front,
			back: item.back,
			tags: [...item.tags],
			image:
				item.image.mode === "upload"
					? { mode: "upload", uploadId: item.image.uploadId }
					: { mode: item.image.mode },
		})),
	};
	const importRequestHash = await hashImportRequest(validated.data);
	const uploadIds = normalized.items.flatMap((item) =>
		item.image.mode === "upload" ? [item.image.uploadId] : []
	);
	await dependencies.validateDatabase({
		deckId: validated.data.deck.id,
		reservationKey: cardReservationKey,
		importRequestHash,
		uploadIds: [...new Set(uploadIds)],
		items: validated.data.items.map((item) => ({
			clientItemId: item.clientItemId,
			cardKey: item.cardKey,
		})),
	});
	const tokenInput = {
		userId: actorUserId,
		reservationKey: cardReservationKey,
		importRequestHash,
	};
	const previewToken =
		remoteClientId === undefined
			? await signPreviewToken(tokenInput, dependencies.secret, dependencies.nowSeconds)
			: await signRemotePreviewToken(
					{ ...tokenInput, clientId: remoteClientId },
					dependencies.secret,
					dependencies.nowSeconds
				);
	return {
		request: normalized,
		importRequestHash,
		previewToken,
		previewExpiresAt: dependencies.nowSeconds + PREVIEW_TOKEN_TTL_SECONDS,
		cardReservationKey,
		warnings: PREVIEW_WARNINGS,
	};
}

export class PreviewValidationError extends Error {
	constructor(
		readonly code: string,
		readonly httpStatus = 400
	) {
		super(code);
		this.name = "PreviewValidationError";
	}
}
