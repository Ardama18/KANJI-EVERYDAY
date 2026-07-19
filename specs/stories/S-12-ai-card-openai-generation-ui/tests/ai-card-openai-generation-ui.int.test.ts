import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { generateCardDraft } from "../../../../frontend/src/lib/ai-card-generation/generation-service";
import { parseGenerationSourceUploadIds } from "../../../../frontend/src/lib/ai-card-generation/generation-source-service";
import {
	buildModerationPayload,
	parseModerationResponse,
} from "../../../../frontend/src/lib/ai-card-generation/moderation";
import {
	buildResponsesPayload,
	classifyOpenAiFailure,
	parseOpenAiResponse,
} from "../../../../frontend/src/lib/ai-card-generation/openai-adapter";
import {
	mapConceptsToImportRequest,
	validateGenerationInput,
} from "../../../../frontend/src/lib/ai-card-generation/output-mapper";
import {
	aiCardUiReducer,
	createPreviewValidState,
} from "../../../../frontend/src/lib/ai-card-generation/ui-state";
import { hashImportRequest } from "../../../../frontend/src/lib/ai-import/canonical-request";
import { createImportPreview } from "../../../../frontend/src/lib/ai-import/preview-service";
import {
	signPreviewToken,
	verifyPreviewToken,
} from "../../../../frontend/src/lib/ai-import/preview-token";

const deckId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const input = {
	deckId,
	instruction: "一年生の漢字",
	pattern: "both" as const,
	requestedCardCount: 2,
	tags: ["一年生"],
	illustration: "none" as const,
	generationReservationKey: "reservation-1",
};
const concepts = [{ kanjiSide: "山", counterpartSide: "やま" }];
const config = {
	apiKey: "mock-key",
	model: "gpt-mocked",
	moderationModel: "omni-moderation-latest" as const,
	imageDetail: "high" as const,
	generationTimeoutMs: 60_000,
	moderationTimeoutMs: 10_000,
};

async function successfulGeneration(
	overrides: {
		readonly sources?: readonly {
			readonly mime: "image/png";
			readonly bytes: Uint8Array;
			readonly digest: string;
		}[];
	} = {}
) {
	const stages: string[] = [];
	const preview = await generateCardDraft(input, overrides.sources ?? [], {
		moderateText: async (_text, stage) => {
			stages.push(`${stage}-moderation`);
		},
		moderateImage: async () => {
			stages.push("image-moderation");
		},
		reserveUsage: async ({ units }) => {
			stages.push(`reserve-${units}`);
		},
		requestConcepts: async () => {
			stages.push("responses");
			return concepts;
		},
		createPreview: async (request, cardReservationKey) => ({
			request,
			importRequestHash: "a".repeat(64),
			previewToken: "token",
			previewExpiresAt: 1_800,
			cardReservationKey,
			warnings: ["accuracy", "privacy", "copyright"],
		}),
	});
	return { preview, stages };
}

