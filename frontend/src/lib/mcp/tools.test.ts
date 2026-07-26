import { describe, expect, it, vi } from "vitest";

import { MCP_SCOPES } from "./metadata";
import { MCP_TOOL_NAMES, type McpToolServices, invokeMcpTool, mcpToolDescriptors } from "./tools";

function services(overrides: Partial<McpToolServices> = {}): McpToolServices {
	return {
		listDecks: vi.fn().mockResolvedValue({ decks: [] }),
		createDeck: vi.fn().mockResolvedValue({ deck: { id: "deck-1", name: "初回デッキ" } }),
		previewCardImport: vi.fn().mockResolvedValue({ ok: true }),
		commitCardImport: vi.fn().mockResolvedValue({ ok: true }),
		getImportStatus: vi.fn().mockResolvedValue({ ok: true }),
		listAiCards: vi.fn().mockResolvedValue({ items: [] }),
		updateAiCard: vi.fn().mockResolvedValue({ ok: true }),
		deleteAiCards: vi.fn().mockResolvedValue({ ok: true }),
		undoImportBatch: vi.fn().mockResolvedValue({ ok: true }),
		...overrides,
	};
}

const DECK_ID = "11111111-1111-4111-8111-111111111111";

function importRequest(image: { mode: "none" | "ai" }) {
	return {
		deck: { id: DECK_ID },
		items: [
			{
				clientItemId: "item-1",
				conceptId: "concept-1",
				pattern: "R1" as const,
				front: "漢",
				back: "かん",
				tags: [],
				image,
			},
		],
	};
}

function commitInput(image: { mode: "none" | "ai" }) {
	return {
		request: importRequest(image),
		previewToken: "opaque.token",
		cardReservationKey: "reservation-key",
		importRequestHash: "a".repeat(64),
		idempotencyKey: "idem-1",
		confirmedWarnings: true as const,
	};
}

