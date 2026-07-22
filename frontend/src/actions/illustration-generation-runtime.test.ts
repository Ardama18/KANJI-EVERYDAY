import { beforeEach, describe, expect, it, vi } from "vitest";

import { processIllustrationGeneration } from "@/lib/illustration/generator";
import type { MnemonicSlots } from "@/lib/illustration/prompt";

import {
	type ProcessIllustrationGenerationArgs,
	__resetProcessIllustrationGenerationImplementationForTest,
	__setProcessIllustrationGenerationImplementationForTest,
	runProcessIllustrationGeneration,
} from "./illustration-generation-runtime";

// generator を spy 化する。default 実装が実行時に `await import("@/lib/illustration/generator")`
// で解決する先が、この mock モジュールになる（dynamic import はモック済みモジュールへ解決）。
vi.mock("@/lib/illustration/generator", () => ({
	processIllustrationGeneration:
		vi.fn<(input: ProcessIllustrationGenerationArgs) => Promise<void>>(),
}));

const SAMPLE_SLOTS: MnemonicSlots = {
	kanji: "見",
	isSingleKanji: true,
	shapeHint: { part: "下の部分", picture: "人の足" },
	meaningHint: "みる",
	story: "目を大きく開いて見る",
};

const SAMPLE_ARGS: ProcessIllustrationGenerationArgs = {
	illustrationId: "illustration-1",
	illustrationKey: "card-1:見",
	slots: SAMPLE_SLOTS,
	ownerUserId: "owner-1",
};

const generatorMock = vi.mocked(processIllustrationGeneration);

describe("frontend/src/actions/illustration-generation-runtime.ts", () => {
	beforeEach(() => {
		// 新 default（generator への実委譲）を active に戻し、mock 呼び出し履歴をクリアする。
		__resetProcessIllustrationGenerationImplementationForTest();
		vi.clearAllMocks();
		generatorMock.mockResolvedValue(undefined);
	});

	it("UT-AC-01-DEFAULT-DELEGATES: __set しない本番 default 経路は実 generator へ args そのまま委譲する（no-op でない）", async () => {
		// __set せず default 経路のまま呼ぶ。
		await runProcessIllustrationGeneration(SAMPLE_ARGS);

		expect(generatorMock).toHaveBeenCalledTimes(1);
		expect(generatorMock).toHaveBeenCalledWith(SAMPLE_ARGS);
	});

	it("UT-AC-04-SET-OVERRIDES: __set した実装が default より優先され、generator へは委譲しない", async () => {
		const customImpl = vi
			.fn<(args: ProcessIllustrationGenerationArgs) => Promise<void>>()
			.mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(customImpl);

		await runProcessIllustrationGeneration(SAMPLE_ARGS);

		expect(customImpl).toHaveBeenCalledTimes(1);
		expect(customImpl).toHaveBeenCalledWith(SAMPLE_ARGS);
		expect(generatorMock).not.toHaveBeenCalled();
	});

	it("UT-AC-04-RESET-RESTORES-DELEGATION: __reset の復元先が新 default（実委譲）であることを固定する", async () => {
		// 一旦 __set で上書きしてから __reset し、default（実委譲）へ戻ることを確認する。
		const customImpl = vi
			.fn<(args: ProcessIllustrationGenerationArgs) => Promise<void>>()
			.mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(customImpl);
		__resetProcessIllustrationGenerationImplementationForTest();

		await runProcessIllustrationGeneration(SAMPLE_ARGS);

		expect(customImpl).not.toHaveBeenCalled();
		expect(generatorMock).toHaveBeenCalledTimes(1);
		expect(generatorMock).toHaveBeenCalledWith(SAMPLE_ARGS);
	});
});
