import { describe, expect, it } from "vitest";

import {
	DEFAULT_DISPLAY_NAME_FALLBACK,
	DISPLAY_NAME_MAX_LENGTH,
	normalizeDisplayName,
	resolveDisplayName,
} from "./display-name";

describe("frontend/src/lib/auth/display-name.ts", () => {
	it("表示名を trim し、20文字を超える場合は切り詰める", () => {
		const raw = "  あいうえおかきくけこさしすせそたちつてとなにぬねの  ";
		const normalized = normalizeDisplayName(raw);

		expect(normalized).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
		expect(normalized).toBe("あいうえおかきくけこさしすせそたちつてと");
	});

	it("表示名が空文字の場合はメールのローカル部へフォールバックする", () => {
		const actual = resolveDisplayName({
			displayName: "   ",
			email: "learner.user@example.com",
		});

		expect(actual).toBe("learner.user");
	});

	it("フォールバック候補も空の場合は既定値を返す", () => {
		const actual = resolveDisplayName({
			displayName: " ",
			email: "@example.com",
		});

		expect(actual).toBe(DEFAULT_DISPLAY_NAME_FALLBACK);
	});
});
