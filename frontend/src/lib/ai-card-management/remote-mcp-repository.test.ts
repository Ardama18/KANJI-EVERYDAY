import { describe, expect, it, vi } from "vitest";

import {
	createRemoteMcpCardManagementRepository,
	updateRemoteMcpAiCard,
} from "./remote-mcp-repository";

const actor = {
	userId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222",
	sessionId: "session-verified",
	issuer: "https://example.invalid/auth/v1",
	audience: "https://mcp.example.invalid/api/mcp",
	scopes: ["openid", "email", "profile"] as const,
};

describe("remote MCP management repository", () => {
	it("uses the client/session-rechecking update wrapper while retaining S-13 JWT wrappers", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
		const repository = createRemoteMcpCardManagementRepository({ rpc } as never, actor);

		await repository.updateContent({
			cardId: "33333333-3333-4333-8333-333333333333",
			expectedUpdatedAt: "2026-07-19T00:00:00.000Z",
			patch: { frontText: "漢字", backText: "かんじ", skill: "reading", pattern: "R1" },
		});
		await repository.undoImport({ batchId: "44444444-4444-4444-8444-444444444444" });

		expect(rpc).toHaveBeenNthCalledWith(
			1,
			"s14_remote_update_imported_card",
			expect.objectContaining({ p_client_id: actor.clientId, p_session_id: actor.sessionId })
		);
		expect(rpc).toHaveBeenNthCalledWith(2, "undo_import", {
			p_batch_id: "44444444-4444-4444-8444-444444444444",
		});
	});

	it("sends a composite MCP patch through one authenticated atomic wrapper", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
		await updateRemoteMcpAiCard({ rpc } as never, actor, {
			cardId: "33333333-3333-4333-8333-333333333333",
			expectedUpdatedAt: "2026-07-19T00:00:00.000Z",
			patch: { deckIds: ["44444444-4444-4444-8444-444444444444"] },
		});
		expect(rpc).toHaveBeenCalledWith("s14_remote_update_ai_card", {
			p_client_id: actor.clientId,
			p_session_id: actor.sessionId,
			p_card_id: "33333333-3333-4333-8333-333333333333",
			p_expected_updated_at: "2026-07-19T00:00:00.000Z",
			p_patch: { deckIds: ["44444444-4444-4444-8444-444444444444"] },
		});
	});

	it("S-20 AC-15: still reaches set_card_illustration and undo_import after the UI removal", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
		const repository = createRemoteMcpCardManagementRepository({ rpc } as never, actor);

		await repository.setIllustration({
			cardId: "33333333-3333-4333-8333-333333333333",
			illustrationId: "55555555-5555-4555-8555-555555555555",
		});
		await repository.undoImport({ batchId: "44444444-4444-4444-8444-444444444444" });

		expect(rpc).toHaveBeenNthCalledWith(1, "set_card_illustration", {
			p_card_id: "33333333-3333-4333-8333-333333333333",
			p_illustration_id: "55555555-5555-4555-8555-555555555555",
		});
		expect(rpc).toHaveBeenNthCalledWith(2, "undo_import", {
			p_batch_id: "44444444-4444-4444-8444-444444444444",
		});
	});

	it("S-20 AC-15: the mnemonic write path is structurally absent from the MCP repository", () => {
		const repository = createRemoteMcpCardManagementRepository({ rpc: vi.fn() } as never, actor);

		// ADR-013 decision 5: the shared interface never gains a mnemonic writer, so
		// Remote MCP cannot reach card_mnemonics at all.
		expect(repository).not.toHaveProperty("upsertMnemonic");
		expect(repository).not.toHaveProperty("findOwnedCardByIllustrationKey");
	});
});
