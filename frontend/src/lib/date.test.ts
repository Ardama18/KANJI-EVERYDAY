import { afterEach, describe, expect, it, vi } from "vitest";

import { addDaysJST, getTodayJST, getTomorrowJST, isBeforeOrEqualJST } from "./date";

const INVALID_DATE_ERROR_MESSAGE = "Invalid JST date format: expected YYYY-MM-DD";

describe("date utilities", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("UT-AC01-DATE-EXPORTS: 4つのJSTユーティリティ関数を提供する", () => {
		expect(typeof getTodayJST).toBe("function");
		expect(typeof getTomorrowJST).toBe("function");
		expect(typeof addDaysJST).toBe("function");
		expect(typeof isBeforeOrEqualJST).toBe("function");
	});

	it("UT-AC02-TODAY-JST-UTC-BOUNDARY: UTC/JST境界で today を正しく返す", () => {
		expect(getTodayJST(new Date("2026-02-23T15:00:00Z"))).toBe("2026-02-24");
		expect(getTodayJST(new Date("2026-02-24T14:59:00Z"))).toBe("2026-02-24");
	});

	it("UT-AC03-TOMORROW-MONTH-ROLLOVER: 月跨ぎで tomorrow を返す", () => {
		expect(getTomorrowJST("2026-02-28")).toBe("2026-03-01");

		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-23T15:00:00Z"));
		expect(getTomorrowJST()).toBe("2026-02-25");
	});

	it("UT-AC04-ADDDAYS-YEAR-ROLLOVER: 年跨ぎ加算を返す", () => {
		expect(addDaysJST("2026-12-31", 1)).toBe("2027-01-01");
	});

	it("UT-AC05-DATE-COMPARISON: date <= target を判定する", () => {
		expect(isBeforeOrEqualJST("2026-02-23", "2026-02-23")).toBe(true);
		expect(isBeforeOrEqualJST("2026-02-24", "2026-02-23")).toBe(false);
	});

	it("UT-AC06-INVALID-DATE-FAIL-FAST: 不正入力で明示的例外を送出する", () => {
		expect(() => addDaysJST("2026/02/23", 1)).toThrowError(INVALID_DATE_ERROR_MESSAGE);
		expect(() => addDaysJST("2026-02-30", 1)).toThrowError(INVALID_DATE_ERROR_MESSAGE);
		expect(() => getTomorrowJST("bad-date")).toThrowError(INVALID_DATE_ERROR_MESSAGE);
	});
});
