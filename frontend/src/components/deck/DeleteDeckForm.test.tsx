import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend/src/components/deck/DeleteDeckForm.tsx", () => {
	it("UT-S25-DELETE-DECK-FORM-CONTRACT: Server Action binding and confirmation guard are present", () => {
		const source = readFileSync(new URL("./DeleteDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(deleteDeck");
		expect(source).toContain("DECK_DELETE_ACTION_INITIAL_STATE");
		expect(source).toContain("useFormStatus");
		expect(source).toContain("action={formAction}");
		expect(source).toContain('name="deckId"');
		expect(source).toContain("value={deckId}");
		expect(source).toContain("window.confirm");
		expect(source).toContain("event.preventDefault()");
	});

	it("UT-S25-DELETE-DECK-FORM-STATES: pending disabled, alert, accessible name, and touch target are fixed", () => {
		const source = readFileSync(new URL("./DeleteDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("disabled={pending}");
		expect(source).toContain("aria-disabled={pending}");
		expect(source).toContain("削除中...");
		expect(source).toContain("aria-label={`「${deckName}」を削除`}");
		expect(source).toContain('role="alert"');
		expect(source).toContain("h-12");
	});
});
