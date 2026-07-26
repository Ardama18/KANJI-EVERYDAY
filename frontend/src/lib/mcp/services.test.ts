import { describe, expect, it, vi } from "vitest";

import type { McpActorContext } from "./auth";
import { createMcpToolServices } from "./services";

const actor: McpActorContext = {
	userId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222",
	sessionId: "session-1",
	issuer: "https://project.supabase.co/auth/v1",
	audience: "https://cards.example.test/api/mcp",
	scopes: ["openid", "email", "profile"],
};

function dependencies(client: unknown) {
	return {
		client: client as never,
		actor,
		previewSecret: "preview-secret",
		nowSeconds: 1,
		createReservationKey: () => "reservation-key",
		createCorrelationId: () => "correlation-id",
	};
}

describe("frontend/src/lib/mcp/services.ts", () => {
	it("UT-S16-MCP-CREATE-DECK-OWNER: create_deck inserts with actor user ID only", async () => {
		const single = vi.fn().mockResolvedValue({
			data: { id: "deck-1", name: "初回デッキ" },
			error: null,
		});
		const select = vi.fn().mockReturnValue({ single });
		const insert = vi.fn().mockReturnValue({ select });
		const client = {
			from: vi.fn((table: string) => {
				expect(table).toBe("decks");
				return { insert };
			}),
		};
		const services = createMcpToolServices(dependencies(client));

		const result = await services.createDeck({ name: "  初回デッキ  " });

		expect(insert).toHaveBeenCalledWith({
			owner_user_id: actor.userId,
			name: "初回デッキ",
		});
		expect(insert.mock.calls[0]?.[0]).not.toHaveProperty("new_limit_per_day");
		expect(select).toHaveBeenCalledWith("id,name");
		expect(result).toEqual({ deck: { id: "deck-1", name: "初回デッキ" } });
	});

	it("UT-S16-MCP-CREATE-DECK-VALIDATION: invalid names fail before insert", async () => {
		const insert = vi.fn();
		const client = {
			from: vi.fn(() => ({ insert })),
		};
		const services = createMcpToolServices(dependencies(client));

		const result = await services.createDeck({ name: "\u0000" });

		expect(result).toMatchObject({
			ok: false,
			error: { code: "VALIDATION_ERROR", details: { field: "name" } },
		});
		expect(client.from).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("UT-S16-MCP-CREATE-DECK-SAFE-ERROR: Supabase failures are mapped without raw detail", async () => {
		const single = vi.fn().mockResolvedValue({
			data: null,
			error: { message: "SQL token secret raw database detail" },
		});
		const client = {
			from: vi.fn(() => ({
				insert: vi.fn(() => ({
					select: vi.fn(() => ({ single })),
				})),
			})),
		};
		const services = createMcpToolServices(dependencies(client));

		const result = await services.createDeck({ name: "初回デッキ" });

		expect(result).toEqual({ ok: false, error: { code: "SERVICE_UNAVAILABLE" } });
		expect(JSON.stringify(result)).not.toContain("SQL");
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});

const CARD_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const ILLUSTRATION_ID = "66666666-6666-4666-8666-666666666666";
const CREATED_AT = "2026-07-19T03:04:05.000Z";

/** The `list_ai_managed_cards` payload after 20260726000000, i.e. with the S-20 keys. */
const listRpcRow = (illustration: { id: string; status: string } | null) => ({
	id: CARD_ID,
	frontText: "山",
	backText: "やま",
	skill: "reading",
	pattern: "R1",
	createdAt: CREATED_AT,
	updatedAt: CREATED_AT,
	source: "app_ai",
	batchId: BATCH_ID,
	itemId: ITEM_ID,
	decks: [{ id: BATCH_ID, name: "一年生" }],
	tags: [{ id: ITEM_ID, name: "訓読み" }],
	illustration,
	illustrationKey: "山",
	mnemonic: {
		slots: {
			kanji: "山",
			isSingleKanji: true,
			shapeHint: { part: "三つの峰", picture: "山なみ" },
			meaningHint: "やま",
			story: "峰が三つ並ぶ",
		},
		explanation: {
			summary: "峰が三つ並んで山になる。",
			mappings: [
				{ part: "左の峰", meaning: "低い山" },
				{ part: "中央の峰", meaning: "高い山" },
			],
		},
		status: "approved",
	},
	mnemonicSharedCardCount: 2,
});

type McpListAiCardsResult = {
	readonly ok: boolean;
	readonly data?: {
		readonly items: readonly Record<string, unknown>[];
		readonly nextCursor: string | null;
	};
};

const listAiCardsThroughMcp = async (
	illustration: { id: string; status: string } | null
): Promise<McpListAiCardsResult> => {
	const rpc = vi.fn().mockResolvedValue({
		data: { items: [listRpcRow(illustration)], hasMore: false },
		error: null,
	});
	const services = createMcpToolServices(dependencies({ rpc }));
	// The tool contract types the response as `unknown`; the shape is what AC-8 pins.
	return (await services.listAiCards({})) as McpListAiCardsResult;
};

describe("S-20 MCP list_ai_cards response shape", () => {
	it("AC-8: keeps the pre-S-20 response exactly, dropping the three new fields", async () => {
		const result = await listAiCardsThroughMcp({ id: ILLUSTRATION_ID, status: "ready" });

		// Deep-equal snapshot of the response as it was before the projection change.
		expect(result).toEqual({
			ok: true,
			data: {
				items: [
					{
						id: CARD_ID,
						frontText: "山",
						backText: "やま",
						skill: "reading",
						pattern: "R1",
						createdAt: CREATED_AT,
						updatedAt: CREATED_AT,
						source: "app_ai",
						batchId: BATCH_ID,
						itemId: ITEM_ID,
						decks: [{ id: BATCH_ID, name: "一年生" }],
						tags: [{ id: ITEM_ID, name: "訓読み" }],
						illustration: { id: ILLUSTRATION_ID, status: "ready", url: null },
					},
				],
				nextCursor: null,
			},
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("illustrationKey");
		expect(serialized).not.toContain("mnemonic");
		expect(serialized).not.toContain("mnemonicSharedCardCount");
	});

	it("AC-8: preserves the key set and key order, including a null illustration", async () => {
		const result = await listAiCardsThroughMcp(null);

		expect(result).toMatchObject({ ok: true });
		const item = result.data?.items[0];
		if (item === undefined) throw new Error("expected the MCP list to succeed");
		expect(Object.keys(item)).toEqual([
			"id",
			"frontText",
			"backText",
			"skill",
			"pattern",
			"createdAt",
			"updatedAt",
			"source",
			"batchId",
			"itemId",
			"decks",
			"tags",
			"illustration",
		]);
		expect(item.illustration).toBeNull();
	});
});
