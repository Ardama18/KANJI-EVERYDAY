import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/deck/CreateDeckForm.tsx", () => {
	it("UT-S16-CREATE-DECK-FORM-CONTRACT: Server Action form binding and accessible controls are present", () => {
		const source = readFileSync(new URL("./CreateDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(createDeck");
		expect(source).toContain("useFormStatus");
		expect(source).toContain("action={formAction}");
		expect(source).toContain('htmlFor="deck-name"');
		expect(source).toContain('name="name"');
		expect(source).toContain("maxLength={MAX_DECK_NAME_LENGTH}");
	});

	it("UT-S16-CREATE-DECK-FORM-STATES: pending disabled, alert, success feedback, and touch target are fixed", () => {
		const source = readFileSync(new URL("./CreateDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("disabled={pending}");
		expect(source).toContain("作成中...");
		expect(source).toContain('role="alert"');
		expect(source).toContain('state.status === "success"');
		expect(source).toContain("h-12");
	});
});
