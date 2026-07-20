import { describe, expect, it, vi } from "vitest";

import type { AiImportRepository } from "./service";
import { commitCardImport, getImportStatus, previewCardImport } from "./service";

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
const clientId = "323e4567-e89b-42d3-a456-426614174000";
const otherClientId = "423e4567-e89b-42d3-a456-426614174000";
const deckId = "523e4567-e89b-42d3-a456-426614174000";
const batchId = "623e4567-e89b-42d3-a456-426614174000";
const secret = "test-only-preview-secret";
const nowSeconds = 2_000_000_000;
const reservationKey = "reservation-1";

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

function repository(overrides: Partial<AiImportRepository> = {}): AiImportRepository {
	return {
		validatePreview: vi.fn(async () => ({ data: undefined, error: null })),
		commit: vi.fn(async () => ({
			data: { batchId, status: "queued", statusUrl: `/api/ai/imports/status?batchId=${batchId}` },
			error: null,
		})),
		getStatus: vi.fn(async () => ({
			data: {
				batchId,
				status: "queued",
				counts: { total: 1, succeeded: 0, failed: 0 },
				items: [{ itemId: batchId, conceptId: "concept-1", status: "queued" }],
			},
			error: null,
		})),
		...overrides,
	};
}

describe("S-14 import application service", () => {
	it("keeps the UI v1 preview contract while the repository remains actor-bound", async () => {
		const repo = repository();
		const result = await previewCardImport({
			actor: { userId: ownerId, kind: "app_ai" },
			request,
			cardReservationKey: reservationKey,
			repository: repo,
			secret,
			nowSeconds,
		});

		expect(result).toMatchObject({ ok: true, data: { cardReservationKey: reservationKey } });
		expect(repo.validatePreview).toHaveBeenCalledWith(
			expect.objectContaining({ deckId, reservationKey })
		);
		expect(repo.validatePreview).toHaveBeenCalledWith(
			expect.not.objectContaining({ ownerId: expect.anything(), source: expect.anything() })
		);
	});

	it("allows remote OAuth client rotation while keeping commit repository actor-bound", async () => {
		const repo = repository();
		const preview = await previewCardImport({
			actor: { userId: ownerId, clientId, kind: "remote_mcp" },
			request,
			cardReservationKey: reservationKey,
			repository: repo,
			secret,
			nowSeconds,
		});
		expect(preview.ok).toBe(true);
		if (!preview.ok) return;

		const result = await commitCardImport({
			actor: { userId: ownerId, clientId: otherClientId, kind: "remote_mcp" },
			input: {
				request,
				previewToken: preview.data.previewToken,
				cardReservationKey: reservationKey,
				importRequestHash: preview.data.importRequestHash,
				idempotencyKey: "idem-1",
				confirmedWarnings: true,
			},
			repository: repo,
			secret,
			nowSeconds,
			correlationId: "test-correlation",
		});

		expect(result).toEqual({
			ok: true,
			data: { batchId, status: "queued", statusUrl: `/api/ai/imports/status?batchId=${batchId}` },
		});
		expect(repo.commit).toHaveBeenCalledWith(
			expect.objectContaining({
				importRequestHash: preview.data.importRequestHash,
				cardReservationKey: reservationKey,
			})
		);
	});

	it("uses the same normalized request for UI commit and returns the async contract", async () => {
		const repo = repository();
		const preview = await previewCardImport({
			actor: { userId: ownerId, kind: "app_ai" },
			request,
			cardReservationKey: reservationKey,
			repository: repo,
			secret,
			nowSeconds,
		});
		expect(preview.ok).toBe(true);
		if (!preview.ok) return;

		const result = await commitCardImport({
			actor: { userId: ownerId, kind: "app_ai" },
			input: {
				request,
				previewToken: preview.data.previewToken,
				cardReservationKey: reservationKey,
				importRequestHash: preview.data.importRequestHash,
				idempotencyKey: "idem-1",
				confirmedWarnings: true,
			},
			repository: repo,
			secret,
			nowSeconds,
			correlationId: "test-correlation",
		});

		expect(result).toEqual({
			ok: true,
			data: { batchId, status: "queued", statusUrl: `/api/ai/imports/status?batchId=${batchId}` },
		});
		expect(repo.commit).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "idem-1",
				request: expect.objectContaining({ deck: { id: deckId } }),
			})
		);
	});

	it("keeps the status DTO strict and hides owner-missing repository failures", async () => {
		const repo = repository({
			getStatus: vi.fn(async () => ({ data: null, error: { code: "P1003", message: "raw" } })),
		});
		const result = await getImportStatus({
			input: { batchId },
			repository: repo,
			correlationId: "test-correlation",
		});
		expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND", httpStatus: 404 } });
	});

	it("rejects malformed status input before any repository call", async () => {
		const repo = repository();
		const result = await getImportStatus({
			input: { batchId, idempotencyKey: "idem-1" },
			repository: repo,
			correlationId: "test-correlation",
		});
		expect(result).toEqual({ ok: false, error: { code: "VALIDATION_ERROR", httpStatus: 400 } });
		expect(repo.getStatus).not.toHaveBeenCalled();
	});
});
