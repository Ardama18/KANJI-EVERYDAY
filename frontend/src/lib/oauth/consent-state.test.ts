import { describe, expect, it } from "vitest";

import { createConsentLoginState, isConsentLoginState } from "./consent-state";

describe("S-14 consent login state", () => {
	it("keeps only an opaque UUID in the browser-state boundary", () => {
		const state = createConsentLoginState();
		expect(isConsentLoginState(state)).toBe(true);
		expect(isConsentLoginState("authorization-id")).toBe(false);
		expect(isConsentLoginState(undefined)).toBe(false);
	});
});
