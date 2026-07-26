import { describe, expect, it, vi } from "vitest";

import type { AiCardMnemonicRepository } from "./app-ai-repository";
import type { AiCardManagementRepository } from "./service";
import {
	deleteAiCards,
	listAiCards,
	setAiCardIllustration,
	setAiCardTagNames,
	undoAiImportBatch,
	updateAiCardContent,
	updateAiCardMnemonic,
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

	it("S-20 AC-15: keeps the illustration service path after the UI form was removed", async () => {
		const repo = repository();
		const result = await setAiCardIllustration(repo, { cardId, illustrationId: relatedId });
		expect(result).toEqual({ ok: true, data: { changed: true } });
		expect(repo.setIllustration).toHaveBeenCalledWith({ cardId, illustrationId: relatedId });

		const invalid = await setAiCardIllustration(repo, { cardId, illustrationId: "not-a-uuid" });
		expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
		expect(repo.setIllustration).toHaveBeenCalledOnce();
	});

	it("S-20: keeps the list DTO usable when the RPC predates the mnemonic projection", async () => {
		// Deployment skew: the fixture carries none of the S-20 keys.
		const result = await listAiCards(repository(), {});
		expect(result).toMatchObject({
			ok: true,
			data: { items: [{ illustrationKey: null, mnemonic: null, mnemonicSharedCardCount: 0 }] },
		});
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

const VALID_MNEMONIC_INPUT = {
	cardId,
	illustrationKey: "見",
	slots: {
		kanji: "見",
		isSingleKanji: true,
		shapeHint: { part: "下の「見」", picture: "目" },
		meaningHint: "見る・気づく",
		story: "目で見たものが頭の中で光って記憶に残る",
	},
	explanation: {
		summary: "目で見たものが、頭の中で光って記憶に残る。",
		mappings: [
			{ part: "下の「見」", meaning: "目で見る" },
			{ part: "上の光", meaning: "頭の中で気づく" },
		],
	},
} as const;

function mnemonicRepository(
	overrides: Partial<AiCardMnemonicRepository> = {}
): AiCardMnemonicRepository {
	return {
		findOwnedCardByIllustrationKey: vi.fn(async () => ({ data: { id: cardId }, error: null })),
		upsertMnemonic: vi.fn(async () => ({ data: null, error: null })),
		...overrides,
	};
}

describe("S-20 post-commit mnemonic edit service", () => {
	it("AC-3: upserts the sanitized entry for the verified card", async () => {
		const repo = mnemonicRepository();
		const result = await updateAiCardMnemonic(repo, {
			...VALID_MNEMONIC_INPUT,
			slots: { ...VALID_MNEMONIC_INPUT.slots, meaningHint: "  見る・気づく  " },
		});

		expect(result).toEqual({ ok: true, data: null });
		expect(repo.findOwnedCardByIllustrationKey).toHaveBeenCalledWith({
			cardId,
			illustrationKey: "見",
		});
		// The server re-normalizes: the padded value never reaches the table as-is,
		// and no owner or status travels in the command.
		expect(repo.upsertMnemonic).toHaveBeenCalledWith({
			illustrationKey: "見",
			slots: expect.objectContaining({ meaningHint: "見る・気づく" }),
			explanation: VALID_MNEMONIC_INPUT.explanation,
		});
		expect(repo.upsertMnemonic).toHaveBeenCalledOnce();
		const command = vi.mocked(repo.upsertMnemonic).mock.calls[0]?.[0];
		expect(command).not.toHaveProperty("ownerUserId");
		expect(command).not.toHaveProperty("status");
	});

	it("AC-6: returns NOT_FOUND without writing when the card/key pair is not the caller's", async () => {
		const repo = mnemonicRepository({
			findOwnedCardByIllustrationKey: vi.fn(async () => ({ data: null, error: null })),
		});

		const result = await updateAiCardMnemonic(repo, {
			...VALID_MNEMONIC_INPUT,
			illustrationKey: "他人のキー",
		});

		expect(result).toEqual({
			ok: false,
			error: { code: "NOT_FOUND", status: 404, message: "対象が見つかりません。" },
		});
		expect(repo.upsertMnemonic).not.toHaveBeenCalled();
	});

	it("AC-6: never writes when the ownership lookup itself fails", async () => {
		const repo = mnemonicRepository({
			findOwnedCardByIllustrationKey: vi.fn(async () => ({
				data: null,
				error: { code: "XX000", message: "raw SQL body" },
			})),
		});

		const result = await updateAiCardMnemonic(repo, VALID_MNEMONIC_INPUT);

		expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
		expect(JSON.stringify(result)).not.toContain("raw SQL body");
		expect(repo.upsertMnemonic).not.toHaveBeenCalled();
	});

	it.each([
		[
			"kanji of 17 code points",
			{ slots: { ...VALID_MNEMONIC_INPUT.slots, kanji: "見".repeat(17) } },
		],
		[
			"text of 101 code points",
			{ slots: { ...VALID_MNEMONIC_INPUT.slots, story: "あ".repeat(101) } },
		],
		[
			"summary of 121 code points",
			{
				explanation: { ...VALID_MNEMONIC_INPUT.explanation, summary: "あ".repeat(121) },
			},
		],
		[
			"a single mapping",
			{
				explanation: {
					...VALID_MNEMONIC_INPUT.explanation,
					mappings: [{ part: "部品", meaning: "意味" }],
				},
			},
		],
		[
			"five mappings",
			{
				explanation: {
					...VALID_MNEMONIC_INPUT.explanation,
					mappings: Array.from({ length: 5 }, (_, index) => ({
						part: `部品${index}`,
						meaning: `意味${index}`,
					})),
				},
			},
		],
		["a blank illustration key", { illustrationKey: "   " }],
		["a non-UUID card id", { cardId: "not-a-uuid" }],
	])(
		"AC-5/AC-6: rejects %s before any ownership lookup or write",
		async (_label, patch: Record<string, unknown>) => {
			const repo = mnemonicRepository();

			const result = await updateAiCardMnemonic(repo, { ...VALID_MNEMONIC_INPUT, ...patch });

			expect(result).toEqual({
				ok: false,
				error: { code: "VALIDATION_ERROR", status: 400, message: "入力内容を確認してください。" },
			});
			expect(repo.findOwnedCardByIllustrationKey).not.toHaveBeenCalled();
			expect(repo.upsertMnemonic).not.toHaveBeenCalled();
		}
	);
});
