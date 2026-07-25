// S-16B ニーモニックプロンプトテンプレの Edge Function 実装。
// 正本は `frontend/src/lib/illustration/prompt.ts`（`generatePrompt` / `sanitizePromptInput`）。
// Edge Function は `supabase/functions/` 配下のみがデプロイ対象のため frontend から直接 import
// できず、等価な pure TS として複製している。片側だけを変更すると
// `frontend/src/lib/illustration/worker-prompt-parity.test.ts`（drift テスト）が失敗する。
// このファイルは依存 import を持たない（Deno / Vitest 双方から読み込める前提）。

export type MnemonicShapeHint = {
	part: string;
	picture: string;
};

export type MnemonicSlots = {
	kanji: string;
	isSingleKanji: boolean;
	shapeHint: MnemonicShapeHint;
	meaningHint: string;
	story: string;
};

const MAX_PROMPT_INPUT_LENGTH = 100;

const isControlCharacter = (character: string): boolean => {
	const codePoint = character.charCodeAt(0);
	return codePoint <= 31 || codePoint === 127;
};

export const sanitizePromptInput = (text: string): string =>
	Array.from(text)
		.filter((character) => !isControlCharacter(character))
		.join("")
		.slice(0, MAX_PROMPT_INPUT_LENGTH);

export const buildMnemonicPrompt = (slots: MnemonicSlots): string => {
	const kanji = sanitizePromptInput(slots.kanji);
	const part = sanitizePromptInput(slots.shapeHint.part);
	const picture = sanitizePromptInput(slots.shapeHint.picture);
	const meaningHint = sanitizePromptInput(slots.meaningHint);
	const story = sanitizePromptInput(slots.story);

	const lines: string[] = [
		`「${kanji}」という漢字を、形と意味を視覚的に結びつけて覚えられる学習用インフォグラフィックとして作成してください。`,
		"【正確な字形】",
		`・「${kanji}」を日本の標準的な字体で大きく表示する`,
		"・画数、線の向き、部首の位置を変更しない",
		"・正しい字形の維持を、装飾より優先する",
	];

	// 【形の手掛かり】の部首→絵1対1マッピングは単字のみ。複数字では省略する。
	if (slots.isSingleKanji) {
		lines.push(
			"【形の手掛かり】",
			`・「${kanji}」の${part}を、${picture}に関連づける`,
			"・ただし、元の線を消したり別の形に置き換えたりしない"
		);
	}

	lines.push(
		"【意味の手掛かり】",
		`・この漢字が持つ「${meaningHint}」を、場面・物・動きで表す`,
		"【記憶の物語】",
		slots.isSingleKanji
			? `「${story}」という一つの場面で、漢字の形と意味を結びつける`
			: `「${story}」という一つの場面で、語全体の意味を表す`,
		"【構成】",
		"・漢字自体を主役にする",
		"・関係のないアイコンや説明は入れない",
		"・一枚につき一つの記憶ルールに絞る",
		"・子どもが3秒で意味をつかめる構成にする",
		"【禁止事項】",
		"・誤った漢字",
		"・線や画数の省略",
		"・余分な文字",
		"・複数の異なる物語",
		"・情報量の多い複雑な背景",
		"・ロゴ、透かし",
		"・怖い表現、暴力的表現、不適切な表現",
		`画像内の文字は正確な「${kanji}」のみとし、正方形、高解像度で作成してください。`
	);

	return lines.join("\n");
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * DB の `card_mnemonics.slots`（jsonb、形状 CHECK なし）を防御的に検証する。
 * 1 つでも欠落・型不正があれば `undefined` を返し、呼び出し元をフォールバックさせる。
 */
export const parseMnemonicSlots = (value: unknown): MnemonicSlots | undefined => {
	if (!isRecord(value)) return undefined;
	const shapeHint = value.shapeHint;
	if (!isRecord(shapeHint)) return undefined;
	const kanji = value.kanji;
	const isSingleKanji = value.isSingleKanji;
	const meaningHint = value.meaningHint;
	const story = value.story;
	const part = shapeHint.part;
	const picture = shapeHint.picture;
	if (
		typeof kanji !== "string" ||
		typeof isSingleKanji !== "boolean" ||
		typeof meaningHint !== "string" ||
		typeof story !== "string" ||
		typeof part !== "string" ||
		typeof picture !== "string"
	) {
		return undefined;
	}
	if (sanitizePromptInput(kanji).length === 0) return undefined;
	return { kanji, isSingleKanji, shapeHint: { part, picture }, meaningHint, story };
};
