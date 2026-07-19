import { describe, expect, it, vi } from "vitest";

import type { AiCardManagementRepository } from "./service";
import {
	deleteAiCards,
	listAiCards,
	setAiCardTagNames,
	undoAiImportBatch,
	updateAiCardContent,
} from "./service";

const cardId = "123e4567-e89b-42d3-a456-426614174000";
const relatedId = "223e4567-e89b-42d3-a456-426614174001";
const createdAt = "2026-07-19T03:04:05.000Z";

function repository(
	overrides: Partial<AiCardManagementRepository> = {}
): AiCardManagementRepository {
	return {
		list: vi.fn(async () => ({
			data: {
				hasMore: true,
				items: [
					{
						id: cardId,
						frontText: "漢",
						backText: "かん",
						skill: "reading",
						pattern: "R1",
						createdAt,
						updatedAt: createdAt,
						source: "app_ai",
						batchId: relatedId,
						itemId: cardId,
						decks: [],
						tags: [],
						illustration: null,
					},
				],
			},
			error: null,
		})),
		updateContent: vi.fn(async () => ({ data: { changed: true }, error: null })),
		setDecks: vi.fn(async () => ({ data: { changed: true }, error: null })),
		setTags: vi.fn(async () => ({ data: { changed: true }, error: null })),
		setTagNames: vi.fn(async () => ({ data: { changed: true }, error: null })),
		setIllustration: vi.fn(async () => ({ data: { changed: true }, error: null })),
		deleteCards: vi.fn(async () => ({ data: { changed: true }, error: null })),
		undoImport: vi.fn(async () => ({ data: { changed: true }, error: null })),
		...overrides,
	};
}

describe("S-14 AI card management application service", () => {
	it("keeps the S-13 cursor DTO contract while the repository has no actor input", async () => {
		const repo = repository();
		const result = await listAiCards(repo, { limit: 1, source: "app_ai" });
		expect(result).toMatchObject({ ok: true, data: { items: [{ id: cardId }] } });
		if (!result.ok) return;
		expect(result.data.nextCursor).toEqual(expect.any(String));
		expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, source: "app_ai" }));
	});

	it("rejects invalid filters before listing", async () => {
		const repo = repository();
		const result = await listAiCards(repo, { limit: 0 });
		expect(result).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", status: 400, message: "入力内容を確認してください。" },
		});
		expect(repo.list).not.toHaveBeenCalled();
	});

	it("normalizes content updates before invoking the UI or remote repository", async () => {
		const repo = repository();
		const result = await updateAiCardContent(repo, {
			cardId,
			expectedUpdatedAt: createdAt,
			frontText: " 漢 ",
			backText: " かん ",
			skill: "reading",
			pattern: "R1",
		});
		expect(result).toEqual({ ok: true, data: { changed: true } });
		expect(repo.updateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				cardId,
				patch: expect.objectContaining({ frontText: "漢", backText: "かん" }),
			})
		);
	});

	it("preserves tag validation and rejects duplicates before mutation", async () => {
		const repo = repository();
		const result = await setAiCardTagNames(repo, { cardId, tagNames: [" 一年生 ", "一年生"] });
		expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
		expect(repo.setTagNames).not.toHaveBeenCalled();
	});

	it("keeps one-to-one bulk-delete validation and the undo UUID boundary", async () => {
		const repo = repository();
		const deleteResult = await deleteAiCards(repo, [
			{ cardId, expectedUpdatedAt: createdAt },
			{ cardId: relatedId, expectedUpdatedAt: createdAt },
		]);
		expect(deleteResult).toEqual({ ok: true, data: { changed: true } });
		expect(repo.deleteCards).toHaveBeenCalledOnce();

		const undoResult = await undoAiImportBatch(repo, "not-a-uuid");
		expect(undoResult).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
		expect(repo.undoImport).not.toHaveBeenCalled();
	});

	it("sanitizes unexpected repository errors without exposing their provider body", async () => {
		const repo = repository({
			updateContent: vi.fn(async () => ({
				data: null,
				error: { code: "XX000", message: "raw SQL body" },
			})),
		});
		const result = await updateAiCardContent(repo, {
			cardId,
			expectedUpdatedAt: createdAt,
			frontText: "漢",
			backText: "かん",
			skill: "reading",
			pattern: "R1",
		});
		expect(result).toEqual({
			ok: false,
			error: {
				code: "INTERNAL_ERROR",
				status: 500,
				message: "処理に失敗しました。時間をおいて再試行してください。",
			},
		});
	});
});
