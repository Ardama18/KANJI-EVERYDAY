import { describe, expect, it, vi } from "vitest";

import { handleMcpServerRequest } from "./server";
import type { McpToolServices } from "./tools";

function services(): McpToolServices {
	return {
		listDecks: vi.fn().mockResolvedValue({ decks: [] }),
		createDeck: vi.fn(),
		previewCardImport: vi.fn(),
		commitCardImport: vi.fn(),
		getImportStatus: vi.fn(),
		listAiCards: vi.fn(),
		updateAiCard: vi.fn(),
		deleteAiCards: vi.fn(),
		undoImportBatch: vi.fn(),
	};
}

function mcpRequest(body: unknown): Request {
	return new Request("https://cards.example.test/api/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});
}

describe("S-14 MCP SDK v1 stateless server", () => {
	it("exposes only the tools capability during initialize", async () => {
		const response = await handleMcpServerRequest(
			mcpRequest({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "fixture", version: "1" },
				},
			}),
			services()
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as { result?: { capabilities?: Record<string, unknown> } };
		expect(body.result?.capabilities).toEqual({ tools: { listChanged: true } });
	});

	it("derives tools/list and tools/call from the same static map", async () => {
		const instance = services();
		const listResponse = await handleMcpServerRequest(
			mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
			instance
		);
		const listBody = (await listResponse.json()) as {
			result?: {
				tools?: Array<{
					name: string;
					securitySchemes?: unknown;
					_meta?: Record<string, unknown>;
				}>;
			};
		};
		expect(listBody.result?.tools?.map((tool) => tool.name)).toEqual([
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
		expect(listBody.result?.tools?.every((tool) => tool._meta?.securitySchemes !== undefined)).toBe(
			true
		);
		expect(
			listBody.result?.tools?.every(
				(tool) =>
					JSON.stringify(tool.securitySchemes) === JSON.stringify(tool._meta?.securitySchemes)
			)
		).toBe(true);

		const callResponse = await handleMcpServerRequest(
			mcpRequest({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "list_decks", arguments: {} },
			}),
			instance
		);
		expect(callResponse.status).toBe(200);
		expect(instance.listDecks).toHaveBeenCalledOnce();
	});

	it("keeps an SDK unknown-tool result away from every domain service", async () => {
		const instance = services();
		const response = await handleMcpServerRequest(
			mcpRequest({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "not_allowed", arguments: {} },
			}),
			instance
		);
		const body = (await response.json()) as { result?: { isError?: boolean } };
		expect(body.result?.isError).toBe(true);
		expect(instance.listDecks).not.toHaveBeenCalled();
	});
});
