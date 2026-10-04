import { describe, expect, it, vi } from "vitest";
import type { McpActorContext } from "./auth";
import { createMnemonicRecoveryServices } from "./mnemonic-recovery";

const actor: McpActorContext = {
	userId: "owner",
	clientId: "client",
	sessionId: "session",
	issuer: "issuer",
	audience: "audience",
	scopes: ["openid", "email", "profile"],
};
const items = [{ conceptId: "c", pattern: "R1", front: "危ない", back: "あぶない" }];
const mnemonic = {
	slots: {
		kanji: "危ない",
		isSingleKanji: false,
		shapeHint: { part: "崖", picture: "手すり" },
		meaningHint: "注意する",
		story: "崖の手すりで止まる",
	},
	explanation: {
		summary: "手すりで止まる",
		mappings: [
			{ part: "崖", meaning: "危険" },
			{ part: "手すり", meaning: "止まる" },
		],
	},
};
const repairInput = {
	cardId: "card",
	expectedUpdatedAt: "2026-10-04T00:00:00Z",
	idempotencyKey: "repair-a",
};
function harness(rows: unknown[], enabled = true) {
	const rpc = vi.fn(async (_name: string, _args: unknown) => rows.shift());
	const config = vi.fn(() => undefined);
	return {
		rpc,
		config,
		services: createMnemonicRecoveryServices({ rpc } as never, actor, config, () => enabled),
	};
}
describe("Issue #97 recovery boundary", () => {
	it("authorizes through owner-bound RPC before generation and maps conflicts safely", async () => {
		const h = harness([{ data: null, error: { code: "P1008", message: "private SQL/token" } }]);
		expect(await h.services.retryMnemonic({ batchId: "batch", conceptId: "c" })).toEqual({
			ok: false,
			error: { code: "CONFLICT" },
		});
		expect(h.config).not.toHaveBeenCalled();
		expect(h.rpc).toHaveBeenCalledTimes(1);
		expect(h.rpc.mock.calls[0]).toEqual([
			"s14_remote_prepare_mnemonic_retry",
			{ p_client_id: "client", p_session_id: "session", p_batch_id: "batch", p_concept_id: "c" },
		]);
	});
	it("persists configuration failure instead of dropping the word", async () => {
		const h = harness([
			{ data: { jobId: "job", token: "lease", items }, error: null },
			{
				data: {
					status: "blocked_mnemonic",
					errorCode: "MNEMONIC_CONFIG_MISSING",
					token: "internal",
				},
				error: null,
			},
		]);
		const result = await h.services.retryMnemonic({ batchId: "batch", conceptId: "c" });
		expect(result).toEqual({
			ok: true,
			data: { status: "blocked_mnemonic", errorCode: "MNEMONIC_CONFIG_MISSING" },
		});
		expect(h.rpc.mock.calls[1]).toEqual([
			"s14_remote_complete_mnemonic_retry",
			expect.objectContaining({
				p_job_id: "job",
				p_token: "lease",
				p_outcome: { conceptId: "c", status: "blocked", code: "MNEMONIC_CONFIG_MISSING" },
			}),
		]);
		expect(JSON.stringify(result)).not.toContain("internal");
	});
	it("reuses an approved mnemonic without provider generation", async () => {
		const h = harness([
			{
				data: { repairId: "repair", status: "needs_mnemonic", token: "lease", items, mnemonic },
				error: null,
			},
			{ data: { repairId: "repair", status: "queued" }, error: null },
		]);
		expect(await h.services.repairCardIllustration(repairInput)).toEqual({
			ok: true,
			data: { repairId: "repair", status: "queued" },
		});
		expect(h.config).not.toHaveBeenCalled();
		expect(h.rpc.mock.calls[1]).toEqual([
			"s14_remote_complete_illustration_repair",
			expect.objectContaining({ p_outcome: { conceptId: "c", status: "approved", mnemonic } }),
		]);
	});
	it("replays terminal repair status without exposing tokens or object paths", async () => {
		const h = harness([
			{
				data: {
					repairId: "repair",
					status: "failed",
					errorCode: "OBJECT_CONFLICT",
					token: "internal",
					path: "private/path",
				},
				error: null,
			},
		]);
		expect(await h.services.repairCardIllustration(repairInput)).toEqual({
			ok: true,
			data: { repairId: "repair", status: "failed", errorCode: "OBJECT_CONFLICT" },
		});
		expect(h.rpc).toHaveBeenCalledTimes(1);
		expect(h.config).not.toHaveBeenCalled();
	});
	it("honors the AI feature switch without DB writes or provider calls", async () => {
		const h = harness([], false);
		expect(await h.services.repairCardIllustration(repairInput)).toEqual({
			ok: false,
			error: { code: "SERVICE_UNAVAILABLE" },
		});
		expect(await h.services.retryMnemonic({ batchId: "batch", conceptId: "c" })).toEqual({
			ok: false,
			error: { code: "SERVICE_UNAVAILABLE" },
		});
		expect(h.rpc).not.toHaveBeenCalled();
		expect(h.config).not.toHaveBeenCalled();
	});
});
