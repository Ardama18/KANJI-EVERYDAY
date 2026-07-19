import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiCardManagementClient } from "./AiCardManagementClient";

const CARD_ID = "123e4567-e89b-42d3-a456-426614174000";
const BATCH_ID = "223e4567-e89b-42d3-a456-426614174001";
const CREATED_AT = "2026-07-19T03:04:05.000Z";

describe("S-13 AI card management UI", () => {
	it("distinguishes the empty result and exposes all AND filters", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ items: [], nextCursor: null }}
				initialError={null}
				options={{ decks: [], tags: [], illustrations: [] }}
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
				options={{ decks: [], tags: [], illustrations: [] }}
			/>
		);
		expect(html).toContain("本文を保存");
		expect(html).toContain("このカードを削除");
		expect(html).toContain("登録バッチを取り消す");
		expect(html).toContain("次の20件を読み込む");
		expect(html).not.toContain("storage_path");
	});
});
