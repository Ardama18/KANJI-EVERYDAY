import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiCardManagementClient, managedCardSyncKey } from "./AiCardManagementClient";

const CARD_ID = "123e4567-e89b-42d3-a456-426614174000";
const BATCH_ID = "223e4567-e89b-42d3-a456-426614174001";
const CREATED_AT = "2026-07-19T03:04:05.000Z";

describe("S-13 AI card management UI", () => {
	it("remounts uncontrolled editors when refreshed server state changes", () => {
		const card = {
			id: CARD_ID,
			frontText: "山",
			backText: "やま",
			skill: "reading" as const,
			pattern: "R1" as const,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
			source: "app_ai" as const,
			batchId: BATCH_ID,
			itemId: CARD_ID,
			decks: [],
			tags: [],
			illustration: null,
		};
		const initialKey = managedCardSyncKey(card);

		expect(managedCardSyncKey({ ...card, frontText: "川" })).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...card,
				decks: [{ id: BATCH_ID, name: "復習" }],
			})
		).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...card,
				tags: [{ id: BATCH_ID, name: "一年生" }],
			})
		).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...card,
				illustration: { id: BATCH_ID, status: "ready" },
			})
		).not.toBe(initialKey);
	});

	it("distinguishes the empty result and exposes all AND filters", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ items: [], nextCursor: null }}
				initialError={null}
				initialOptions={{
					status: "ready",
					data: { decks: [], tags: [], illustrations: [] },
				}}
			/>
		);
		expect(html).toContain("条件に合うAIカードはありません");
		expect(html).toContain('name="deckId"');
		expect(html).toContain('name="tagId"');
		expect(html).toContain('name="source"');
		expect(html).toContain('name="createdFrom"');
		expect(html).toContain('name="createdTo"');
	});

	it("offers labeled edit, delete, and undo controls with no storage path", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{
					nextCursor: "opaque",
					items: [
						{
							id: CARD_ID,
							frontText: "山",
							backText: "やま",
							skill: "reading",
							pattern: "R1",
							createdAt: CREATED_AT,
							updatedAt: CREATED_AT,
							source: "app_ai",
							batchId: BATCH_ID,
							itemId: CARD_ID,
							decks: [],
							tags: [],
							illustration: null,
						},
					],
				}}
				initialError={null}
				initialOptions={{
					status: "ready",
					data: { decks: [], tags: [], illustrations: [] },
				}}
			/>
		);
		expect(html).toContain("本文を保存");
		expect(html).toContain("このカードを削除");
		expect(html).toContain("登録バッチを取り消す");
		expect(html).toContain("次の20件を読み込む");
		expect(html).not.toContain("storage_path");
	});

	it("shows an accessible retry and disables relation editing when options fail", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{
					nextCursor: null,
					items: [
						{
							id: CARD_ID,
							frontText: "山",
							backText: "やま",
							skill: "reading",
							pattern: "R1",
							createdAt: CREATED_AT,
							updatedAt: CREATED_AT,
							source: "app_ai",
							batchId: BATCH_ID,
							itemId: CARD_ID,
							decks: [],
							tags: [],
							illustration: null,
						},
					],
				}}
				initialError={null}
				initialOptions={{ status: "error", message: "処理に失敗しました。" }}
			/>
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("デッキ・タグ・イラストの選択肢を取得できませんでした");
		expect(html).toContain("カード情報を再読み込み");
		expect(html).toContain("選択肢を取得できません");
		expect(html).toContain('<fieldset disabled=""');
	});

	it("does not show an empty result when the initial list failed", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ items: [], nextCursor: null }}
				initialError="処理に失敗しました。"
				initialOptions={{
					status: "ready",
					data: { decks: [], tags: [], illustrations: [] },
				}}
			/>
		);
		expect(html).toContain("カード一覧を取得できませんでした");
		expect(html).toContain("カード情報を再読み込み");
		expect(html).not.toContain("条件に合うAIカードはありません");
	});
});
