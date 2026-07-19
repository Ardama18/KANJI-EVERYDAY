import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ImportStatus from "./ImportStatus";

// Regression: ISSUE-002 — partial results showed failed items but did not identify successful cards
// Found by /qa on 2026-07-18
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-18.md
describe("ImportStatus partial result", () => {
	it("labels every succeeded and failed item in request order", () => {
		const markup = renderToStaticMarkup(
			createElement(ImportStatus, {
				tracking: false,
				onRefresh: async () => undefined,
				result: {
					batchId: "11111111-1111-4111-8111-111111111111",
					status: "partial",
					counts: { total: 2, succeeded: 1, failed: 1 },
					items: [
						{
							itemId: "22222222-2222-4222-8222-222222222222",
							conceptId: "concept-001",
							status: "succeeded",
							cardId: "33333333-3333-4333-8333-333333333333",
						},
						{
							itemId: "44444444-4444-4444-8444-444444444444",
							conceptId: "concept-001",
							status: "failed",
							errorCode: "PROVIDER_TRANSIENT_ERROR",
						},
					],
				},
			})
		);
		const text = markup.replace(/<[^>]*>/gu, "");
		expect(text).toContain("カード1: 成功 / concept-001 / 登録済み");
		expect(text).toContain("カード2: 失敗 / concept-001 /");
		expect(text).not.toContain("PROVIDER_TRANSIENT_ERROR");
	});
});
