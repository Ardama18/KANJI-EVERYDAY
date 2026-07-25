// S-16H T4-1: Edge Function 実装 `supabase/functions/_shared/mnemonic-prompt.ts` の単体テスト。
// 正本テンプレは `./prompt.ts`。出力一致は `./worker-prompt-parity.test.ts` が固定する。

import { describe, expect, it } from "vitest";

import {
	type MnemonicSlots,
	buildMnemonicPrompt,
	parseMnemonicSlots,
	sanitizePromptInput,
} from "../../../../supabase/functions/_shared/mnemonic-prompt.ts";

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

describe("buildMnemonicPrompt（単字）", () => {
	it("UT-S16H-01-SINGLE-ALL-BLOCKS: 6ブロックの見出しと slots 差し込みが出力される", () => {
		const prompt = buildMnemonicPrompt(singleKanjiSlots);

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
		expect(prompt.split("\n")[0]).toBe(
			"「見」という漢字を、形と意味を視覚的に結びつけて覚えられる学習用インフォグラフィックとして作成してください。"
		);
		expect(prompt).toContain("・「見」を日本の標準的な字体で大きく表示する");
		expect(prompt).toContain("・「見」の下の「見」を、目に関連づける");
		expect(prompt).toContain("・この漢字が持つ「見る・気づく」を、場面・物・動きで表す");
		expect(prompt).toContain(
			"「目で見たものが頭の中で光って記憶に残る」という一つの場面で、漢字の形と意味を結びつける"
		);
	});

	it("UT-S16H-02-SINGLE-FOOTER: 末尾行が文字指定と正方形・高解像度の指示になる", () => {
		const prompt = buildMnemonicPrompt(singleKanjiSlots);
		const lines = prompt.split("\n");

		expect(lines[lines.length - 1]).toBe(
			"画像内の文字は正確な「見」のみとし、正方形、高解像度で作成してください。"
		);
	});
});

describe("buildMnemonicPrompt（複数字）", () => {
	it("UT-S16H-03-MULTI-SUPPRESS-SHAPE-MAPPING: 部首→絵マッピングを出さず字形と語全体の物語は維持する", () => {
		const prompt = buildMnemonicPrompt(multiKanjiSlots);

		expect(prompt).not.toContain("【形の手掛かり】");
		expect(prompt).not.toContain("に関連づける");
		expect(prompt).not.toContain("偏");
		expect(prompt).toContain("【正確な字形】");
		expect(prompt).toContain("・画数、線の向き、部首の位置を変更しない");
		expect(prompt).toContain(
			"「子どもたちが校舎で一緒に学ぶ」という一つの場面で、語全体の意味を表す"
		);
	});
});

describe("sanitizePromptInput / buildMnemonicPrompt（サニタイズ）", () => {
	it("UT-S16H-04-SANITIZE: 制御文字を除去し101文字以上を100文字へ切り詰める", () => {
		expect(sanitizePromptInput("温\u0000か\nい\t日")).toBe("温かい日");
		expect(sanitizePromptInput("あ".repeat(101))).toBe("あ".repeat(100));

		const prompt = buildMnemonicPrompt({
			...singleKanjiSlots,
			meaningHint: "見\u0000る",
			story: "あ".repeat(101),
		});
		expect(prompt).not.toContain("\u0000");
		expect(prompt).toContain("・この漢字が持つ「見る」を、場面・物・動きで表す");
		expect(prompt).toContain(`「${"あ".repeat(100)}」という一つの場面で`);
		expect(prompt).not.toContain("あ".repeat(101));
	});
});

describe("buildMnemonicPrompt（安全系）", () => {
	it("UT-S16H-05-SAFETY-DIRECTIVE: 【禁止事項】に怖い/暴力的/不適切表現の禁止を含む", () => {
		const lines = buildMnemonicPrompt(singleKanjiSlots).split("\n");
		const forbiddenIndex = lines.indexOf("【禁止事項】");
		const safetyIndex = lines.indexOf("・怖い表現、暴力的表現、不適切な表現");

		expect(forbiddenIndex).toBeGreaterThanOrEqual(0);
		expect(safetyIndex).toBeGreaterThan(forbiddenIndex);
		expect(safetyIndex).toBeLessThan(lines.length - 1);
	});
});

