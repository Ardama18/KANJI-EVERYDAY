import { describe, expect, it, vi } from "vitest";

import { MCP_SCOPES } from "./metadata";
import { MCP_TOOL_NAMES, type McpToolServices, invokeMcpTool, mcpToolDescriptors } from "./tools";

function services(overrides: Partial<McpToolServices> = {}): McpToolServices {
	return {
		listDecks: vi.fn().mockResolvedValue({ decks: [] }),
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

describe("S-14 static MCP tools", () => {
	it("exposes exactly the approved eight-tool allowlist", () => {
		expect(MCP_TOOL_NAMES).toEqual([
			"list_decks",
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
