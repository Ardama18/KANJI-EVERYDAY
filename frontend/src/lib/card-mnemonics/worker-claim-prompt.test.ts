// S-16H T4-4: ワーカーの claim → プロンプト分岐テスト。
// `createSupabaseDatabase` を fetch スタブで呼び、claim() の返り値 prompt を検証する。
// 設計根拠: specs/stories/S-16H-worker-mnemonic-prompt/design.md D3 / D5。

import { describe, expect, it } from "vitest";

import { createSupabaseDatabase } from "../../../../supabase/functions/_shared/ai-card-import/supabase.ts";
import { generateIllustrationPrompt } from "../../../../supabase/functions/_shared/illustration-prompt-policy.ts";
import { generatePrompt } from "../illustration/prompt";

const LEGACY_NO_TEXT_DIRECTIVE = "文字・テキストは一切描かないでください。";

const CLAIM_BASE = {
	outcome: "claimed",
	jobId: "11111111-1111-4111-8111-111111111111",
	batchId: "22222222-2222-4222-8222-222222222222",
	claimToken: "33333333-3333-4333-8333-333333333333",
	attempt: 1,
	imageMode: "ai",
	backText: "やま",
	skill: "reading",
} as const;

const SINGLE_SLOTS = {
	kanji: "山",
	isSingleKanji: true,
	shapeHint: { part: "三つの峰", picture: "山並み" },
	meaningHint: "たかい土地",
	story: "峰が三つ並んでそびえる",
};

const MULTI_SLOTS = {
	kanji: "学校",
	isSingleKanji: false,
	shapeHint: { part: "偏", picture: "本" },
	meaningHint: "学ぶ場所",
	story: "子どもたちが校舎で一緒に学ぶ",
};

async function claimWith(row: Readonly<Record<string, unknown>>): Promise<string | undefined> {
	const database = createSupabaseDatabase({
		supabaseUrl: "http://supabase.local",
		serviceRoleKey: "service-fixture",
		fetchImplementation: async () => Response.json(row),
	});
	const result = await database.claim({
		jobId: CLAIM_BASE.jobId,
		messageId: 7,
		claimToken: CLAIM_BASE.claimToken,
	});
	if (result.outcome !== "claimed") throw new Error(`unexpected outcome: ${result.outcome}`);
	return result.prompt;
}

describe("S-16H worker claim プロンプト分岐", () => {
	it("UT-S16H-W01-SINGLE-SLOTS: 承認済み slots（単字）で S-16B テンプレを使い旧文言を使わない", async () => {
		const prompt = await claimWith({ ...CLAIM_BASE, mnemonicSlots: SINGLE_SLOTS });

		expect(prompt).toBe(generatePrompt(SINGLE_SLOTS));
		const lines = (prompt ?? "").split("\n");
		expect(lines[0]).toBe(
			"「山」という漢字を、形と意味を視覚的に結びつけて覚えられる学習用インフォグラフィックとして作成してください。"
		);
		expect(lines[lines.length - 1]).toBe(
			"画像内の文字は正確な「山」のみとし、正方形、高解像度で作成してください。"
		);
		expect(prompt).not.toContain(LEGACY_NO_TEXT_DIRECTIVE);
		expect(prompt).not.toContain("シンプルでかわいいフラットイラストを作成してください。");
	});

	it("UT-S16H-W02-MULTI-SLOTS: 承認済み slots（複数字）で部首→絵マッピングを含まない", async () => {
		const prompt = await claimWith({ ...CLAIM_BASE, mnemonicSlots: MULTI_SLOTS });

		expect(prompt).toBe(generatePrompt(MULTI_SLOTS));
		expect(prompt).not.toContain("【形の手掛かり】");
		expect(prompt).not.toContain("に関連づける");
		expect(prompt).toContain("【正確な字形】");
		expect(prompt).not.toContain(LEGACY_NO_TEXT_DIRECTIVE);
	});

	it("UT-S16H-W03-NO-SLOTS-FALLBACK: slots が無いときは旧汎用プロンプトへフォールバックする", async () => {
		const prompt = await claimWith(CLAIM_BASE);

		expect(prompt).toBe(generateIllustrationPrompt("やま", "reading"));
		expect(prompt).toContain(LEGACY_NO_TEXT_DIRECTIVE);
	});

	it("UT-S16H-W04-INVALID-SLOTS-FALLBACK: slots が不正形なら旧汎用プロンプトへフォールバックする", async () => {
		const invalidCases: readonly unknown[] = [
			// 型違い
			{ ...SINGLE_SLOTS, isSingleKanji: "true" },
			// shapeHint 欠落
			{ kanji: "山", isSingleKanji: true, meaningHint: "たかい土地", story: "峰" },
			// kanji が空
			{ ...SINGLE_SLOTS, kanji: "" },
			// jsonb でない
			"not-an-object",
			null,
		];

		for (const mnemonicSlots of invalidCases) {
			const prompt = await claimWith({ ...CLAIM_BASE, mnemonicSlots });

			expect(prompt).toBe(generateIllustrationPrompt("やま", "reading"));
		}
	});

	it("UT-S16H-W05-NON-AI-MODES: imageMode が upload / none なら prompt は undefined（回帰防止）", async () => {
		for (const imageMode of ["upload", "none"] as const) {
			const prompt = await claimWith({
				...CLAIM_BASE,
				imageMode,
				mnemonicSlots: SINGLE_SLOTS,
			});

			expect(prompt).toBeUndefined();
		}
	});

	it("UT-S16H-W06-SNAKE-CASE-KEY: mnemonic_slots（snake_case）でも S-16B テンプレを使う", async () => {
		const prompt = await claimWith({ ...CLAIM_BASE, mnemonic_slots: SINGLE_SLOTS });

		expect(prompt).toBe(generatePrompt(SINGLE_SLOTS));
	});
});
