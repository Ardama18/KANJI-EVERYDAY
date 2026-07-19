import { describe, expect, it, vi } from "vitest";

import { focusAiCardImportTarget } from "./focus-target";

describe("AI card import async focus targets", () => {
	it.each([
		["draft", "draft-heading"],
		["status", "import-status-heading"],
	] as const)("focuses the %s heading after the async transition", (target, expectedId) => {
		const focus = vi.fn();
		const getElementById = vi.fn(() => ({ focus }));

		focusAiCardImportTarget(target, { getElementById });

		expect(getElementById).toHaveBeenCalledWith(expectedId);
		expect(focus).toHaveBeenCalledOnce();
	});
});
