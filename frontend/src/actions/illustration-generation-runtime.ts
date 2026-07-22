import type { MnemonicSlots } from "@/lib/illustration/prompt";

export type ProcessIllustrationGenerationArgs = {
	illustrationId: string;
	illustrationKey: string;
	slots: MnemonicSlots;
	ownerUserId: string;
};

type ProcessIllustrationGenerationImplementation = (
	args: ProcessIllustrationGenerationArgs
) => Promise<void>;

// 本番 default は実生成ロジックへ委譲する（no-op にしない）。
// generator を静的 import せず、実行時に遅延 `await import` することで:
//   - seam の静的グラフを純粋に保ち、`__set` を使う既存テストへ generator の
//     重い依存ツリー（env / service-role client / gemini-client / storage）を持ち込まない。
//   - default 自体が実委譲なので「登録し忘れ → no-op 再発」を構造的に排除する
//     （seam は登録状態を持たない）。
// 委譲契約: 入力 `ProcessIllustrationGenerationArgs` をそのまま
//   `generator.processIllustrationGeneration(input)` へ渡す（引数 shape 完全一致・変換不要）。
//   generator の第2引数（dependencies）は省略し、実 default 依存を自動適用させる。
// 呼び出し元は `"use server"` の illustration-actions.ts で fire-and-forget 起動するため
//   ここでの戻り値は `Promise<void>`。generator が secret を読むのは実行時のみで、
//   遅延 import により generator グラフは server 側のみに閉じる。
// 契約変更（S-16G）: `__reset...ForTest` の復元先 default が「no-op」から
//   「generator への実委譲」へ変わる。reset 後に `__set` されていなければ実 generator へ到達する。
const defaultProcessIllustrationGenerationImplementation: ProcessIllustrationGenerationImplementation =
	async (args) => {
		const { processIllustrationGeneration } = await import("@/lib/illustration/generator");
		await processIllustrationGeneration(args);
	};

let processIllustrationGenerationImplementation =
	defaultProcessIllustrationGenerationImplementation;

export async function runProcessIllustrationGeneration(
	args: ProcessIllustrationGenerationArgs
): Promise<void> {
	await processIllustrationGenerationImplementation(args);
}

export function __setProcessIllustrationGenerationImplementationForTest(
	implementation: ProcessIllustrationGenerationImplementation
): void {
	processIllustrationGenerationImplementation = implementation;
}

export function __resetProcessIllustrationGenerationImplementationForTest(): void {
	processIllustrationGenerationImplementation = defaultProcessIllustrationGenerationImplementation;
}
