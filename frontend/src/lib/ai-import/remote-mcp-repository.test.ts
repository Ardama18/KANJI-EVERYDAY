import { describe, expect, it, vi } from "vitest";

import { deriveRemoteGenerationRequestHash } from "./canonical-request";
import { createRemoteMcpImportRepository } from "./remote-mcp-repository";
import { validateImportRequest } from "./schema";

const actor = {
	userId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222",
	sessionId: "session-verified",
	issuer: "https://example.invalid/auth/v1",
	audience: "https://mcp.example.invalid/api/mcp",
	scopes: ["openid", "email", "profile"] as const,
};

describe("remote MCP import repository", () => {
	it("binds validated preview calls to verified client/session without an owner argument", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
		const repository = createRemoteMcpImportRepository({ rpc } as never, actor);

		await repository.validatePreview({
			deckId: "33333333-3333-4333-8333-333333333333",
			reservationKey: "reservation",
			importRequestHash: "a".repeat(64),
			uploadIds: [],
			items: [],
		});

		expect(rpc).toHaveBeenCalledWith("s14_remote_validate_import_preview", {
			p_client_id: actor.clientId,
			p_session_id: actor.sessionId,
			p_deck_id: "33333333-3333-4333-8333-333333333333",
			p_reservation_key: "reservation",
			p_import_request_hash: "a".repeat(64),
			p_upload_ids: [],
			p_items: [],
		});
	});

	it("derives the trusted remote generation hash instead of accepting it from callers", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { batchId: "safe" }, error: null });
		const repository = createRemoteMcpImportRepository({ rpc } as never, actor);
		const validated = await validateImportRequest({
			deck: { id: "33333333-3333-4333-8333-333333333333" },
			items: [
				{
					clientItemId: "one",
					conceptId: "one",
					pattern: "R1",
					front: "漢字",
					back: "かんじ",
					tags: [],
					image: { mode: "none" },
				},
			],
		});
		expect(validated.success).toBe(true);
		if (!validated.success) return;

		const importRequestHash = "b".repeat(64);
		await repository.commit({
			idempotencyKey: "idem",
			importRequestHash,
			request: validated.data,
			cardReservationKey: "reservation",
			previewToken: "preview.token",
		});

		expect(rpc).toHaveBeenCalledWith(
			"s14_remote_commit_import",
			expect.objectContaining({
				p_client_id: actor.clientId,
				p_session_id: actor.sessionId,
				p_generation_request_hash: await deriveRemoteGenerationRequestHash(
					importRequestHash,
					actor.clientId
				),
				p_preview_token: "preview.token",
			})
		);
	});
});
