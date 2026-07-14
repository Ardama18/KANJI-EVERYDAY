import { describe, expect, it } from "vitest";

import { mapAiImportError } from "./errors";

describe("AI import error mapper", () => {
	it("maps P1000-P1008 and 42501 to the stable public contract", () => {
		const expected = [
			["P1000", "VALIDATION_ERROR", 400],
			["P1001", "DUPLICATE_IN_REQUEST", 409],
			["P1002", "DUPLICATE_EXISTING", 409],
			["P1003", "DECK_NOT_FOUND", 404],
			["P1004", "DECK_AMBIGUOUS", 409],
			["P1005", "QUOTA_EXCEEDED", 429],
			["P1006", "ACTIVE_SESSION", 409],
			["P1007", "CARD_MODIFIED", 409],
			["P1008", "CONFLICT", 409],
			["42501", "UNAUTHORIZED", 403],
		] as const;
		for (const [sqlState, code, httpStatus] of expected)
			expect(mapAiImportError({ code: sqlState }, "corr-1")).toMatchObject({ code, httpStatus });
	});

	it("maps only the named private-card 23505 constraint to duplicate existing", () => {
		expect(
			mapAiImportError({ code: "23505", constraint: "cards_private_owner_card_key_uidx" }, "corr")
				.code
		).toBe("DUPLICATE_EXISTING");
		for (const constraint of [
			"cards_public_card_key_uidx",
			"ai_import_items_batch_card_key_uq",
			undefined,
		])
			expect(mapAiImportError({ code: "23505", constraint }, "corr").code).toBe("INTERNAL_ERROR");
	});

	it("falls back to INTERNAL_ERROR with only the supplied correlation ID", () => {
		expect(
			mapAiImportError(
				{ code: "XX999", message: "SQL secret", details: "token-secret", stack: "stack-secret" },
				"safe-correlation"
			)
		).toEqual({
			code: "INTERNAL_ERROR",
			httpStatus: 500,
			detail: { correlationId: "safe-correlation" },
		});
	});

	it("allow-lists safe detail fields and redacts DB message, owner, token, SQL, stack and card text", () => {
		const mapped = mapAiImportError(
			{
				code: "P1005",
				message: "SELECT secret-card-text",
				stack: "stack-secret",
				detail: {
					limit: 200,
					current: 199,
					requested: 2,
					date: "2049-01-01",
					ownerUserId: "owner-secret",
					token: "token-secret",
					cardText: "secret-card-text",
					sql: "DELETE",
				},
			},
			"corr"
		);
		expect(mapped).toEqual({
			code: "QUOTA_EXCEEDED",
			httpStatus: 429,
			detail: { limit: 200, current: 199, requested: 2, date: "2049-01-01" },
		});
		for (const secret of [
			"owner-secret",
			"token-secret",
			"secret-card-text",
			"SELECT",
			"DELETE",
			"stack-secret",
		])
			expect(JSON.stringify(mapped)).not.toContain(secret);
	});

	it("hides owner/resource existence and drops unsafe detail for not-found and unauthorized", () => {
		expect(
			mapAiImportError(
				{ code: "P1003", detail: { deckId: "hidden-deck", ownerUserId: "hidden-owner" } },
				"corr"
			)
		).toEqual({ code: "DECK_NOT_FOUND", httpStatus: 404 });
		expect(
			mapAiImportError({ code: "42501", detail: { ownerUserId: "hidden-owner" } }, "corr")
		).toEqual({ code: "UNAUTHORIZED", httpStatus: 403 });
	});

	it("keeps only validated safe detail for each public error code", () => {
		expect(
			mapAiImportError(
				{
					code: "P1000",
					detail: { path: "items[0].front", rule: "han_required", message: "secret" },
				},
				"corr"
			).detail
		).toEqual({ path: "items[0].front", rule: "han_required" });
		expect(
			mapAiImportError(
				{ code: "P1000", details: '{"field":"items","rule":"invalid","sql":"secret"}' },
				"corr"
			).detail
		).toEqual({ path: "items", rule: "invalid" });
		expect(
			mapAiImportError(
				{ code: "P1001", detail: { clientItemId: "item-1", request: "secret" } },
				"corr"
			).detail
		).toEqual({ clientItemId: "item-1" });
		expect(
			mapAiImportError(
				{ code: "P1002", detail: { itemId: "client-item-1", cardText: "secret" } },
				"corr"
			).detail
		).toEqual({ itemId: "client-item-1" });
		expect(
			mapAiImportError(
				{
					code: "P1007",
					detail: { cardId: "01901901-9d3d-7cc2-98c8-3b4a13f994a2", cardText: "secret" },
				},
				"corr"
			).detail
		).toEqual({ cardId: "01901901-9d3d-7cc2-98c8-3b4a13f994a2" });
		expect(
			mapAiImportError({ code: "P1008", detail: { idempotencyKey: "never-return" } }, "corr")
		).toEqual({ code: "CONFLICT", httpStatus: 409 });
	});
});
