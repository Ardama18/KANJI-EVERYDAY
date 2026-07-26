import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const noStoreMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const getSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: createServerClientMock }));
vi.mock("@/lib/illustration/storage", () => ({ getSignedUrl: getSignedUrlMock }));
vi.mock("next/cache", () => ({
	unstable_noStore: noStoreMock,
	revalidatePath: revalidatePathMock,
}));

import * as aiCardManagementActions from "./ai-card-management-actions";
import {
	getAiCardListAction,
	getAiCardManagementOptionsAction,
} from "./ai-card-management-actions";

describe("S-13 management Server Action boundary", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		getSignedUrlMock.mockReset();
	});
	afterEach(() => Reflect.deleteProperty(process.env, "AI_CARD_MANAGEMENT_ENABLED"));

	it("checks the fail-closed flag before creating a DB client", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = " true ";
		expect(await getAiCardListAction({})).toMatchObject({ ok: false, error: { code: "DISABLED" } });
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("checks auth before validating or calling the RPC", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		const rpc = vi.fn();
		const from = vi.fn();
		createServerClientMock.mockReturnValue({
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
			rpc,
			from,
		});
		expect(await getAiCardListAction({ limit: 0 })).toMatchObject({
			ok: false,
			error: { code: "UNAUTHORIZED" },
		});
		expect(rpc).not.toHaveBeenCalled();
		// Signing is an external API behind the same boundary (testing-guide:
		// 未認証なら DML と external API が 0 回).
		expect(from).not.toHaveBeenCalled();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("maps owner-hidden DB failures to the safe not-found shape", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		createServerClientMock.mockReturnValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null }),
			},
			rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "P1003", message: "raw" } }),
		});
		expect(await getAiCardListAction({})).toEqual({
			ok: false,
			error: { code: "NOT_FOUND", status: 404, message: "対象が見つかりません。" },
		});
	});

	it("returns a safe error when loading management options throws", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		const order = vi.fn().mockRejectedValue(new Error("raw network error"));
		createServerClientMock.mockReturnValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null }),
			},
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({ order })),
				})),
			})),
		});

		expect(await getAiCardManagementOptionsAction()).toEqual({
			ok: false,
			error: {
				code: "INTERNAL_ERROR",
				status: 500,
				message: "処理に失敗しました。時間をおいて再試行してください。",
			},
		});
	});

	it("AC-16: returns deck and tag choices only and queries no illustration row", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		const from = vi.fn((table: string) => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					order: vi.fn(async () => ({
						data:
							table === "decks"
								? [{ id: "deck-1", name: "一年生" }]
								: [{ id: "tag-1", display_name: "訓読み" }],
						error: null,
					})),
				})),
			})),
		}));
		createServerClientMock.mockReturnValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }),
			},
			from,
		});

		const result = await getAiCardManagementOptionsAction();

		expect(result).toEqual({
			ok: true,
			data: {
				decks: [{ id: "deck-1", name: "一年生" }],
				tags: [{ id: "tag-1", name: "訓読み" }],
			},
		});
		if (!result.ok) throw new Error("expected the options to load");
		expect(result.data).not.toHaveProperty("illustrations");
		expect(from.mock.calls.map(([table]) => table)).toEqual(["decks", "tags"]);
	});

	it("AC-12: exposes no illustration mutation action and adds the mnemonic one", () => {
		expect(aiCardManagementActions).not.toHaveProperty("setAiCardIllustrationAction");
		expect(typeof aiCardManagementActions.updateAiCardMnemonicAction).toBe("function");
		// AC-15: the Remote MCP undo path keeps its Server Action.
		expect(typeof aiCardManagementActions.undoAiImportBatchAction).toBe("function");
	});
});

const CARD_CREATED_AT = "2026-07-19T03:04:05.000Z";
const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/illustrations/x?token=t";

type IllustrationRow = { id: string; storage_path: string | null };
type IllustrationQueryResult = {
	data: IllustrationRow[] | null;
	error: { message: string } | null;
};

interface IllustrationQueryBuilder {
	select: (columns: string) => IllustrationQueryBuilder;
	in: (column: string, values: readonly string[]) => IllustrationQueryBuilder;
	eq: (column: string, value: string) => IllustrationQueryBuilder;
	not: (column: string, operator: string, value: null) => Promise<IllustrationQueryResult>;
}

const buildListRpcData = (illustration: { id: string; status: string } | null) => ({
	items: [
		{
			id: "card-1",
			frontText: "山",
			backText: "やま",
			skill: "reading",
			pattern: "R1",
			createdAt: CARD_CREATED_AT,
			updatedAt: CARD_CREATED_AT,
			source: "app_ai",
			batchId: "batch-1",
			itemId: "item-1",
			decks: [],
			tags: [],
			illustration,
		},
	],
	hasMore: false,
});

