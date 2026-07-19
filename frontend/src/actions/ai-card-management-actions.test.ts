import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const noStoreMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: createServerClientMock }));
vi.mock("next/cache", () => ({
	unstable_noStore: noStoreMock,
	revalidatePath: revalidatePathMock,
}));

import {
	getAiCardListAction,
	getAiCardManagementOptionsAction,
} from "./ai-card-management-actions";

describe("S-13 management Server Action boundary", () => {
	beforeEach(() => createServerClientMock.mockReset());
	afterEach(() => Reflect.deleteProperty(process.env, "AI_CARD_MANAGEMENT_ENABLED"));

	it("checks the fail-closed flag before creating a DB client", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = " true ";
		expect(await getAiCardListAction({})).toMatchObject({ ok: false, error: { code: "DISABLED" } });
		expect(createServerClientMock).not.toHaveBeenCalled();
	});

	it("checks auth before validating or calling the RPC", async () => {
		process.env.AI_CARD_MANAGEMENT_ENABLED = "true";
		const rpc = vi.fn();
		createServerClientMock.mockReturnValue({
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
			rpc,
		});
		expect(await getAiCardListAction({ limit: 0 })).toMatchObject({
			ok: false,
			error: { code: "UNAUTHORIZED" },
		});
		expect(rpc).not.toHaveBeenCalled();
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
});
