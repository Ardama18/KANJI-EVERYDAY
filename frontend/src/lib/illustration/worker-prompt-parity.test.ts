// S-16H T4-2: drift 防止テスト。
// 正本 `./prompt.ts`（`generatePrompt` / `sanitizePromptInput`）と Edge Function 実装
// `supabase/functions/_shared/mnemonic-prompt.ts`（`buildMnemonicPrompt` / `sanitizePromptInput`）の
// 出力が完全一致することを固定する。片側だけを変更すると必ずこのテストが落ちる。

import { describe, expect, it } from "vitest";

import {
	buildMnemonicPrompt,
	sanitizePromptInput as sanitizeWorkerPromptInput,
} from "../../../../supabase/functions/_shared/mnemonic-prompt.ts";
import { type MnemonicSlots, generatePrompt, sanitizePromptInput } from "./prompt";

const CONTROL_CHAR = "\u0000";
const DELETE_CHAR = "\u007f";

const FIXTURES: ReadonlyArray<{ readonly label: string; readonly slots: MnemonicSlots }> = [
	{
		label: "単字",
		slots: {
			kanji: "見",
			isSingleKanji: true,
			shapeHint: { part: "下の「見」", picture: "目" },
			meaningHint: "見る・気づく",
			story: "目で見たものが頭の中で光って記憶に残る",
		},
	},
	{
		label: "複数字",
		slots: {
			kanji: "学校",
			isSingleKanji: false,
			shapeHint: { part: "偏", picture: "本" },
			meaningHint: "学ぶ場所",
			story: "子どもたちが校舎で一緒に学ぶ",
		},
	},
	{
		label: "制御文字入り",
		slots: {
			kanji: `山${CONTROL_CHAR}`,
			isSingleKanji: true,
			shapeHint: { part: `三つ${DELETE_CHAR}の峰`, picture: "山並み\n遠景" },
			meaningHint: "たかい\t土地",
			story: `峰が${CONTROL_CHAR}三つ並ぶ`,
		},
	},
	{
		label: "101文字超",
		slots: {
			kanji: "森".repeat(101),
			isSingleKanji: false,
			shapeHint: { part: "木".repeat(150), picture: "林".repeat(101) },
			meaningHint: "緑".repeat(101),
			story: "葉".repeat(255),
		},
	},
	{
		label: "記号・絵文字入り",
		slots: {
			kanji: "犬🐶",
			isSingleKanji: true,
			shapeHint: { part: "点「丶」", picture: "しっぽ<>&\"'" },
			meaningHint: "いぬ／ドッグ（動物）",
			story: "🐕 が「わん！」と鳴く #1 場面",
		},
	},
];

describe("S-16B テンプレの frontend 正本と Edge Function 実装の出力一致（drift 防止）", () => {
	it("UT-S16H-PARITY: fixture 5 種で generatePrompt と buildMnemonicPrompt の出力が完全一致する", () => {
		expect(FIXTURES.length).toBeGreaterThanOrEqual(5);

		for (const fixture of FIXTURES) {
			const expected = generatePrompt(fixture.slots);
			const actual = buildMnemonicPrompt(fixture.slots);

			expect(actual, `${fixture.label}: プロンプト出力が正本と一致しない`).toBe(expected);

			// sanitizePromptInput の出力一致も同じ fixture で検証する。
			for (const source of [
				fixture.slots.kanji,
				fixture.slots.shapeHint.part,
				fixture.slots.shapeHint.picture,
				fixture.slots.meaningHint,
				fixture.slots.story,
			]) {
				expect(
					sanitizeWorkerPromptInput(source),
					`${fixture.label}: sanitizePromptInput の出力が正本と一致しない`
				).toBe(sanitizePromptInput(source));
			}
		}
	});
});