const createListClientMock = (
	illustration: { id: string; status: string } | null,
	illustrationQueryResult: IllustrationQueryResult
) => {
	const filters: {
		select: string[];
		in: [string, readonly string[]][];
		eq: [string, string][];
		not: [string, string, null][];
	} = { select: [], in: [], eq: [], not: [] };
	const from = vi.fn();
	const builder: IllustrationQueryBuilder = {
		select: vi.fn((columns: string) => {
			filters.select.push(columns);
			return builder;
		}),
		in: vi.fn((column: string, values: readonly string[]) => {
			filters.in.push([column, values]);
			return builder;
		}),
		eq: vi.fn((column: string, value: string) => {
			filters.eq.push([column, value]);
			return builder;
		}),
		not: vi.fn(
			async (column: string, operator: string, value: null): Promise<IllustrationQueryResult> => {
				filters.not.push([column, operator, value]);
				return illustrationQueryResult;
			}
		),
	};
	from.mockReturnValue(builder);
	createServerClientMock.mockReturnValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }),
		},
		rpc: vi.fn().mockResolvedValue({ data: buildListRpcData(illustration), error: null }),
		from,
	});
	return { from, filters };
};

describe("S-18 AI card list illustration signed URLs", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		getSignedUrlMock.mockReset();
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
	});
	afterEach(() => Reflect.deleteProperty(process.env, "AI_CARD_MANAGEMENT_ENABLED"));

	it("AC-1/AC-4: signs the ready illustration path for 3600 seconds", async () => {
		createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: [{ id: "ill-1", storage_path: "owner-1/ill-1.png" }], error: null }
		);
		getSignedUrlMock.mockResolvedValue(SIGNED_URL);

		const result = await getAiCardListAction({});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error("expected the list to succeed");
		expect(result.data.items[0].illustration).toEqual({
			id: "ill-1",
			status: "ready",
			url: SIGNED_URL,
		});
		expect(getSignedUrlMock).toHaveBeenCalledWith("owner-1/ill-1.png", 3600);
	});

	it("AC-3: scopes the path lookup to the authenticated owner and ready rows", async () => {
		const { from, filters } = createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: [{ id: "ill-1", storage_path: "owner-1/ill-1.png" }], error: null }
		);
		getSignedUrlMock.mockResolvedValue(SIGNED_URL);

		await getAiCardListAction({});

		expect(from).toHaveBeenCalledWith("illustrations");
		expect(filters.select).toEqual(["id, storage_path"]);
		expect(filters.in).toEqual([["id", ["ill-1"]]]);
		expect(filters.eq).toEqual([
			["owner_user_id", "owner-1"],
			["status", "ready"],
		]);
		expect(filters.not).toEqual([["storage_path", "is", null]]);
	});

	it("AC-4: keeps the list usable when the illustration lookup fails", async () => {
		createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: null, error: { message: "raw db failure" } }
		);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const result = await getAiCardListAction({});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error("expected the list to succeed");
		expect(result.data.items[0].illustration).toEqual({
			id: "ill-1",
			status: "ready",
			url: null,
		});
		expect(getSignedUrlMock).not.toHaveBeenCalled();
		// The failure is observable in the logs, but redacted.
		expect(consoleError).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain("owner-1/");
		consoleError.mockRestore();
	});

	it("AC-4: skips a ready illustration whose storage path is null", async () => {
		const { from } = createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: [{ id: "ill-1", storage_path: null }], error: null }
		);

		const result = await getAiCardListAction({});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error("expected the list to succeed");
		expect(result.data.items[0].illustration).toEqual({
			id: "ill-1",
			status: "ready",
			url: null,
		});
		expect(from).toHaveBeenCalledWith("illustrations");
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("AC-4: keeps the list usable when signing returns no URL", async () => {
		createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: [{ id: "ill-1", storage_path: "owner-1/ill-1.png" }], error: null }
		);
		getSignedUrlMock.mockResolvedValue(null);

		const result = await getAiCardListAction({});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error("expected the list to succeed");
		expect(result.data.items[0].illustration?.url).toBeNull();
	});

	it("AC-2: queries no illustration row when the page has no ready illustration", async () => {
		const { from } = createListClientMock(
			{ id: "ill-1", status: "pending" },
			{
				data: [],
				error: null,
			}
		);

		const result = await getAiCardListAction({});

		expect(result).toMatchObject({ ok: true });
		expect(from).not.toHaveBeenCalled();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});

	it("AC-3: never returns a storage path key to the client", async () => {
		createListClientMock(
			{ id: "ill-1", status: "ready" },
			{ data: [{ id: "ill-1", storage_path: "owner-1/ill-1.png" }], error: null }
		);
		getSignedUrlMock.mockResolvedValue(SIGNED_URL);

		const result = await getAiCardListAction({});

		expect(JSON.stringify(result)).not.toContain("storage_path");
		expect(JSON.stringify(result)).not.toContain("owner-1/ill-1.png");
	});
});
