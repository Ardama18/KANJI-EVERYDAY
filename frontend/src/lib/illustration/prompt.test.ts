import { describe, expect, it } from "vitest";

import { type MnemonicSlots, generatePrompt, sanitizePromptInput } from "./prompt";

const singleKanjiSlots: MnemonicSlots = {
	kanji: "見",
	isSingleKanji: true,
	shapeHint: { part: "下の「見」", picture: "目" },
	meaningHint: "見る・気づく",
	story: "目で見たものが頭の中で光って記憶に残る",
};

const multiKanjiSlots: MnemonicSlots = {
	kanji: "学校",
	isSingleKanji: false,
	shapeHint: { part: "偏", picture: "本" },
	meaningHint: "学ぶ場所",
	story: "子どもたちが校舎で一緒に学ぶ",
};

describe("sanitizePromptInput", () => {
	it("UT-AC03-SANITIZE-CONTROL-CHARS: 制御文字を除去する", () => {
		const source = "温\u0000か\nい\t日";

		expect(sanitizePromptInput(source)).toBe("温かい日");
	});

	it("UT-AC03-SANITIZE-MAX-LENGTH: 101文字以上を100文字に切り詰める", () => {
		const source = "あ".repeat(150);

		expect(sanitizePromptInput(source)).toHaveLength(100);
		expect(sanitizePromptInput(source)).toBe("あ".repeat(100));
	});
});

describe("generatePrompt（単字）", () => {
	it("UT-AC01-SINGLE-ALL-BLOCKS: 6ブロック全ての見出しが所定の文言で出力される", () => {
		const prompt = generatePrompt(singleKanjiSlots);

		for (const heading of [
			"【正確な字形】",
			"【形の手掛かり】",
			"【意味の手掛かり】",
			"【記憶の物語】",
			"【構成】",
			"【禁止事項】",
		]) {
			expect(prompt).toContain(heading);
		}
	});

	it("UT-AC01-SINGLE-SLOT-INJECTION: slots が各ブロックへ差し込まれる", () => {
		const prompt = generatePrompt(singleKanjiSlots);

		expect(prompt).toContain(
			"「見」という漢字を、形と意味を視覚的に結びつけて覚えられる学習用インフォグラフィックとして作成してください。"
		);
		expect(prompt).toContain("・「見」を日本の標準的な字体で大きく表示する");
		expect(prompt).toContain("・画数、線の向き、部首の位置を変更しない");
		expect(prompt).toContain("・正しい字形の維持を、装飾より優先する");
		expect(prompt).toContain("・「見」の下の「見」を、目に関連づける");
		expect(prompt).toContain("・ただし、元の線を消したり別の形に置き換えたりしない");
		expect(prompt).toContain("・この漢字が持つ「見る・気づく」を、場面・物・動きで表す");
		expect(prompt).toContain(
			"「目で見たものが頭の中で光って記憶に残る」という一つの場面で、漢字の形と意味を結びつける"
		);
		expect(prompt).toContain("・子どもが3秒で意味をつかめる構成にする");
		expect(prompt).toContain("・ロゴ、透かし");
	});

	it("UT-AC05-SINGLE-SAFETY-DIRECTIVE: 【禁止事項】に安全系の禁止表現を含む", () => {
		const prompt = generatePrompt(singleKanjiSlots);
		const lines = prompt.split("\n");
		const forbiddenIndex = lines.indexOf("【禁止事項】");
		const safetyIndex = lines.indexOf("・怖い表現、暴力的表現、不適切な表現");

		expect(forbiddenIndex).toBeGreaterThanOrEqual(0);
		expect(safetyIndex).toBeGreaterThan(forbiddenIndex);
		// 安全系は末尾行より前に置き、末尾の文字・解像度指定を最終行のまま保つ。
		expect(safetyIndex).toBeLessThan(lines.length - 1);
	});

	it("UT-AC04-SINGLE-FOOTER: 末尾に文字指定と正方形・高解像度を含む", () => {
		const prompt = generatePrompt(singleKanjiSlots);

		expect(prompt).toContain("画像内の文字は正確な「見」のみ");
		expect(prompt).toContain("正方形、高解像度");
		expect(prompt.endsWith("正方形、高解像度で作成してください。")).toBe(true);
	});
});

describe("generatePrompt（複数字）", () => {
	it("UT-AC02-MULTI-SUPPRESS-SHAPE-MAPPING: 【形の手掛かり】の部首→絵マッピングを出力しない", () => {
		const prompt = generatePrompt(multiKanjiSlots);

		expect(prompt).not.toContain("【形の手掛かり】");
		expect(prompt).not.toContain("に関連づける");
		expect(prompt).not.toContain("偏");
	});

	it("UT-AC01-MULTI-KEEP-SHAPE-ACCURACY: 【正確な字形】の省略なし指定は維持する", () => {
		const prompt = generatePrompt(multiKanjiSlots);

		expect(prompt).toContain("【正確な字形】");
		expect(prompt).toContain("・画数、線の向き、部首の位置を変更しない");
	});

	it("UT-AC01-MULTI-STORY-WHOLE-WORD: 【記憶の物語】は語全体を一つの場面で表す", () => {
		const prompt = generatePrompt(multiKanjiSlots);

		expect(prompt).toContain("【記憶の物語】");
		expect(prompt).toContain(
			"「子どもたちが校舎で一緒に学ぶ」という一つの場面で、語全体の意味を表す"
		);
	});

	it("UT-AC04-MULTI-FOOTER: 末尾に文字指定と正方形・高解像度を含む", () => {
		const prompt = generatePrompt(multiKanjiSlots);

		expect(prompt).toContain("画像内の文字は正確な「学校」のみ");
		expect(prompt).toContain("正方形、高解像度");
	});
});

describe("generatePrompt（サニタイズ）", () => {
	it("UT-AC03-SANITIZE-AT-PROMPT: 差し込み各文字列の制御文字を除去する", () => {
		const prompt = generatePrompt({
			...singleKanjiSlots,
			kanji: "見\u0000",
			meaningHint: "見\nる",
			story: "光\tる",
		});

		expect(prompt).not.toContain("\u0000");
		expect(prompt).not.toContain("\n光");
		expect(prompt).not.toContain("光\tる");
		expect(prompt).toContain("画像内の文字は正確な「見」のみ");
		expect(prompt).toContain("・この漢字が持つ「見る」を、場面・物・動きで表す");
		expect(prompt).toContain("「光る」という一つの場面で、漢字の形と意味を結びつける");
	});

	it("UT-AC03-SANITIZE-TRUNCATE: 過長な差し込み文字列を100文字へ切り詰める", () => {
		const longMeaning = "あ".repeat(150);
		const prompt = generatePrompt({ ...singleKanjiSlots, meaningHint: longMeaning });

		expect(prompt).toContain(`・この漢字が持つ「${"あ".repeat(100)}」を、場面・物・動きで表す`);
		expect(prompt).not.toContain("あ".repeat(101));
	});
});
