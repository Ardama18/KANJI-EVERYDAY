import { describe, expect, it } from "vitest";

import { generatePrompt, sanitizePromptInput } from "./prompt";

describe("sanitizePromptInput", () => {
	it("UT-AC14-SANITIZE-CONTROL-CHARS: 制御文字を除去する", () => {
		const source = "温\u0000か\nい\t日\u001f";

		expect(sanitizePromptInput(source)).toBe("温かい日");
	});

	it("UT-AC14-SANITIZE-MAX-LENGTH: 101文字以上を100文字に切り詰める", () => {
		const source = "あ".repeat(150);

		expect(sanitizePromptInput(source)).toHaveLength(100);
		expect(sanitizePromptInput(source)).toBe("あ".repeat(100));
	});
});

describe("generatePrompt", () => {
	it("UT-AC14-SANITIZE-AT-PROMPT: サニタイズ済みテキストだけをプロンプトへ埋め込む", () => {
		const rawBackText = `\u0000${"雨".repeat(120)}`;

		const prompt = generatePrompt(rawBackText, "reading");

		expect(prompt).not.toContain("\u0000");
		expect(prompt).toContain("雨".repeat(100));
	});
});
