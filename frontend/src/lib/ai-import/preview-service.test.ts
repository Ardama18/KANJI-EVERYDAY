import { describe, expect, it, vi } from "vitest";

import { createImportPreview, createRemoteImportPreview } from "./preview-service";
import { verifyPreviewToken, verifyRemotePreviewToken } from "./preview-token";

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
const clientId = "323e4567-e89b-42d3-a456-426614174000";
const deckId = "523e4567-e89b-42d3-a456-426614174000";
const reservationKey = "reservation-1";
const secret = "test-only-preview-secret";
const nowSeconds = 2_000_000_000;
const request = {
	deck: { id: deckId },
	items: [
		{
			clientItemId: "item-1",
			conceptId: "concept-1",
			pattern: "R1",
			front: " 漢 ",
			back: " かん ",
			tags: [" 一年生 "],
			image: { mode: "none" },
		},
	],
};

function dependencies() {
	return {
		validateDatabase: vi.fn(async () => undefined),
		secret,
		nowSeconds,
	};
}

describe("preview service token adapters", () => {
	it("keeps existing UI preview on token v1 with the same normalized envelope", async () => {
		const deps = dependencies();
		const preview = await createImportPreview(ownerId, request, reservationKey, deps);
		expect(preview.request).toEqual({
			deck: { id: deckId },
			items: [
				{
					clientItemId: "item-1",
					conceptId: "concept-1",
					pattern: "R1",
					front: "漢",
					back: "かん",
					tags: ["一年生"],
					image: { mode: "none" },
				},
			],
		});
		await expect(
			verifyPreviewToken(
				preview.previewToken,
				{
					userId: ownerId,
					reservationKey,
					importRequestHash: preview.importRequestHash,
				},
				secret,
				nowSeconds
			)
		).resolves.toMatchObject({ v: 1 });
		expect(preview.previewExpiresAt).toBe(nowSeconds + 1800);
		expect(preview.warnings).toEqual(["accuracy", "privacy", "copyright"]);
		expect(preview.importRequestHash).toMatch(/^[0-9a-f]{64}$/u);
		expect(deps.validateDatabase).toHaveBeenCalledOnce();
	});

	it("issues remote v2 only from the verified actor client binding", async () => {
		const deps = dependencies();
		const preview = await createRemoteImportPreview(
			{ userId: ownerId, clientId },
			request,
			reservationKey,
			deps
		);
		await expect(
			verifyRemotePreviewToken(
				preview.previewToken,
				{
					userId: ownerId,
					clientId,
					reservationKey,
					importRequestHash: preview.importRequestHash,
				},
				secret,
				nowSeconds
			)
		).resolves.toMatchObject({ v: 2, clientId });
		expect(deps.validateDatabase).toHaveBeenCalledOnce();
	});
});
