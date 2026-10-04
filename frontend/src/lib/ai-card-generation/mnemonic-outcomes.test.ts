import type { OpenAiCardGenerationConfig } from "@/lib/env";
import { describe, expect, it, vi } from "vitest";
import { parseImportStatusResponse } from "../ai-import/async-contract";
import { sanitizeOutcomes } from "../ai-import/service";
import { nextPollDelay } from "../ai-import/status-poller";
import { generateMnemonicOutcomes, generateMnemonicResult } from "./mnemonic-generation";
import { isMnemonicRetryable } from "./mnemonic-outcomes";

const config: OpenAiCardGenerationConfig = {
	apiKey: "secret-fixture",
	model: "fixture",
	moderationModel: "omni-moderation-latest",
	imageDetail: "high",
	generationTimeoutMs: 1000,
	moderationTimeoutMs: 1000,
};
const item = (conceptId: string, front = "危ない") => ({
	conceptId,
	pattern: "R1" as const,
	front,
	back: "あぶない",
});
const output = {
	slots: {
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
const envelope = (value: unknown) => ({
	status: "completed",
	output: [
		{
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: JSON.stringify(value) }],
		},
	],
});
const passing = vi.fn(async (url: string | URL | Request) =>
	Response.json(
		String(url).endsWith("moderations") ? { results: [{ flagged: false }] } : envelope(output)
	)
);

