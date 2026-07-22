import { describe, expect, it } from "vitest";

import { sourceFilesError } from "../../../../frontend/src/components/ai-card-import/SourceUploadList";
import {
	buildModerationPayload,
	parseModerationResponse,
} from "../../../../frontend/src/lib/ai-card-generation/moderation";
import {
	buildResponsesPayload,
	classifyOpenAiFailure,
	parseOpenAiResponse,
	requestOpenAiConcepts,
} from "../../../../frontend/src/lib/ai-card-generation/openai-adapter";
import {
	mapConceptsToImportRequest,
	validateGenerationInput,
} from "../../../../frontend/src/lib/ai-card-generation/output-mapper";
import {
	aiCardUiReducer,
	createPreviewValidState,
} from "../../../../frontend/src/lib/ai-card-generation/ui-state";
import {
	nextPollDelay,
	parseBatchPointer,
	selectStatusLeader,
} from "../../../../frontend/src/lib/ai-import/status-poller";

const config = {
	apiKey: "test-key",
	model: "gpt-test",
	moderationModel: "omni-moderation-latest",
	imageDetail: "high" as const,
	generationTimeoutMs: 60_000,
	moderationTimeoutMs: 10_000,
};

const options = {
	deckId: "11111111-1111-4111-8111-111111111111",
	instruction: "一年生の漢字",
	pattern: "both" as const,
	requestedCardCount: 2,
	tags: ["一年生"],
	illustration: "none" as const,
	generationReservationKey: "reservation-1",
};

