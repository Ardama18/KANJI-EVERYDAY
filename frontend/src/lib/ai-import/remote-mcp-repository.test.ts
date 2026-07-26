import { describe, expect, it, vi } from "vitest";

import { deriveRemoteGenerationRequestHash } from "./canonical-request";
import { createRemoteMcpImportRepository } from "./remote-mcp-repository";
import { type NormalizedImportRequest, validateImportRequest } from "./schema";
import { normalizedCommitRequest } from "./service";

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

	it("sends p_mnemonics: null and the unchanged eight arguments when no mnemonic is generated", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { batchId: "safe" }, error: null });
		const repository = createRemoteMcpImportRepository({ rpc } as never, actor);
		const request = await validatedRequest();
		const importRequestHash = "b".repeat(64);

		await repository.commit({
			idempotencyKey: "idem",
			importRequestHash,
			request,
			cardReservationKey: "reservation",
			previewToken: "preview.token",
		});

		expect(rpc).toHaveBeenCalledWith("s14_remote_commit_import", {
			p_client_id: actor.clientId,
			p_session_id: actor.sessionId,
			p_idempotency_key: "idem",
			p_import_request_hash: importRequestHash,
			p_generation_request_hash: await deriveRemoteGenerationRequestHash(
				importRequestHash,
				actor.clientId
			),
			p_preview_token: "preview.token",
			p_request: normalizedCommitRequest(request),
			p_card_reservation_key: "reservation",
			p_mnemonics: null,
		});
	});

	it("passes only conceptId/slots/explanation in p_mnemonics and never an owner", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { batchId: "safe" }, error: null });
		const repository = createRemoteMcpImportRepository({ rpc } as never, actor);
		const request = await validatedRequest();

		await repository.commit({
			idempotencyKey: "idem",
			importRequestHash: "b".repeat(64),
			request,
			cardReservationKey: "reservation",
			previewToken: "preview.token",
			mnemonics: [
				{
					conceptId: "one",
					slots: {
						kanji: "漢",
						isSingleKanji: true,
						shapeHint: { part: "さんずい", picture: "みず" },
						meaningHint: "もじ",
						story: "水のそばで文字を書く",
					},
					explanation: {
						summary: "水のそばで文字を書くから漢。",
						mappings: [
							{ part: "さんずい", meaning: "みず" },
							{ part: "つくり", meaning: "もじ" },
						],
					},
				},
			],
		});

		const args = rpc.mock.calls[0]?.[1] as { p_mnemonics: unknown };
		expect(args.p_mnemonics).toEqual([
			{
				conceptId: "one",
				slots: {
					kanji: "漢",
					isSingleKanji: true,
					shapeHint: { part: "さんずい", picture: "みず" },
					meaningHint: "もじ",
					story: "水のそばで文字を書く",
				},
				explanation: {
					summary: "水のそばで文字を書くから漢。",
					mappings: [
						{ part: "さんずい", meaning: "みず" },
						{ part: "つくり", meaning: "もじ" },
					],
				},
			},
		]);
		const serialized = JSON.stringify(args.p_mnemonics);
		expect(serialized).not.toContain("owner");
		expect(serialized).not.toContain(actor.userId);
		expect(serialized).not.toContain(actor.clientId);
	});
});

async function validatedRequest(): Promise<NormalizedImportRequest> {
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
				image: { mode: "ai" },
			},
		],
	});
	if (!validated.success) throw new Error(`fixture request failed: ${validated.code}`);
	return validated.data;
}