describe("Issue #97 per-concept outcomes", () => {
	it("keeps all 80 concepts visible when only 20 can start", async () => {
		passing.mockClear();
		const result = await generateMnemonicOutcomes({
			config,
			items: Array.from({ length: 80 }, (_, i) => item(`word-${i}`)),
			limits: { maxConcepts: 20, budgetMs: 45000 },
			fetcher: passing,
		});
		expect(result).toHaveLength(80);
		expect(result.filter((outcome) => outcome.status === "approved")).toHaveLength(20);
		expect(
			result.filter(
				(outcome) => outcome.status === "blocked" && outcome.code === "MNEMONIC_LIMIT_EXCEEDED"
			)
		).toHaveLength(60);
		expect(passing).toHaveBeenCalledTimes(40);
	});
	it("retains cap overflow and generates only once for R1/W1", async () => {
		passing.mockClear();
		const result = await generateMnemonicOutcomes({
			config,
			items: [
				item("a"),
				{ conceptId: "a", pattern: "W1", front: "あぶない", back: "危ない" },
				item("b"),
			],
			limits: { maxConcepts: 1, budgetMs: 1000 },
			fetcher: passing,
		});
		expect(result).toMatchObject([
			{ conceptId: "a", status: "approved", mnemonic: { slots: { kanji: "危ない" } } },
			{ conceptId: "b", status: "blocked", code: "MNEMONIC_LIMIT_EXCEEDED" },
		]);
		expect(passing).toHaveBeenCalledTimes(2);
	});
	it("retains every unstarted concept when the budget expires", async () => {
		const fetcher = vi.fn();
		const result = await generateMnemonicOutcomes({
			config,
			items: [item("a"), item("b")],
			limits: { maxConcepts: 20, budgetMs: 0 },
			fetcher,
		});
		expect(result).toEqual(
			["a", "b"].map((conceptId) => ({
				conceptId,
				status: "blocked",
				code: "MNEMONIC_BUDGET_EXCEEDED",
			}))
		);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("distinguishes disabled/configuration/unsupported from not-required", async () => {
		expect(
			await generateMnemonicOutcomes({
				items: [item("a"), item("b", "かな"), item("c", "山".repeat(17))],
				limits: { maxConcepts: 20, budgetMs: 1000 },
			})
		).toEqual([
			{ conceptId: "a", status: "blocked", code: "MNEMONIC_CONFIG_MISSING" },
			{ conceptId: "b", status: "not_required" },
			{ conceptId: "c", status: "blocked", code: "MNEMONIC_TARGET_UNSUPPORTED" },
		]);
	});
	it.each([
		[429, "MNEMONIC_HTTP_TRANSIENT"],
		[503, "MNEMONIC_HTTP_TRANSIENT"],
		[401, "MNEMONIC_HTTP_PERMANENT"],
	])("classifies HTTP %s without body leakage", async (status, code) => {
		const result = await generateMnemonicResult({
			config,
			input: { kanji: "危ない", isSingleKanji: false, meaning: "あぶない" },
			fetcher: async () =>
				new Response("secret-fixture provider details", { status: Number(status) }),
		});
		expect(result).toEqual({ ok: false, code });
		expect(JSON.stringify(result)).not.toContain("secret-fixture");
	});
	it("classifies timeout separately from network errors", async () => {
		const signal = AbortSignal.abort();
		expect(
			await generateMnemonicResult({
				config,
				signal,
				input: { kanji: "山", isSingleKanji: true, meaning: "やま" },
				fetcher: async () => {
					throw new Error("secret");
				},
			})
		).toEqual({ ok: false, code: "MNEMONIC_TIMEOUT" });
	});
	it.each([true, "unavailable"])("moderation %s is an explicit blocked result", async (flag) => {
		const fetcher: typeof fetch = async (url) =>
			String(url).endsWith("moderations")
				? flag === "unavailable"
					? new Response("secret", { status: 503 })
					: Response.json({ results: [{ flagged: true }] })
				: Response.json(envelope(output));
		expect(
			await generateMnemonicOutcomes({
				config,
				items: [item("a")],
				limits: { maxConcepts: 1, budgetMs: 1000 },
				fetcher,
			})
		).toEqual([
			{
				conceptId: "a",
				status: "blocked",
				code:
					flag === "unavailable"
						? "MNEMONIC_MODERATION_UNAVAILABLE"
						: "MNEMONIC_MODERATION_BLOCKED",
			},
		]);
	});
	it("passes remaining wall-clock time into moderation", async () => {
		let clock = 0;
		const fetcher: typeof fetch = async (url, init) => {
			if (!String(url).endsWith("moderations")) {
				clock = 99;
				return Response.json(envelope(output));
			}
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return Response.json({ results: [{ flagged: false }] });
		};
		expect(
			(
				await generateMnemonicOutcomes({
					config,
					items: [item("a")],
					limits: { maxConcepts: 1, budgetMs: 100 },
					fetcher,
					now: () => clock,
				})
			)[0]?.status
		).toBe("approved");
	});
	it("does not automatically retry moderation blocks", () => {
		expect(isMnemonicRetryable("MNEMONIC_MODERATION_BLOCKED")).toBe(false);
		expect(isMnemonicRetryable("MNEMONIC_MODERATION_UNAVAILABLE")).toBe(true);
	});
});

describe("Issue #97 outcome contracts", () => {
	it("rejects arbitrary codes, duplicate/foreign concepts, and malformed approved drafts", () => {
		for (const entries of [
			[{ conceptId: "a", status: "blocked", code: "private-provider-error" }],
			[{ conceptId: "foreign", status: "not_required" }],
			[{ conceptId: "a", status: "approved", mnemonic: {} }],
			[
				{ conceptId: "a", status: "not_required" },
				{ conceptId: "a", status: "not_required" },
			],
		]) {
			expect(sanitizeOutcomes(entries, new Set(["a"]))).toBeUndefined();
		}
	});
	it("accepts blocked status without counting it as success, stops polling, and rejects false completion", () => {
		const result = {
			batchId: "11111111-1111-4111-8111-111111111111",
			status: "blocked_mnemonic",
			counts: { total: 1, succeeded: 0, failed: 0 },
			items: [
				{
					itemId: "22222222-2222-4222-8222-222222222222",
					conceptId: "c",
					status: "blocked_mnemonic",
					errorCode: "MNEMONIC_LIMIT_EXCEEDED",
				},
			],
		};
		expect(parseImportStatusResponse(result)).toEqual(result);
		expect(nextPollDelay(0, "blocked_mnemonic")).toBeUndefined();
		expect(parseImportStatusResponse({ ...result, status: "completed" })).toBeUndefined();
		expect(
			parseImportStatusResponse({
				...result,
				items: [{ ...result.items[0], errorCode: "raw-error" }],
			})
		).toBeUndefined();
	});
});