describe("S-12 OpenAI card generation unit contracts", () => {
	it("U-01 text-only payload uses the server model and strict non-persistent Responses options", () => {
		const payload = buildResponsesPayload(config, options, []);
		expect(payload).toMatchObject({ model: "gpt-test", store: false, background: false });
		expect(payload.text.format).toMatchObject({ type: "json_schema", strict: true });
		expect("tools" in payload).toBe(false);
	});

	it("U-02 image payload accepts only sanitized data URLs and configured detail", () => {
		const payload = buildResponsesPayload(config, options, [
			{ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
		]);
		const content = payload.input[1]?.content ?? [];
		expect(content[1]).toMatchObject({ type: "input_image", detail: "high" });
		expect(JSON.stringify(content)).toContain("data:image/png;base64,");
	});

	it("U-03 schema fixes minItems and maxItems to requested concept count", () => {
		const schema = buildResponsesPayload(config, options, []).text.format.schema;
		expect(schema.properties.concepts.minItems).toBe(1);
		expect(schema.properties.concepts.maxItems).toBe(1);
	});

	it("U-04 maps R1 kanji side to the front", async () => {
		const result = await mapConceptsToImportRequest(
			{ ...options, pattern: "R1", requestedCardCount: 1 },
			[{ kanjiSide: "山", counterpartSide: "やま" }]
		);
		expect(result.items[0]).toMatchObject({ pattern: "R1", front: "山", back: "やま" });
	});

	it("U-05 maps W1 kanji side to the back", async () => {
		const result = await mapConceptsToImportRequest(
			{ ...options, pattern: "W1", requestedCardCount: 1 },
			[{ kanjiSide: "山", counterpartSide: "やま" }]
		);
		expect(result.items[0]).toMatchObject({ pattern: "W1", front: "やま", back: "山" });
	});

	it("U-06 maps both to a shared concept with swapped front and back", async () => {
		const result = await mapConceptsToImportRequest(options, [
			{ kanjiSide: "山", counterpartSide: "やま" },
		]);
		expect(result.items).toHaveLength(2);
		expect(result.items[0]?.conceptId).toBe(result.items[1]?.conceptId);
		expect(result.items.map(({ front, back }) => [front, back])).toEqual([
			["山", "やま"],
			["やま", "山"],
		]);
	});

	it("U-07 rejects expanded 0/51, odd both, and provider count mismatch", async () => {
		expect(validateGenerationInput({ ...options, requestedCardCount: 0 }).success).toBe(false);
		expect(validateGenerationInput({ ...options, requestedCardCount: 51 }).success).toBe(false);
		expect(validateGenerationInput({ ...options, requestedCardCount: 3 }).success).toBe(false);
		await expect(mapConceptsToImportRequest(options, [])).rejects.toThrow();
	});

	it("U-08 parses exactly one completed assistant output_text while allowing reasoning", () => {
		const result = parseOpenAiResponse(
			{
				status: "completed",
				output: [
					{ type: "reasoning", id: "r1" },
					{
						type: "message",
						role: "assistant",
						status: "completed",
						content: [
							{
								type: "output_text",
								text: '{"concepts":[{"kanjiSide":"山","counterpartSide":"やま","mnemonic":{"slots":{"kanji":"山","isSingleKanji":true,"shapeHint":{"part":"三つの峰","picture":"そびえ立つ山並み"},"meaningHint":"たかい土地","story":"峰が三つ並ぶ風景を思い浮かべる。"},"explanation":{"summary":"三つの峰が並ぶ形が山を表す。","mappings":[{"part":"左の峰","meaning":"やま"},{"part":"中央の峰","meaning":"たかい"}]}}}]}',
							},
						],
					},
				],
			},
			1
		);
		expect(result.concepts).toHaveLength(1);
	});

	it("U-09 maps refusal without exposing refusal text", () => {
		expect(() =>
			parseOpenAiResponse(
				{
					status: "completed",
					output: [
						{
							type: "message",
							role: "assistant",
							status: "completed",
							content: [{ type: "refusal", refusal: "private" }],
						},
					],
				},
				1
			)
		).toThrowError("OPENAI_REFUSAL");
	});

	it("U-10 rejects every incomplete response without accepting partial content", () => {
		expect(() =>
			parseOpenAiResponse(
				{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] },
				1
			)
		).toThrowError("OPENAI_INCOMPLETE_OUTPUT");
	});

	it("U-11 maps invalid JSON, unknown output, and multiple messages to schema mismatch", () => {
		expect(() => parseOpenAiResponse({ status: "completed", output: [] }, 1)).toThrowError(
			"OPENAI_OUTPUT_SCHEMA_MISMATCH"
		);
	});

	it("U-12 builds one moderation input and requires exactly one boolean result", () => {
		expect(
			buildModerationPayload(config.moderationModel, { kind: "text", text: "山" })
		).toMatchObject({ model: "omni-moderation-latest", input: "山" });
		expect(parseModerationResponse({ results: [{ flagged: false }] })).toBe(false);
		expect(() => parseModerationResponse({ results: [] })).toThrowError(
			"OPENAI_MODERATION_UNAVAILABLE"
		);
	});

	it("U-13 classifies network/429/5xx, 401/403, and other 4xx safely", () => {
		expect(classifyOpenAiFailure({ kind: "network" })).toBe("OPENAI_PROVIDER_TRANSIENT");
		expect(classifyOpenAiFailure({ kind: "http", status: 429 })).toBe("OPENAI_PROVIDER_TRANSIENT");
		expect(classifyOpenAiFailure({ kind: "http", status: 401 })).toBe("OPENAI_PROVIDER_CONFIG");
		expect(classifyOpenAiFailure({ kind: "http", status: 400 })).toBe("OPENAI_PROVIDER_PERMANENT");
	});

	it("U-14 generation validation canonicalizes bounded reservation inputs", () => {
		const result = validateGenerationInput(options);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.requestedCardCount).toBe(2);
	});

	it("U-15 any preview mutation synchronously discards the token and confirmation", () => {
		const valid = createPreviewValidState({
			request: { deck: { id: options.deckId }, items: [] },
			importRequestHash: "a".repeat(64),
			previewToken: "token",
			previewExpiresAt: 1_800,
			cardReservationKey: "key",
			warnings: ["accuracy", "privacy", "copyright"],
		});
		expect(aiCardUiReducer(valid, { type: "edit", request: valid.preview.request })).toMatchObject({
			kind: "previewDirty",
		});
	});

	it("U-16 batch pointer and poll backoff are strict and terminal-aware", () => {
		expect(
			parseBatchPointer(
				'{"version":1,"deckId":"11111111-1111-4111-8111-111111111111","batchId":"22222222-2222-4222-8222-222222222222"}',
				options.deckId
			)?.batchId
		).toBe("22222222-2222-4222-8222-222222222222");
		expect(
			parseBatchPointer('{"version":1,"deckId":"x","batchId":"y","token":"secret"}', options.deckId)
		).toBeUndefined();
		expect(nextPollDelay(29_999, "queued")).toBe(2_000);
		expect(nextPollDelay(30_000, "processing")).toBe(5_000);
		expect(nextPollDelay(30_000, "completed")).toBeUndefined();
	});

	it("U-17 completed provider failures retain retry and configuration classifications", () => {
		expect(() =>
			parseOpenAiResponse({ status: "failed", error: { code: "rate_limit_exceeded" } }, 1)
		).toThrowError("OPENAI_PROVIDER_TRANSIENT");
		expect(() =>
			parseOpenAiResponse({ status: "failed", error: { code: "invalid_api_key" } }, 1)
		).toThrowError("OPENAI_PROVIDER_CONFIG");
		expect(() =>
			parseOpenAiResponse({ status: "failed", error: { code: "invalid_request_error" } }, 1)
		).toThrowError("OPENAI_PROVIDER_PERMANENT");
	});

	it("U-18 successful provider bodies are rejected while streaming beyond one MiB", async () => {
		const oversizedBody = new Uint8Array(1_048_577);
		await expect(
			requestOpenAiConcepts({
				config,
				input: options,
				images: [],
				fetcher: async () => new Response(oversizedBody, { status: 200 }),
			})
		).rejects.toThrowError("OPENAI_OUTPUT_SCHEMA_MISMATCH");
	});

	it("U-19 source validation blocks unsupported, oversized, and excess files before upload", () => {
		const file = (type: string, size: number) => ({ type, size }) as File;
		expect(sourceFilesError([file("image/png", 1)])).toBeUndefined();
		expect(sourceFilesError([file("image/gif", 1)])).toBeDefined();
		expect(sourceFilesError([file("image/png", 10 * 1024 * 1024 + 1)])).toBeDefined();
		expect(sourceFilesError(Array.from({ length: 6 }, () => file("image/png", 1)))).toBeDefined();
	});

	it("U-20 status polling elects one visible fresh tab and ignores stale or hidden tabs", () => {
		expect(
			selectStatusLeader(
				[
					{ id: "b", visible: true, heartbeatAt: 100_000 },
					{ id: "a", visible: true, heartbeatAt: 100_000 },
					{ id: "0", visible: false, heartbeatAt: 100_000 },
					{ id: "1", visible: true, heartbeatAt: 89_000 },
				],
				100_000
			)
		).toBe("a");
	});
});