describe("S-12 provider, route-service, and S-10/S-11 integration contracts", () => {
	it("INT-01 AC-01: text-only generation connects input moderation through normalized preview", async () => {
		const { preview, stages } = await successfulGeneration();
		expect(stages).toEqual(["input-moderation", "reserve-2", "responses", "output-moderation"]);
		expect(preview.request.items).toHaveLength(2);
	});

	it("INT-02 AC-01/06: source generation sends the same sanitized bytes through image moderation", async () => {
		const source = {
			mime: "image/png" as const,
			bytes: new Uint8Array([1, 2, 3]),
			digest: "a".repeat(64),
		};
		const { stages } = await successfulGeneration({ sources: [source] });
		expect(stages).toContain("image-moderation");
		expect(buildResponsesPayload(config, input, [source]).input[1].content[1]).toMatchObject({
			image_url: "data:image/png;base64,AQID",
		});
	});

	it("INT-03 AC-01/03: Responses payload contains only strict server-fixed fields", () => {
		const payload = buildResponsesPayload(config, input, []);
		expect(payload).toMatchObject({
			model: "gpt-mocked",
			store: false,
			background: false,
			max_output_tokens: 32768,
		});
		expect(payload.text.format.strict).toBe(true);
		expect("tools" in payload).toBe(false);
	});

	it("INT-04 AC-02: provider concepts map deterministically to swapped R1/W1 pairs", async () => {
		const request = await mapConceptsToImportRequest(input, concepts);
		expect(
			request.items.map((item) => [item.pattern, item.front, item.back, item.conceptId])
		).toEqual([
			["R1", "山", "やま", "concept-001"],
			["W1", "やま", "山", "concept-001"],
		]);
	});

	it("INT-05 AC-02: expanded boundaries reject before quota and output mismatch rejects after reservation", async () => {
		expect(validateGenerationInput({ ...input, requestedCardCount: 3 }).success).toBe(false);
		const reserve = vi.fn(async () => undefined);
		const provider = vi.fn(async () => []);
		await expect(
			generateCardDraft(input, [], {
				moderateText: async () => undefined,
				moderateImage: async () => undefined,
				reserveUsage: reserve,
				requestConcepts: provider,
				createPreview: async () => {
					throw new Error("unexpected");
				},
			})
		).rejects.toThrow("OPENAI_OUTPUT_SCHEMA_MISMATCH");
		expect(reserve).toHaveBeenCalledOnce();
		expect(provider).toHaveBeenCalledOnce();
	});

	it("INT-06 AC-03: every Structured Outputs mismatch maps uniquely to schema mismatch", () => {
		for (const response of [
			{ status: "completed", output: [] },
			{ status: "completed", output: [{ type: "unknown" }] },
			{
				status: "completed",
				output: [
					{
						type: "message",
						role: "assistant",
						status: "completed",
						content: [{ type: "output_text", text: "not-json" }],
					},
				],
			},
		])
			expect(() => parseOpenAiResponse(response, 1)).toThrow("OPENAI_OUTPUT_SCHEMA_MISMATCH");
	});

	it("INT-07 AC-03: refusal and incomplete remain distinct and partial output is discarded", () => {
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
		).toThrow("OPENAI_REFUSAL");
		expect(() =>
			parseOpenAiResponse(
				{
					status: "incomplete",
					incomplete_details: { reason: "content_filter" },
					output: [{ type: "message" }],
				},
				1
			)
		).toThrow("OPENAI_INCOMPLETE_OUTPUT");
	});

	it("INT-08 AC-03: text/image/output moderation uses isolated payloads and fails closed", () => {
		expect(buildModerationPayload(config.moderationModel, { kind: "text", text: "山" })).toEqual({
			model: config.moderationModel,
			input: "山",
		});
		expect(parseModerationResponse({ results: [{ flagged: true }] })).toBe(true);
		expect(() => parseModerationResponse({ results: [{ flagged: "false" }] })).toThrow(
			"OPENAI_MODERATION_UNAVAILABLE"
		);
	});

	it("INT-09 AC-03: OpenAI transport failures classify without provider bodies", () => {
		expect(classifyOpenAiFailure({ kind: "network" })).toBe("OPENAI_PROVIDER_TRANSIENT");
		expect(classifyOpenAiFailure({ kind: "http", status: 503 })).toBe("OPENAI_PROVIDER_TRANSIENT");
		expect(classifyOpenAiFailure({ kind: "http", status: 403 })).toBe("OPENAI_PROVIDER_CONFIG");
		expect(classifyOpenAiFailure({ kind: "http", status: 422 })).toBe("OPENAI_PROVIDER_PERMANENT");
	});

	it("INT-10 AC-04: edits dirty preview and re-preview issues a request-bound new token", async () => {
		const request = await mapConceptsToImportRequest(input, concepts);
		const first = await createImportPreview(userId, request, input.generationReservationKey, {
			secret: "secret",
			nowSeconds: 100,
			validateDatabase: async () => undefined,
		});
		const dirty = aiCardUiReducer(createPreviewValidState(first), {
			type: "edit",
			request: {
				...request,
				items: request.items.map((item) =>
					item.pattern === "R1" ? { ...item, back: "やま（山）" } : { ...item, front: "やま（山）" }
				),
			},
		});
		expect(dirty.kind).toBe("previewDirty");
		if (dirty.kind !== "previewDirty") throw new Error("dirty state expected");
		const second = await createImportPreview(
			userId,
			dirty.request,
			input.generationReservationKey,
			{ secret: "secret", nowSeconds: 101, validateDatabase: async () => undefined }
		);
		expect(second.previewToken).not.toBe(first.previewToken);
	});

	it("INT-11 AC-04: commit route requires exact confirmedWarnings true before RPC", async () => {
		const source = await readFile(
			new URL("../../../../frontend/app/api/ai/imports/commit/route.ts", import.meta.url),
			"utf8"
		);
		expect(source).toContain("body.confirmedWarnings !== true");
		expect(source.indexOf("body.confirmedWarnings !== true")).toBeLessThan(
			source.indexOf('service.rpc("commit_generated_import_async"')
		);
	});

	it("INT-12 AC-05: preview token rejects tamper, expiry, owner, reservation, and content replacement", async () => {
		const request = await mapConceptsToImportRequest(input, concepts);
		const hash = await hashImportRequest(request);
		const token = await signPreviewToken(
			{ userId, reservationKey: input.generationReservationKey, importRequestHash: hash },
			"secret",
			100
		);
		await expect(
			verifyPreviewToken(
				`${token}x`,
				{ userId, reservationKey: input.generationReservationKey, importRequestHash: hash },
				"secret",
				101
			)
		).rejects.toThrow();
		await expect(
			verifyPreviewToken(
				token,
				{ userId: deckId, reservationKey: input.generationReservationKey, importRequestHash: hash },
				"secret",
				101
			)
		).rejects.toThrow();
		await expect(
			verifyPreviewToken(
				token,
				{ userId, reservationKey: "other", importRequestHash: hash },
				"secret",
				101
			)
		).rejects.toThrow();
		await expect(
			verifyPreviewToken(
				token,
				{
					userId,
					reservationKey: input.generationReservationKey,
					importRequestHash: "b".repeat(64),
				},
				"secret",
				101
			)
		).rejects.toThrow();
		await expect(
			verifyPreviewToken(
				token,
				{ userId, reservationKey: input.generationReservationKey, importRequestHash: hash },
				"secret",
				1_901
			)
		).rejects.toThrow();
	});

	it("INT-13 AC-06: every terminal path is guarded by finally release and S-11 24-hour cleanup remains intact", async () => {
		const route = await readFile(
			new URL("../../../../frontend/app/api/ai/card-drafts/generate/route.ts", import.meta.url),
			"utf8"
		);
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		expect(route).toContain("finally");
		expect(route).toContain("releaseGenerationSources");
		expect(migration).toContain("created_at + interval '24 hours'");
	});

	it("INT-14 AC-05/06: owner, scope, consumer, and recorded-path boundaries protect non-generation objects", async () => {
		expect(parseGenerationSourceUploadIds([sourceId])).toEqual([sourceId]);
		expect(parseGenerationSourceUploadIds([sourceId, sourceId])).toBeUndefined();
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260718000000_s12_ai_card_generation_source_release.sql",
				import.meta.url
			),
			"utf8"
		);
		for (const contract of [
			"owner_user_id=p_owner_user_id",
			"usage_scope='generation_source'",
			"jobs.state NOT IN ('succeeded','failed','undone')",
			"source_storage_path",
			"raw_storage_path",
		])
			expect(migration).toContain(contract);
	});

	it("INT-15 AC-08: rollback gates new mutations but preserves status and recovery release", async () => {
		const paths = [
			"(auth)/decks/[deckId]/ai/new/page.tsx",
			"api/ai/card-drafts/generate/route.ts",
			"api/ai/imports/preview/route.ts",
			"api/ai/imports/sources/prepare/route.ts",
			"api/ai/imports/sources/complete/route.ts",
			"api/ai/imports/commit/route.ts",
		];
		for (const path of paths)
			expect(
				await readFile(new URL(`../../../../frontend/app/${path}`, import.meta.url), "utf8")
			).toContain("isAiCardImportEnabled");
		expect(
			await readFile(
				new URL("../../../../frontend/app/api/ai/imports/status/route.ts", import.meta.url),
				"utf8"
			)
		).not.toContain("isAiCardImportEnabled");
		expect(
			await readFile(
				new URL(
					"../../../../frontend/app/api/ai/card-drafts/sources/release/route.ts",
					import.meta.url
				),
				"utf8"
			)
		).not.toContain("isAiCardImportEnabled");
	});

	it("INT-16: runtime privilege repairs remain least-privilege and RLS-backed", async () => {
		const [profile, authenticatedRuntime, serviceRuntime, illustrationRuntime] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260718000001_fix_users_profile_authenticated_grants.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260718000002_fix_runtime_authenticated_grants.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260718000003_fix_service_role_runtime_grants.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260718000004_restrict_authenticated_illustration_writes.sql",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(profile).toContain(
			"GRANT SELECT, INSERT, UPDATE ON TABLE public.users_profile TO authenticated"
		);
		for (const table of ["public.review_states", "public.illustrations", "public.study_sessions"])
			expect(authenticatedRuntime).toContain(table);
		expect(serviceRuntime).toContain("GRANT SELECT ON TABLE public.decks TO service_role");
		expect(illustrationRuntime).toContain(
			"REVOKE INSERT, UPDATE ON TABLE public.illustrations FROM authenticated"
		);
		expect(illustrationRuntime).toContain(
			"GRANT INSERT (owner_user_id, illustration_key) ON TABLE public.illustrations TO authenticated"
		);
		expect(illustrationRuntime).toContain("GRANT UPDATE (status, prompt)");
		expect(illustrationRuntime).not.toMatch(/GRANT INSERT \([^)]*storage_path/iu);
		for (const migration of [profile, authenticatedRuntime, serviceRuntime, illustrationRuntime]) {
			expect(migration).not.toMatch(/GRANT ALL|TO anon|deck_cards|cards TO authenticated/iu);
		}
	});

	it("INT-17: preview validates existing owner-private card keys before issuing a token", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260718000005_validate_preview_existing_duplicates.sql",
				import.meta.url
			),
			"utf8"
		);
		for (const contract of [
			"jsonb_array_elements(p_items)",
			"cards.owner_user_id=p_owner_user_id",
			"cards.visibility='private'",
			"DUPLICATE_EXISTING",
		])
			expect(migration).toContain(contract);
		expect(migration).toContain("TO service_role");
		expect(migration).toContain("FROM PUBLIC,anon,authenticated");
	});
});