describe("S-14 static MCP tools", () => {
	it("exposes exactly the approved nine-tool allowlist", () => {
		expect(MCP_TOOL_NAMES).toEqual([
			"list_decks",
			"create_deck",
			"preview_card_import",
			"commit_card_import",
			"get_import_status",
			"list_ai_cards",
			"update_ai_card",
			"delete_ai_cards",
			"undo_import_batch",
		]);
		expect(Object.keys(mcpToolDescriptors)).toEqual(MCP_TOOL_NAMES);
	});

	it("uses the exact standard OAuth scopes for every descriptor and mirror", () => {
		for (const descriptor of Object.values(mcpToolDescriptors)) {
			expect(descriptor.securitySchemes[0]?.scopes).toEqual(MCP_SCOPES);
			expect(descriptor._meta.securitySchemes).toBe(descriptor.securitySchemes);
		}
	});

	it("rejects unknown tools without invoking a service", async () => {
		const instance = services();
		const result = await invokeMcpTool("rpc_anything", {}, instance);
		expect(result.isError).toBe(true);
		expect(instance.listDecks).not.toHaveBeenCalled();
	});

	it("dispatches create_deck with strict input and rejects owner overrides", async () => {
		const createDeck = vi.fn().mockResolvedValue({ deck: { id: "deck-1", name: "初回デッキ" } });
		const instance = services({ createDeck });
		const result = await invokeMcpTool("create_deck", { name: "初回デッキ" }, instance);
		const rejected = await invokeMcpTool(
			"create_deck",
			{ name: "初回デッキ", ownerUserId: "forged" },
			instance
		);

		expect(result.structuredContent).toEqual({
			ok: true,
			data: { deck: { id: "deck-1", name: "初回デッキ" } },
		});
		expect(createDeck).toHaveBeenCalledWith({ name: "初回デッキ" });
		expect(rejected.isError).toBe(true);
		expect(createDeck).toHaveBeenCalledTimes(1);
	});

	it("rejects unknown input fields before dispatch", async () => {
		const instance = services();
		const result = await invokeMcpTool("list_decks", { ownerId: "forged" }, instance);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "VALIDATION_ERROR" },
		});
		expect(instance.listDecks).not.toHaveBeenCalled();
	});

	it("requires exactly one status selector", async () => {
		const instance = services();
		const result = await invokeMcpTool("get_import_status", {}, instance);
		expect(result.isError).toBe(true);
		expect(instance.getImportStatus).not.toHaveBeenCalled();
	});

	it("rejects mixed tag patch modes before the service", async () => {
		const instance = services();
		const result = await invokeMcpTool(
			"update_ai_card",
			{
				cardId: "11111111-1111-4111-8111-111111111111",
				expectedUpdatedAt: "2026-07-19T00:00:00.000Z",
				patch: {
					tagIds: ["22222222-2222-4222-8222-222222222222"],
					tagNames: ["漢字"],
				},
			},
			instance
		);
		expect(result.isError).toBe(true);
		expect(instance.updateAiCard).not.toHaveBeenCalled();
	});

	it("requires an explicit true warning confirmation", async () => {
		const instance = services();
		const result = await invokeMcpTool(
			"commit_card_import",
			{ confirmedWarnings: false },
			instance
		);
		expect(result.isError).toBe(true);
		expect(instance.commitCardImport).not.toHaveBeenCalled();
	});

	it('S-21 D0: accepts image.mode="ai" so the flag decision belongs to the service layer', async () => {
		const instance = services();
		const preview = await invokeMcpTool(
			"preview_card_import",
			{ request: importRequest({ mode: "ai" }) },
			instance
		);
		const commit = await invokeMcpTool("commit_card_import", commitInput({ mode: "ai" }), instance);

		expect(preview.isError).toBeFalsy();
		expect(commit.isError).toBeFalsy();
		expect(instance.previewCardImport).toHaveBeenCalledWith({
			request: importRequest({ mode: "ai" }),
		});
		expect(instance.commitCardImport).toHaveBeenCalledWith(commitInput({ mode: "ai" }));
	});

	it("S-21 AC-5: rejects a client-supplied mnemonics field on commit", async () => {
		const instance = services();
		const result = await invokeMcpTool(
			"commit_card_import",
			{
				...commitInput({ mode: "ai" }),
				mnemonics: [
					{
						conceptId: "concept-1",
						slots: {
							kanji: "漢",
							isSingleKanji: true,
							shapeHint: { part: "さんずい", picture: "みず" },
							meaningHint: "もじ",
							story: "はなし",
						},
						explanation: {
							summary: "まとめ",
							mappings: [
								{ part: "さんずい", meaning: "みず" },
								{ part: "つくり", meaning: "もじ" },
							],
						},
					},
				],
			},
			instance
		);

		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "VALIDATION_ERROR" },
		});
		expect(instance.commitCardImport).not.toHaveBeenCalled();
	});

	it("returns known domain failures as tool errors rather than protocol errors", async () => {
		const instance = services({
			listDecks: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "NOT_FOUND", message: "対象が見つかりません。" },
			}),
		});
		const result = await invokeMcpTool("list_decks", {}, instance);
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
	});

	it("unwraps application-service success unions exactly once", async () => {
		const instance = services({
			previewCardImport: vi.fn().mockResolvedValue({
				ok: true,
				data: { previewToken: "opaque", importRequestHash: "a".repeat(64) },
			}),
		});
		const result = await invokeMcpTool(
			"preview_card_import",
			{
				request: {
					deck: { id: "11111111-1111-4111-8111-111111111111" },
					items: [
						{
							clientItemId: "item-1",
							conceptId: "concept-1",
							pattern: "R1",
							front: "漢",
							back: "かん",
							tags: [],
							image: { mode: "none" },
						},
					],
				},
			},
			instance
		);
		expect(result.structuredContent).toEqual({
			ok: true,
			data: { previewToken: "opaque", importRequestHash: "a".repeat(64) },
		});
		expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent));
	});
});
