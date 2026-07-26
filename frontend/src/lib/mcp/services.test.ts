import { afterEach, describe, expect, it, vi } from "vitest";

import { hashImportRequest } from "@/lib/ai-import/canonical-request";
import { signRemotePreviewToken } from "@/lib/ai-import/preview-token";
import { validateImportRequest } from "@/lib/ai-import/schema";
import type { CommitMnemonicEntry } from "@/lib/ai-import/service";

import type { McpActorContext } from "./auth";
import { type McpToolServiceDependencies, createMcpToolServices } from "./services";

const actor: McpActorContext = {
	userId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222",
	sessionId: "session-1",
	issuer: "https://project.supabase.co/auth/v1",
	audience: "https://cards.example.test/api/mcp",
	scopes: ["openid", "email", "profile"],
};

function dependencies(
	client: unknown,
	overrides: Partial<McpToolServiceDependencies> = {}
): McpToolServiceDependencies {
	return {
		client: client as never,
		actor,
		previewSecret: "preview-secret",
		nowSeconds: 1,
		createReservationKey: () => "reservation-key",
		createCorrelationId: () => "correlation-id",
		...overrides,
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

const DECK_ID = "88888888-8888-4888-8888-888888888888";
const COMMIT_BATCH_ID = "99999999-9999-4999-8999-999999999999";

const mnemonicEntry = (conceptId: string): CommitMnemonicEntry => ({
	conceptId,
	slots: {
		kanji: "山",
		isSingleKanji: true,
		shapeHint: { part: "三つの峰", picture: "山なみ" },
		meaningHint: "たかい土地",
		story: "峰が三つならぶ",
	},
	explanation: {
		summary: "峰が三つならんで山になる。",
		mappings: [
			{ part: "左の峰", meaning: "ひくい山" },
			{ part: "右の峰", meaning: "たかい山" },
		],
	},
});

const importRequest = (...modes: readonly ("none" | "ai")[]) => ({
	deck: { id: DECK_ID },
	items: modes.map((mode, index) => ({
		clientItemId: `item-${index + 1}`,
		conceptId: `concept-00${index + 1}`,
		pattern: "R1" as const,
		front: index === 0 ? "山" : "川",
		back: index === 0 ? "やま" : "かわ",
		tags: [],
		image: { mode },
	})),
});

/** A commit input the shared service accepts: real hash and real remote preview token. */
async function commitInput(...modes: readonly ("none" | "ai")[]) {
	const request = importRequest(...modes);
	const validated = await validateImportRequest(request);
	if (!validated.success) throw new Error(`fixture request failed: ${validated.code}`);
	const importRequestHash = await hashImportRequest(validated.data);
	const previewToken = await signRemotePreviewToken(
		{
			userId: actor.userId,
			clientId: actor.clientId,
			reservationKey: "reservation-key",
			importRequestHash,
		},
		"preview-secret",
		1
	);
	return {
		request,
		previewToken,
		cardReservationKey: "reservation-key",
		importRequestHash,
		idempotencyKey: "idem-1",
		confirmedWarnings: true as const,
	};
}

const commitRpcClient = () => ({
	rpc: vi.fn().mockResolvedValue({
		data: {
			batchId: COMMIT_BATCH_ID,
			status: "queued",
			statusUrl: `/api/ai/imports/status?batchId=${COMMIT_BATCH_ID}`,
		},
		error: null,
	}),
});

const commitArgs = (client: { rpc: ReturnType<typeof vi.fn> }) => {
	const call = client.rpc.mock.calls.find(([name]) => name === "s14_remote_commit_import");
	if (call === undefined) throw new Error("expected the commit RPC to be called");
	return call[1] as Record<string, unknown>;
};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("S-21 MCP auto mnemonic wiring", () => {
	it('AC-1: generates for image.mode="ai" concepts and hands them to the shared service', async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const generateMnemonics = vi.fn(async () => [mnemonicEntry("concept-001")]);
		const services = createMcpToolServices(dependencies(client, { generateMnemonics }));
		const input = await commitInput("ai");

		const result = await services.commitCardImport(input);

		expect(result).toMatchObject({ ok: true });
		expect(generateMnemonics).toHaveBeenCalledWith(input.request);
		expect(commitArgs(client).p_mnemonics).toEqual([mnemonicEntry("concept-001")]);
	});

	it("AC-1: does not call the provider when no concept asks for an image", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const generateMnemonics = vi.fn(async () => [mnemonicEntry("concept-001")]);
		const services = createMcpToolServices(dependencies(client, { generateMnemonics }));

		const result = await services.commitCardImport(await commitInput("none"));

		expect(result).toMatchObject({ ok: true });
		expect(generateMnemonics).not.toHaveBeenCalled();
		expect(commitArgs(client).p_mnemonics).toBeNull();
	});

	it('AC-6: rejects image.mode="ai" and skips generation while the flag is off', async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "false");
		const client = commitRpcClient();
		const generateMnemonics = vi.fn(async () => [mnemonicEntry("concept-001")]);
		const services = createMcpToolServices(dependencies(client, { generateMnemonics }));

		const commit = await services.commitCardImport(await commitInput("ai"));
		const preview = await services.previewCardImport({ request: importRequest("ai") });

		expect(commit).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", httpStatus: 400 },
		});
		expect(preview).toEqual({
			ok: false,
			error: { code: "VALIDATION_ERROR", httpStatus: 400 },
		});
		expect(generateMnemonics).not.toHaveBeenCalled();
		expect(client.rpc).not.toHaveBeenCalled();
	});

	it('AC-6: keeps image.mode="none" working while the flag is off', async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "false");
		const client = commitRpcClient();
		const services = createMcpToolServices(dependencies(client));

		const result = await services.commitCardImport(await commitInput("none"));

		expect(result).toMatchObject({ ok: true });
		expect(commitArgs(client).p_mnemonics).toBeNull();
	});

	it("AC-4: commits without mnemonics when generation yields nothing", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const services = createMcpToolServices(
			dependencies(client, { generateMnemonics: async () => [] })
		);

		const result = await services.commitCardImport(await commitInput("ai"));

		expect(result).toMatchObject({ ok: true });
		expect(commitArgs(client).p_mnemonics).toBeNull();
	});

	it("AC-4: commits without mnemonics when generation throws", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const services = createMcpToolServices(
			dependencies(client, {
				generateMnemonics: async () => {
					throw new Error("provider exploded");
				},
			})
		);

		const result = await services.commitCardImport(await commitInput("ai"));

		expect(result).toMatchObject({ ok: true });
		expect(commitArgs(client).p_mnemonics).toBeNull();
	});

	it("AC-4: drops only the malformed entries instead of failing the whole commit", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const malformed = {
			...mnemonicEntry("concept-002"),
			explanation: { summary: "みだし", mappings: [{ part: "峰", meaning: "山" }] },
		} as CommitMnemonicEntry;
		const unknownConcept = mnemonicEntry("concept-404");
		const services = createMcpToolServices(
			dependencies(client, {
				generateMnemonics: async () => [
					malformed,
					mnemonicEntry("concept-001"),
					unknownConcept,
					mnemonicEntry("concept-001"),
				],
			})
		);

		const result = await services.commitCardImport(await commitInput("ai", "ai"));

		expect(result).toMatchObject({ ok: true });
		expect(commitArgs(client).p_mnemonics).toEqual([mnemonicEntry("concept-001")]);
	});

	it("AC-5: the commit response carries only batchId/status/statusUrl", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const services = createMcpToolServices(
			dependencies(client, { generateMnemonics: async () => [mnemonicEntry("concept-001")] })
		);

		const result = (await services.commitCardImport(await commitInput("ai"))) as {
			readonly ok: true;
			readonly data: Record<string, unknown>;
		};

		expect(Object.keys(result.data)).toEqual(["batchId", "status", "statusUrl"]);
		expect(result.data).toEqual({
			batchId: COMMIT_BATCH_ID,
			status: "queued",
			statusUrl: `/api/ai/imports/status?batchId=${COMMIT_BATCH_ID}`,
		});
		const serialized = JSON.stringify(result);
		for (const leak of [
			"slots",
			"explanation",
			"illustration_key",
			"illustrationKey",
			"kanji",
			"shapeHint",
			"storage",
			"s11:",
		]) {
			expect(serialized, `${leak} must not leak into the MCP response`).not.toContain(leak);
		}
	});

	it("AC-5: never lets the generator select an owner in the RPC payload", async () => {
		vi.stubEnv("AI_CARD_IMPORT_ENABLED", "true");
		const client = commitRpcClient();
		const services = createMcpToolServices(
			dependencies(client, {
				generateMnemonics: async () =>
					[
						{
							...mnemonicEntry("concept-001"),
							ownerUserId: "00000000-0000-4000-8000-000000000000",
						},
					] as unknown as readonly CommitMnemonicEntry[],
			})
		);

		await services.commitCardImport(await commitInput("ai"));

		const payload = JSON.stringify(commitArgs(client).p_mnemonics);
		expect(payload).not.toContain("owner");
		expect(payload).not.toContain("00000000-0000-4000-8000-000000000000");
	});
});
