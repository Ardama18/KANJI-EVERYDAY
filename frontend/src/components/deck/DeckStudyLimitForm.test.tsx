import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/deck/DeckStudyLimitForm.tsx", () => {
	it("Server Action form binding and accessible numeric controls are present", () => {
		const source = readFileSync(new URL("./DeckStudyLimitForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(");
		expect(source).toContain("updateDeckStudyLimit");
		expect(source).toContain("useFormStatus");
		expect(source).toContain("action={formAction}");
		expect(source).toContain('htmlFor="daily-study-limit"');
		expect(source).toContain('name="dailyStudyLimit"');
		expect(source).toContain("min={1}");
		expect(source).toContain("max={100}");
		expect(source).toContain("step={1}");
		expect(source).toContain('role="alert"');
		expect(source).toContain("h-12");
	});

	it("現在値と新規カード上限を表示する契約を持つ", () => {
		const source = readFileSync(new URL("./DeckStudyLimitForm.tsx", import.meta.url), "utf8");

		expect(source).toContain('name="deckId"');
		expect(source).toContain("value={deckId}");
		expect(source).toContain("defaultValue={dailyStudyLimit}");
		expect(source).toContain("新規カード上限: {newLimitPerDay}枚");
	});
});