describe("parseMnemonicSlots", () => {
	it("UT-S16H-06-PARSE: 正常な jsonb を通し、型不正・欠落・空 kanji・null を undefined にする", () => {
		const valid = {
			kanji: "山",
			isSingleKanji: true,
			shapeHint: { part: "三つの峰", picture: "山並み" },
			meaningHint: "たかい土地",
			story: "峰が三つ並ぶ",
		};

		expect(parseMnemonicSlots(valid)).toEqual(valid);
		// 型不正（isSingleKanji が文字列）
		expect(parseMnemonicSlots({ ...valid, isSingleKanji: "true" })).toBeUndefined();
		// shapeHint 欠落
		expect(parseMnemonicSlots({ ...valid, shapeHint: undefined })).toBeUndefined();
		// shapeHint の内部が型不正
		expect(parseMnemonicSlots({ ...valid, shapeHint: { part: "峰", picture: 1 } })).toBeUndefined();
		// meaningHint / story 欠落
		expect(parseMnemonicSlots({ ...valid, meaningHint: undefined })).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, story: null })).toBeUndefined();
		// サニタイズ後に空になる kanji
		expect(parseMnemonicSlots({ ...valid, kanji: "" })).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, kanji: "\u0000\u0001" })).toBeUndefined();
		// null / 配列 / プリミティブ
		expect(parseMnemonicSlots(null)).toBeUndefined();
		expect(parseMnemonicSlots(undefined)).toBeUndefined();
		expect(parseMnemonicSlots([valid])).toBeUndefined();
		expect(parseMnemonicSlots("{}")).toBeUndefined();
	});

	it("UT-S16H-07-PARSE-PROTO-POLLUTION: __proto__ 経由の値を採用せず Object.prototype も汚染しない", () => {
		// jsonb は任意のキーを持てるため、`__proto__` を含む payload が DB から届きうる。
		// JSON.parse は `__proto__` を own data property として作るので prototype 汚染は起きないが、
		// 「own property として存在するのに継承チェーンからは見えない」値を採用しないことを固定する。
		const protoOnly = JSON.parse('{"__proto__":{"kanji":"山"}}') as unknown;
		expect(parseMnemonicSlots(protoOnly)).toBeUndefined();

		const protoFullSlots = JSON.parse(
			'{"__proto__":{"kanji":"山","isSingleKanji":true,' +
				'"shapeHint":{"part":"三つの峰","picture":"山並み"},' +
				'"meaningHint":"たかい土地","story":"峰が三つ並ぶ"}}'
		) as unknown;
		expect(parseMnemonicSlots(protoFullSlots)).toBeUndefined();

		// 汚染が Object.prototype へ漏れていないこと（後続テストの前提を壊さない）。
		expect("kanji" in Object.prototype).toBe(false);
		expect("shapeHint" in Object.prototype).toBe(false);
		expect(({} as Record<string, unknown>).kanji).toBeUndefined();
	});

	it("UT-S16H-08-PARSE-PRIMITIVE: 数値・boolean・真偽値文字列を undefined にする", () => {
		expect(parseMnemonicSlots(0)).toBeUndefined();
		expect(parseMnemonicSlots(123)).toBeUndefined();
		expect(parseMnemonicSlots(Number.NaN)).toBeUndefined();
		expect(parseMnemonicSlots(false)).toBeUndefined();
		expect(parseMnemonicSlots(true)).toBeUndefined();
		expect(parseMnemonicSlots("false")).toBeUndefined();
		expect(parseMnemonicSlots("true")).toBeUndefined();
		expect(parseMnemonicSlots("")).toBeUndefined();
	});

	it("UT-S16H-09-PARSE-SHAPE-HINT-TYPE: shapeHint が配列・null・プリミティブなら undefined にする", () => {
		const valid = {
			kanji: "山",
			isSingleKanji: true,
			shapeHint: { part: "三つの峰", picture: "山並み" },
			meaningHint: "たかい土地",
			story: "峰が三つ並ぶ",
		};

		expect(parseMnemonicSlots({ ...valid, shapeHint: [] })).toBeUndefined();
		expect(
			parseMnemonicSlots({ ...valid, shapeHint: [{ part: "三つの峰", picture: "山並み" }] })
		).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, shapeHint: null })).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, shapeHint: "三つの峰" })).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, shapeHint: 1 })).toBeUndefined();
		expect(parseMnemonicSlots({ ...valid, shapeHint: true })).toBeUndefined();
	});
});
