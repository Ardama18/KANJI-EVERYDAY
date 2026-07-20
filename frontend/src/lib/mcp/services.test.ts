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
