import { describe, expect, it, vi } from "vitest";

import {
	AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS,
	attachIllustrationUrls,
} from "./illustration-urls";
import type { AiCardIllustration, AiCardListPage, ManagedAiCard } from "./types";

const CREATED_AT = "2026-07-19T03:04:05.000Z";

const buildCard = (
	id: string,
	illustration: AiCardIllustration | null,
	frontText = "山"
): ManagedAiCard => ({
	id,
	frontText,
	backText: "やま",
	skill: "reading",
	pattern: "R1",
	createdAt: CREATED_AT,
	updatedAt: CREATED_AT,
	source: "app_ai",
	batchId: "batch-1",
	itemId: `item-${id}`,
	decks: [],
	tags: [],
	illustration,
	illustrationKey: null,
	mnemonic: null,
	mnemonicSharedCardCount: 0,
});

const buildPage = (items: readonly ManagedAiCard[], nextCursor: string | null): AiCardListPage => ({
	items,
	nextCursor,
});

describe("frontend/src/lib/ai-card-management/illustration-urls.ts", () => {
	it("keeps the shared signed URL expiry at 3600 seconds", () => {
		expect(AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS).toBe(3600);
	});

	it("AC-1: attaches the signed URL to a ready illustration that has a storage path", async () => {
		const page = buildPage(
			[buildCard("card-1", { id: "ill-1", status: "ready", url: null })],
			null
		);
		const loadPaths = vi.fn().mockResolvedValue(new Map([["ill-1", "owner-1/ill-1.png"]]));
		const sign = vi.fn().mockResolvedValue("https://example.supabase.co/sign/ill-1");

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(result.items[0].illustration).toEqual({
			id: "ill-1",
			status: "ready",
			url: "https://example.supabase.co/sign/ill-1",
		});
		expect(sign).toHaveBeenCalledWith("owner-1/ill-1.png");
	});

	it("AC-2: never loads paths for illustrations that are not ready", async () => {
		const page = buildPage(
			[
				buildCard("card-1", { id: "ill-pending", status: "pending", url: null }),
				buildCard("card-2", { id: "ill-failed", status: "failed", url: null }),
				buildCard("card-3", { id: "ill-ready", status: "ready", url: null }),
			],
			null
		);
		const loadPaths = vi.fn().mockResolvedValue(new Map([["ill-ready", "owner-1/ill-ready.png"]]));
		const sign = vi.fn().mockResolvedValue("https://example.supabase.co/sign/ready");

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(loadPaths).toHaveBeenCalledWith(["ill-ready"]);
		expect(result.items[0].illustration?.url).toBeNull();
		expect(result.items[1].illustration?.url).toBeNull();
		expect(result.items[2].illustration?.url).toBe("https://example.supabase.co/sign/ready");
	});

	it("AC-3: leaves the URL null when the owner-scoped loader returns no path for the id", async () => {
		const page = buildPage(
			[buildCard("card-1", { id: "ill-other-owner", status: "ready", url: null })],
			null
		);
		const loadPaths = vi.fn().mockResolvedValue(new Map<string, string>());
		const sign = vi.fn().mockResolvedValue("https://example.supabase.co/sign/should-not-be-used");

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(result.items[0].illustration?.url).toBeNull();
		expect(sign).not.toHaveBeenCalled();
	});

	it("AC-4: keeps the page intact when signing fails", async () => {
		const page = buildPage(
			[
				buildCard("card-1", { id: "ill-1", status: "ready", url: null }, "山"),
				buildCard("card-2", null, "川"),
			],
			"opaque-cursor"
		);
		const loadPaths = vi.fn().mockResolvedValue(new Map([["ill-1", "owner-1/ill-1.png"]]));
		const sign = vi.fn().mockResolvedValue(null);

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(result.items).toHaveLength(2);
		expect(result.items.map((item) => item.id)).toEqual(["card-1", "card-2"]);
		expect(result.items[0].illustration?.url).toBeNull();
		expect(result.items[1].illustration).toBeNull();
		expect(result.nextCursor).toBe("opaque-cursor");
	});

	it("signs a shared storage path only once for cards that reuse one illustration", async () => {
		const page = buildPage(
			[
				buildCard("card-1", { id: "ill-1", status: "ready", url: null }, "山"),
				buildCard("card-2", { id: "ill-1", status: "ready", url: null }, "川"),
			],
			null
		);
		const loadPaths = vi.fn().mockResolvedValue(new Map([["ill-1", "owner-1/ill-1.png"]]));
		const sign = vi.fn().mockResolvedValue("https://example.supabase.co/sign/ill-1");

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(loadPaths).toHaveBeenCalledTimes(1);
		expect(loadPaths).toHaveBeenCalledWith(["ill-1"]);
		expect(sign).toHaveBeenCalledTimes(1);
		expect(result.items[0].illustration?.url).toBe("https://example.supabase.co/sign/ill-1");
		expect(result.items[1].illustration?.url).toBe("https://example.supabase.co/sign/ill-1");
	});

	it("signs a storage path once even when two distinct illustration ids share it", async () => {
		const page = buildPage(
			[
				buildCard("card-1", { id: "ill-1", status: "ready", url: null }, "山"),
				buildCard("card-2", { id: "ill-2", status: "ready", url: null }, "川"),
			],
			null
		);
		const loadPaths = vi.fn().mockResolvedValue(
			new Map([
				["ill-1", "owner-1/shared.png"],
				["ill-2", "owner-1/shared.png"],
			])
		);
		const sign = vi.fn().mockResolvedValue("https://example.supabase.co/sign/shared");

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(loadPaths).toHaveBeenCalledTimes(1);
		expect(loadPaths).toHaveBeenCalledWith(["ill-1", "ill-2"]);
		expect(sign).toHaveBeenCalledTimes(1);
		expect(sign).toHaveBeenCalledWith("owner-1/shared.png");
		expect(result.items[0].illustration?.url).toBe("https://example.supabase.co/sign/shared");
		expect(result.items[1].illustration?.url).toBe("https://example.supabase.co/sign/shared");
	});

	it("AC-2: issues no query and no signing when the page has no ready illustration", async () => {
		const page = buildPage(
			[
				buildCard("card-1", null),
				buildCard("card-2", { id: "ill-pending", status: "pending", url: null }),
			],
			null
		);
		const loadPaths = vi.fn();
		const sign = vi.fn();

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(loadPaths).not.toHaveBeenCalled();
		expect(sign).not.toHaveBeenCalled();
		expect(result).toEqual(page);
	});

	it("AC-4: returns the original page when the loader throws", async () => {
		const page = buildPage(
			[buildCard("card-1", { id: "ill-1", status: "ready", url: null })],
			"opaque-cursor"
		);
		const loadPaths = vi.fn().mockRejectedValue(new Error("owner-1/ill-1.png is unreachable"));
		const sign = vi.fn();

		const result = await attachIllustrationUrls(page, { loadPaths, sign });

		expect(result).toEqual(page);
		expect(result.items[0].illustration?.url).toBeNull();
		expect(sign).not.toHaveBeenCalled();
	});
});
