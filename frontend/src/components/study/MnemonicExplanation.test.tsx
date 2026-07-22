import type {
	IllustrationDisplayStatus,
	MnemonicExplanation as MnemonicExplanationData,
} from "@/actions/session-actions";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MnemonicExplanation } from "./MnemonicExplanation";

const explanation: MnemonicExplanationData = {
	summary: "目で見たものが、頭の中で光って記憶に残る。",
	mappings: [
		{ part: "下の「見」", meaning: "目で見る" },
		{ part: "上の光", meaning: "頭の中で気づき、記憶する" },
		{ part: "目から光へ伸びる線", meaning: "見た情報が記憶になる" },
	],
};

const countByTestId = (html: string, testId: string): number =>
	html.match(new RegExp(`data-testid="${testId}"`, "g"))?.length ?? 0;

const render = (
	illustrationStatus: IllustrationDisplayStatus,
	value: MnemonicExplanationData | null
): string =>
	renderToStaticMarkup(
		<MnemonicExplanation illustrationStatus={illustrationStatus} explanation={value} />
	);

describe("frontend/src/components/study/MnemonicExplanation.tsx", () => {
	it("ready + explanation で summary を強調表示し mappings を行リストで描画する", () => {
		const html = render("ready", explanation);

		expect(countByTestId(html, "mnemonic-explanation")).toBe(1);
		expect(countByTestId(html, "mnemonic-explanation-summary")).toBe(1);
		expect(html).toContain("目で見たものが、頭の中で光って記憶に残る。");
		expect(countByTestId(html, "mnemonic-explanation-mapping")).toBe(3);
		expect(html).toContain("下の「見」：目で見る");
		expect(html).toContain("上の光：頭の中で気づき、記憶する");
		expect(html).toContain("目から光へ伸びる線：見た情報が記憶になる");
	});

	it("explanation=null なら何も描画しない", () => {
		const html = render("ready", null);

		expect(html).toBe("");
	});

	it.each<IllustrationDisplayStatus>(["none", "pending", "generating", "failed"])(
		"illustrationStatus=%s では explanation があっても描画しない",
		(status) => {
			const html = render(status, explanation);

			expect(html).toBe("");
		}
	);

	it("mappings が空でも summary は描画する", () => {
		const html = render("ready", { summary: "まとめだけ", mappings: [] });

		expect(countByTestId(html, "mnemonic-explanation")).toBe(1);
		expect(html).toContain("まとめだけ");
		expect(countByTestId(html, "mnemonic-explanation-mapping")).toBe(0);
	});
});
