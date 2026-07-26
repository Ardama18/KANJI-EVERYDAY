import type { ComponentPropsWithoutRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ManagedAiCard, ManagedCardMnemonic } from "@/lib/ai-card-management/types";

type MockImageProps = ComponentPropsWithoutRef<"img"> & {
	src: string;
};

vi.mock("next/image", () => ({
	default: (props: MockImageProps) => <img {...props} alt={props.alt ?? ""} />,
}));

import {
	AiCardManagementClient,
	managedCardSyncKey,
	mnemonicMutationInput,
} from "./AiCardManagementClient";

const CARD_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_CARD_ID = "323e4567-e89b-42d3-a456-426614174002";
const BATCH_ID = "223e4567-e89b-42d3-a456-426614174001";
const CREATED_AT = "2026-07-19T03:04:05.000Z";
const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/illustrations/x?token=t";

const MNEMONIC: ManagedCardMnemonic = {
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
	status: "approved",
};

const baseCard: ManagedAiCard = {
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
	illustrationKey: null,
	mnemonic: null,
	mnemonicSharedCardCount: 0,
};

const readyOptions = { status: "ready" as const, data: { decks: [], tags: [] } };

describe("S-13 AI card management UI", () => {
	it("remounts uncontrolled editors when refreshed server state changes", () => {
		const initialKey = managedCardSyncKey(baseCard);

		expect(managedCardSyncKey({ ...baseCard, frontText: "川" })).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...baseCard,
				decks: [{ id: BATCH_ID, name: "復習" }],
			})
		).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...baseCard,
				tags: [{ id: BATCH_ID, name: "一年生" }],
			})
		).not.toBe(initialKey);
		expect(
			managedCardSyncKey({
				...baseCard,
				illustration: { id: BATCH_ID, status: "ready", url: null },
			})
		).not.toBe(initialKey);
	});

	it("S-20: remounts the row when only the mnemonic or its shared count changes", () => {
		// A mnemonic save does not move cards.updated_at, so the fingerprint is the
		// only thing that can force the controlled form back in sync.
		const withMnemonic = { ...baseCard, illustrationKey: "見", mnemonic: MNEMONIC };
		const baseKey = managedCardSyncKey(withMnemonic);

		expect(baseKey).not.toBe(managedCardSyncKey(baseCard));
		expect(
			managedCardSyncKey({
				...withMnemonic,
				mnemonic: {
					...MNEMONIC,
					explanation: { ...MNEMONIC.explanation, summary: "編集後のまとめ。" },
				},
			})
		).not.toBe(baseKey);
		expect(managedCardSyncKey({ ...withMnemonic, mnemonicSharedCardCount: 2 })).not.toBe(baseKey);
	});

	it("S-18: keeps the editor mount key stable when only the signed URL changes", () => {
		const card = {
			...baseCard,
			illustration: { id: BATCH_ID, status: "ready", url: null },
		};

		const keyWithUrl = managedCardSyncKey({
			...card,
			illustration: { id: BATCH_ID, status: "ready", url: SIGNED_URL },
		});
		const keyWithRotatedUrl = managedCardSyncKey({
			...card,
			illustration: { id: BATCH_ID, status: "ready", url: `${SIGNED_URL}-rotated` },
		});

		expect(keyWithUrl).toBe(managedCardSyncKey(card));
		expect(keyWithRotatedUrl).toBe(managedCardSyncKey(card));
		expect(managedCardSyncKey(card)).not.toContain(SIGNED_URL);
	});

	it("S-18/S-20: shows a thumbnail only for the ready card and keeps every remaining control", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{
					nextCursor: "opaque",
					items: [
						{
							...baseCard,
							illustration: { id: BATCH_ID, status: "ready", url: SIGNED_URL },
						},
						{
							...baseCard,
							id: SECOND_CARD_ID,
							itemId: SECOND_CARD_ID,
							frontText: "川",
							illustration: { id: BATCH_ID, status: "pending", url: null },
						},
					],
				}}
				initialError={null}
				initialOptions={readyOptions}
			/>
		);

		// AC-13: the thumbnail stays.
		expect(html.match(/data-testid="ai-card-illustration-thumbnail"/g)).toHaveLength(1);
		expect(html).toContain(`src="${SIGNED_URL}"`);
		expect(html).toContain("設定済み");
		expect(html).toContain("なし");
		expect(html).toContain("本文を保存");
		expect(html).toContain("タグを保存");
		expect(html).toContain("このカードを削除");
		expect(html).toContain("次の20件を読み込む");
		expect(html).not.toContain("storage_path");
	});

	it("distinguishes the empty result and exposes all AND filters", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ items: [], nextCursor: null }}
				initialError={null}
				initialOptions={readyOptions}
			/>
		);
		expect(html).toContain("条件に合うAIカードはありません");
		expect(html).toContain('name="deckId"');
		expect(html).toContain('name="tagId"');
		expect(html).toContain('name="source"');
		expect(html).toContain('name="createdFrom"');
		expect(html).toContain('name="createdTo"');
	});

	it("offers labeled edit and delete controls with no storage path", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ nextCursor: "opaque", items: [baseCard] }}
				initialError={null}
				initialOptions={readyOptions}
			/>
		);
		expect(html).toContain("本文を保存");
		expect(html).toContain("このカードを削除");
		expect(html).toContain("次の20件を読み込む");
		expect(html).not.toContain("storage_path");
	});

	it("shows an accessible retry and disables relation editing when options fail", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ nextCursor: null, items: [baseCard] }}
				initialError={null}
				initialOptions={{ status: "error", message: "処理に失敗しました。" }}
			/>
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("デッキ・タグの選択肢を取得できませんでした");
		expect(html).toContain("カード情報を再読み込み");
		expect(html).toContain("選択肢を取得できません");
		expect(html).toContain('<fieldset disabled=""');
	});

	it("does not show an empty result when the initial list failed", () => {
		const html = renderToStaticMarkup(
			<AiCardManagementClient
				initialPage={{ items: [], nextCursor: null }}
				initialError="処理に失敗しました。"
				initialOptions={readyOptions}
			/>
		);
		expect(html).toContain("カード一覧を取得できませんでした");
		expect(html).toContain("カード情報を再読み込み");
		expect(html).not.toContain("条件に合うAIカードはありません");
	});
});

const renderCards = (items: readonly ManagedAiCard[], initialError: string | null = null): string =>
	renderToStaticMarkup(
		<AiCardManagementClient
			initialPage={{ items, nextCursor: null }}
			initialError={initialError}
			initialOptions={readyOptions}
		/>
	);

describe("S-20 mnemonic display and editing on /ai/cards", () => {
	const cardWithMnemonic: ManagedAiCard = {
		...baseCard,
		illustrationKey: "見",
		mnemonic: MNEMONIC,
		mnemonicSharedCardCount: 1,
	};

	it("AC-1: renders all seven mnemonic inputs with their current values", () => {
		const html = renderCards([cardWithMnemonic]);

		for (const label of [
			"漢字",
			"単一の漢字として扱う（オフで熟語）",
			"形のヒント（部品）",
			"形のヒント（イメージ）",
			"意味のヒント",
			"覚え方のストーリー",
			"説明のまとめ",
		]) {
			expect(html).toContain(label);
		}
		expect(html).toContain('value="見"');
		expect(html).toContain('value="目"');
		expect(html).toContain('value="見る・気づく"');
		expect(html).toContain('value="目で見たものが頭の中で光って記憶に残る"');
		expect(html).toContain('value="目で見たものが、頭の中で光って記憶に残る。"');
		// isSingleKanji is rendered as a checkbox reflecting the stored value.
		expect(html).toContain('aria-label="単一の漢字として扱う（オフで熟語）" checked=""');
		expect(html).toContain("覚え方を保存");
	});

	it("AC-1: renders every explanation mapping pair", () => {
		const html = renderCards([
			{
				...cardWithMnemonic,
				mnemonic: {
					...MNEMONIC,
					explanation: {
						summary: MNEMONIC.explanation.summary,
						mappings: [
							{ part: "部品A", meaning: "意味A" },
							{ part: "部品B", meaning: "意味B" },
							{ part: "部品C", meaning: "意味C" },
						],
					},
				},
			},
		]);

		expect(html).toContain("部品と意味の対応（2〜4件）");
		for (const suffix of ["A", "B", "C"]) {
			expect(html).toContain(`value="部品${suffix}"`);
			expect(html).toContain(`value="意味${suffix}"`);
		}
		expect(html).toContain("部品 3");
		expect(html).toContain("意味 3");
		expect(html.match(/対応を削除/g)).toHaveLength(3);
	});

	it("AC-2: shows 未設定 and no form when the card has no mnemonic", () => {
		const html = renderCards([baseCard]);

		expect(html).toContain("覚え方（ニーモニック）: 未設定");
		expect(html).not.toContain("覚え方を保存");
		expect(html).not.toContain("部品と意味の対応");
	});

	it("AC-2: shows 未設定 when the mnemonic exists but the illustration key does not", () => {
		// Without a key there is nothing to upsert against, so no form is offered.
		const html = renderCards([{ ...cardWithMnemonic, illustrationKey: null }]);

		expect(html).toContain("覚え方（ニーモニック）: 未設定");
		expect(html).not.toContain("覚え方を保存");
	});

	it("AC-7: shows the shared card count only from two cards up", () => {
		expect(renderCards([{ ...cardWithMnemonic, mnemonicSharedCardCount: 2 }])).toContain(
			"このイラストの覚え方は2枚のカードで共有されています。"
		);
		const single = renderCards([cardWithMnemonic]);
		expect(single).not.toContain("枚のカードで共有されています");
	});

	it("AC-10a: builds the save payload from the card and the edited entry", () => {
		expect(mnemonicMutationInput(cardWithMnemonic, MNEMONIC)).toEqual({
			cardId: CARD_ID,
			illustrationKey: "見",
			slots: MNEMONIC.slots,
			explanation: MNEMONIC.explanation,
		});
		// Only the four contract fields travel: no owner, no status, no updatedAt.
		expect(Object.keys(mnemonicMutationInput(cardWithMnemonic, MNEMONIC))).toEqual([
			"cardId",
			"illustrationKey",
			"slots",
			"explanation",
		]);
	});

	it("AC-10b: disables the mnemonic save button under mutationsDisabled", () => {
		const html = renderCards([cardWithMnemonic], "処理に失敗しました。");

		const saveButton = /<button type="submit" disabled=""[^>]*>覚え方を保存<\/button>/u;
		expect(html).toMatch(saveButton);
	});

	it("AC-10c: keeps exactly one pending indicator and one notice slot on the page", () => {
		const html = renderCards([
			cardWithMnemonic,
			{ ...cardWithMnemonic, id: SECOND_CARD_ID, itemId: SECOND_CARD_ID },
		]);

		// The mnemonic form reuses applyMutation, so it adds no pending/notice UI.
		expect(html).not.toContain("処理中です…");
		expect(html.match(/aria-busy="false"/g)).toHaveLength(1);
		expect(html.match(/role="status"/g)).toBeNull();
		expect(html.match(/role="alert"/g)).toBeNull();
	});

	it("AC-12/AC-14: renders no illustration picker, illustration save, or batch undo", () => {
		const html = renderCards([
			{ ...cardWithMnemonic, illustration: { id: BATCH_ID, status: "ready", url: SIGNED_URL } },
		]);

		expect(html).not.toContain("イラストを保存");
		expect(html).not.toContain('name="illustrationId"');
		expect(html).not.toContain("登録バッチを取り消す");
		// AC-13: viewing the illustration is unaffected.
		expect(html).toContain('data-testid="ai-card-illustration-thumbnail"');
	});
});
