import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashImportRequest } from "../../../../frontend/src/lib/ai-import/canonical-request";
import { parseImportStatusResponse } from "../../../../frontend/src/lib/ai-import/async-contract";
import { signPreviewToken } from "../../../../frontend/src/lib/ai-import/preview-token";
import {
	createSourceImageCodec,
	createSourceImageCodecFactory,
} from "../../../../frontend/src/lib/ai-import/source-image-codec";
import { runCleanup } from "../../../../supabase/functions/_shared/ai-card-import/cleanup.ts";
import { SAFE_IMPORT_ERROR_CODES } from "../../../../supabase/functions/_shared/ai-card-import/contracts.ts";
import {
	normalizeIllustration,
	sanitizeSourceImage,
} from "../../../../supabase/functions/_shared/ai-card-import/image-codec.ts";
import { MAX_IMAGE_BYTES } from "../../../../supabase/functions/_shared/ai-card-import/image-validation.ts";
import { resolveProviderName } from "../../../../supabase/functions/_shared/ai-card-import/provider.ts";
import {
	createSafeLogger,
	type SafeLogEvent,
} from "../../../../supabase/functions/_shared/ai-card-import/logger.ts";
import { createOpenAiProvider } from "../../../../supabase/functions/_shared/ai-card-import/providers/openai.ts";
import { createGeminiProvider } from "../../../../supabase/functions/_shared/ai-card-import/providers/gemini.ts";
import { createStorageClient } from "../../../../supabase/functions/_shared/ai-card-import/storage.ts";
import { createSupabaseDatabase } from "../../../../supabase/functions/_shared/ai-card-import/supabase.ts";
import { processOneConcept } from "../../../../supabase/functions/_shared/ai-card-import/worker.ts";
import {
	BATCH_ID,
	CLAIM_TOKEN,
	createWorkerHarness,
	pngFixture,
	safeFailure,
} from "./helpers/s11-edge-testkit";
import { createS11DbClient } from "./helpers/s11-db-testkit";
import {
	assertOwnerProjectionBoundary,
	fetchServiceOwnerRows,
} from "./helpers/s11-real-e2e-data-boundary";

const OWNER_ID = "22000000-0000-4000-8000-000000000001";
const SERVICE_TEST_API_KEY = "service-role-fixture";
const SERVICE_TEST_AUTHORIZATION = `Bearer ${SERVICE_TEST_API_KEY}`;
const OWNER_TEST_AUTHORIZATION = "Bearer owner-fixture";
const ANON_TEST_API_KEY = "anon-fixture";

const SERVICE_SNAPSHOT_CREDENTIAL_CASES: ReadonlyArray<{
	readonly label: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly valid: boolean;
}> = [
	{
		label: "canonical pair",
		headers: {
			Authorization: SERVICE_TEST_AUTHORIZATION,
			apikey: SERVICE_TEST_API_KEY,
		},
		valid: true,
	},
	{
		label: "case-variant pair",
		headers: {
			AUTHORIZATION: SERVICE_TEST_AUTHORIZATION,
			APIKEY: SERVICE_TEST_API_KEY,
		},
		valid: true,
	},
	{
		label: "missing authorization",
		headers: { apikey: SERVICE_TEST_API_KEY },
		valid: false,
	},
	{
		label: "missing api key",
		headers: { Authorization: SERVICE_TEST_AUTHORIZATION },
		valid: false,
	},
	{
		label: "owner bearer with anonymous api key",
		headers: {
			Authorization: OWNER_TEST_AUTHORIZATION,
			apikey: ANON_TEST_API_KEY,
		},
		valid: false,
	},
	{
		label: "mismatched service credentials",
		headers: {
			Authorization: SERVICE_TEST_AUTHORIZATION,
			apikey: "different-service-fixture",
		},
		valid: false,
	},
];

function statusFixture(status: string, states: readonly string[]) {
	return {
		batchId: BATCH_ID,
		status,
		counts: {
			total: states.length,
			succeeded: states.filter((state) => state === "succeeded").length,
			failed: states.filter((state) => state === "failed").length,
		},
		items: states.map((itemStatus, index) => ({
			itemId: `22000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
			conceptId: `matrix-${index}`,
			status: itemStatus,
			cardId:
				itemStatus === "succeeded"
					? `22000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`
					: null,
			errorCode: itemStatus === "failed" ? "PROVIDER_PERMANENT_ERROR" : null,
		})),
	};
}

const routeBoundary = vi.hoisted(() => ({
	userId: "22000000-0000-4000-8000-000000000001",
	rpc: vi.fn(),
	from: vi.fn(),
	signedUpload: vi.fn(),
	upload: vi.fn(),
	remove: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: () => ({
		auth: { getUser: async () => ({ data: { user: { id: routeBoundary.userId } } }) },
	}),
	createServiceRoleClient: () => ({
		rpc: routeBoundary.rpc,
		from: routeBoundary.from,
		storage: {
			from: () => ({
				createSignedUploadUrl: routeBoundary.signedUpload,
				upload: routeBoundary.upload,
				remove: routeBoundary.remove,
			}),
		},
	}),
}));

beforeEach(() => {
	routeBoundary.userId = OWNER_ID;
	routeBoundary.rpc.mockReset();
	routeBoundary.from.mockReset();
	routeBoundary.signedUpload.mockReset();
	routeBoundary.upload.mockReset();
	routeBoundary.remove.mockReset();
	const query = {
		select: vi.fn(),
		eq: vi.fn(),
		maybeSingle: vi.fn(async () => ({ data: null, error: null })),
	};
	query.select.mockReturnValue(query);
	query.eq.mockReturnValue(query);
	routeBoundary.from.mockReturnValue(query);
	routeBoundary.upload.mockResolvedValue({ error: null });
	routeBoundary.remove.mockResolvedValue({ error: null });
});

describe("S-11 commit and queue integration", () => {
	it("IT-01 authenticated commit returns 202 queued through the real route within two seconds", async () => {
		const secret = "s11-route-preview-secret-with-at-least-32-bytes";
		process.env.AI_PREVIEW_HMAC_SECRET = secret;
		const request = {
			deck: { create: { name: "Async deck" } },
			items: [
				{
					clientItemId: "r-1",
					conceptId: "c-1",
					pattern: "R1",
					front: "漢字",
					back: "かんじ",
					tags: [],
					image: { mode: "none" },
				},
				{
					clientItemId: "w-1",
					conceptId: "c-1",
					pattern: "W1",
					front: "かんじ",
					back: "漢字",
					tags: [],
					image: { mode: "none" },
				},
			],
		};
		const importRequestHash = await hashImportRequest(request);
		const cardReservationKey = "reservation-route-1";
		const previewToken = await signPreviewToken(
			{ userId: OWNER_ID, reservationKey: cardReservationKey, importRequestHash },
			secret,
			Math.floor(Date.now() / 1000)
		);
		routeBoundary.rpc.mockResolvedValue({
			data: {
				batchId: BATCH_ID,
				status: "queued",
				statusUrl: `/api/ai/imports/status?batchId=${BATCH_ID}`,
			},
			error: null,
		});
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const started = performance.now();
		const response = await POST(
			new Request("http://local/api/ai/imports/commit", {
				method: "POST",
				body: JSON.stringify({
					idempotencyKey: "idem-1",
					importRequestHash,
					cardReservationKey,
					previewToken,
					request,
				}),
			})
		);
		expect(response.status).toBe(202);
		expect(performance.now() - started).toBeLessThan(2_000);
		expect(routeBoundary.rpc).toHaveBeenCalledTimes(1);
	});

	it.each([
		["resolved infrastructure error", { data: null, error: { message: "queue unavailable" } }],
		["PostgREST availability error", { data: null, error: { code: "PGRST001" } }],
	] as const)("MD-22 maps %s from commit RPC to exact 503 contract", async (_name, result) => {
		routeBoundary.rpc.mockResolvedValueOnce(result);
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(await validCommitRequest("md22-rpc"));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: { code: "SERVICE_UNAVAILABLE" } });
	});

	it("MD-22 maps a thrown commit RPC transport failure to exact 503 contract", async () => {
		routeBoundary.rpc.mockRejectedValueOnce(new TypeError("network unavailable"));
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(await validCommitRequest("md22-network"));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: { code: "SERVICE_UNAVAILABLE" } });
	});

	it.each([
		["P1008", 409, "CONFLICT"],
		["42501", 403, "UNAUTHORIZED"],
	] as const)(
		"MD-22 preserves commit SQL mapping %s as HTTP %i",
		async (code, expectedStatus, expectedCode) => {
			routeBoundary.rpc.mockResolvedValueOnce({ data: null, error: { code } });
			const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
			const response = await POST(await validCommitRequest(`md22-${code}`));
			expect(response.status).toBe(expectedStatus);
			expect(await response.json()).toEqual({ error: { code: expectedCode } });
		}
	);

	it("F4 RPC adapter preserves only the strict duplicate finalize business result", async () => {
		const responses: unknown[] = [
			{ status: "failed", errorCode: "DUPLICATE_EXISTING" },
			{ status: "failed", errorCode: "INTERNAL_ERROR" },
		];
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () => Response.json(responses.shift()),
		});
		const args = {
			jobId: "11000000-0000-4000-8000-000000000001",
			messageId: 1,
			claimToken: "11000000-0000-4000-8000-000000000003",
		};
		expect(await database.finalize(args)).toBe("failed_duplicate");
		await expect(database.finalize(args)).rejects.toThrow("RPC_CONTRACT_ERROR");
	});

	it("F4 migration reconciles duplicate response loss only for the terminal claim identity", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		expect(migration).toMatch(
			/job\.state='failed'[^;]+job\.error_code='DUPLICATE_EXISTING'[^;]+job\.terminal_message_id=p_message_id[^;]+job\.terminal_claim_token_hash=encode\(extensions\.digest[^;]+terminal_duplicate/u
		);
	});

	it("MD-22 preserves an invalid successful RPC payload as internal HTTP 500", async () => {
		routeBoundary.rpc.mockResolvedValueOnce({ data: { status: "queued" }, error: null });
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(await validCommitRequest("md22-contract"));
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
	});

	it("F-03 allowlists a strict commit DTO and never forwards extra RPC fields", async () => {
		routeBoundary.rpc.mockResolvedValueOnce({
			data: {
				batchId: BATCH_ID,
				status: "queued",
				statusUrl: `/api/ai/imports/status?batchId=${BATCH_ID}`,
				secretInternalField: "must-not-leak",
			},
			error: null,
		});
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(await validCommitRequest("f03-commit-extra"));
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			batchId: BATCH_ID,
			status: "queued",
			statusUrl: `/api/ai/imports/status?batchId=${BATCH_ID}`,
		});
	});

	it.each([
		[
			"wrong status",
			{
				batchId: BATCH_ID,
				status: "completed",
				statusUrl: `/api/ai/imports/status?batchId=${BATCH_ID}`,
			},
		],
		[
			"unsafe status URL",
			{ batchId: BATCH_ID, status: "queued", statusUrl: "https://attacker.invalid/status" },
		],
		[
			"mismatched status URL",
			{
				batchId: BATCH_ID,
				status: "queued",
				statusUrl: `/api/ai/imports/status?batchId=${crypto.randomUUID()}`,
			},
		],
	] as const)("F-03 rejects a malformed commit DTO: %s", async (_name, data) => {
		routeBoundary.rpc.mockResolvedValueOnce({ data, error: null });
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		expect((await POST(await validCommitRequest(`f03-${_name}`))).status).toBe(500);
	});

	it("F-04 maps malformed request JSON to safe validation HTTP 400", async () => {
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(
			new Request("http://local/api/ai/imports/commit", {
				method: "POST",
				body: "{",
			})
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR" } });
	});

	it("F-04 maps an invalid preview token to safe auth HTTP 401", async () => {
		const original = await validCommitRequest("f04-preview");
		const body = (await original.json()) as Record<string, unknown>;
		body.previewToken = `${String(body.previewToken)}tampered`;
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		const response = await POST(
			new Request(original.url, { method: "POST", body: JSON.stringify(body) })
		);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
		expect(routeBoundary.rpc).not.toHaveBeenCalled();
	});

	it("IT-02 service RPC adapter sends a bearer credential and the 300-second queue boundary", async () => {
		const requests: Request[] = [];
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async (input, init) => {
				requests.push(new Request(input, init));
				return Response.json([
					{ message_id: 7, message: { version: 1, jobId: BATCH_ID, batchId: BATCH_ID } },
				]);
			},
		});
		expect(await database.readOne(300)).toMatchObject({ messageId: 7 });
		expect(requests[0].headers.get("authorization")).toBe("Bearer service-fixture");
		expect(await requests[0].json()).toEqual({ p_visibility_seconds: 300, p_quantity: 1 });
	});

	it("IT-03 reconnect status uses the authenticated owner instead of a query-supplied owner", async () => {
		routeBoundary.rpc.mockResolvedValue({
			data: {
				batchId: BATCH_ID,
				status: "queued",
				counts: { total: 2, succeeded: 0, failed: 0 },
				items: [
					{
						itemId: "22000000-0000-4000-8000-000000000011",
						conceptId: "c-1",
						status: "queued",
						cardId: null,
						errorCode: null,
					},
					{
						itemId: "22000000-0000-4000-8000-000000000012",
						conceptId: "c-1",
						status: "queued",
						cardId: null,
						errorCode: null,
					},
				],
			},
			error: null,
		});
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		const response = await GET(
			new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}&ownerId=attacker`)
		);
		expect(response.status).toBe(200);
		expect(routeBoundary.rpc).toHaveBeenCalledWith(
			"get_ai_import_status",
			expect.objectContaining({ p_actor_user_id: OWNER_ID })
		);
	});

	it("F-03 strict-parses and allowlists the full status DTO", async () => {
		const cardId = "22000000-0000-4000-8000-000000000099";
		routeBoundary.rpc.mockResolvedValueOnce({
			data: {
				batchId: BATCH_ID,
				status: "completed",
				counts: { total: 1, succeeded: 1, failed: 0, hidden: 99 },
				items: [
					{
						itemId: "22000000-0000-4000-8000-000000000098",
						conceptId: "concept-safe",
						status: "succeeded",
						cardId,
						internalPrompt: "must-not-leak",
					},
				],
				storagePath: "must-not-leak",
			},
			error: null,
		});
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		const response = await GET(
			new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`)
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			batchId: BATCH_ID,
			status: "completed",
			counts: { total: 1, succeeded: 1, failed: 0 },
			items: [
				{
					itemId: "22000000-0000-4000-8000-000000000098",
					conceptId: "concept-safe",
					status: "succeeded",
					cardId,
				},
			],
		});
	});

	it("F-14 accepts a terminal DUPLICATE_EXISTING status result through the strict DTO", async () => {
		routeBoundary.rpc.mockResolvedValueOnce({
			data: {
				batchId: BATCH_ID,
				status: "failed",
				counts: { total: 1, succeeded: 0, failed: 1 },
				items: [
					{
						itemId: "22000000-0000-4000-8000-000000000097",
						conceptId: "duplicate-existing",
						status: "failed",
						cardId: null,
						errorCode: "DUPLICATE_EXISTING",
					},
				],
			},
			error: null,
		});
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		const response = await GET(
			new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`)
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: "failed",
			items: [{ status: "failed", errorCode: "DUPLICATE_EXISTING" }],
		});
	});

	it.each([
		[
			"invalid batch status",
			{
				batchId: BATCH_ID,
				status: "done",
				counts: { total: 0, succeeded: 0, failed: 0 },
				items: [],
			},
		],
		[
			"invalid counts",
			{
				batchId: BATCH_ID,
				status: "queued",
				counts: { total: -1, succeeded: 0, failed: 0 },
				items: [],
			},
		],
		[
			"invalid item status",
			{
				batchId: BATCH_ID,
				status: "processing",
				counts: { total: 1, succeeded: 0, failed: 0 },
				items: [{ itemId: crypto.randomUUID(), conceptId: "c", status: "done" }],
			},
		],
		[
			"invalid card ID",
			{
				batchId: BATCH_ID,
				status: "completed",
				counts: { total: 1, succeeded: 1, failed: 0 },
				items: [
					{
						itemId: crypto.randomUUID(),
						conceptId: "c",
						status: "succeeded",
						cardId: "not-a-uuid",
					},
				],
			},
		],
		[
			"unsafe error code",
			{
				batchId: BATCH_ID,
				status: "failed",
				counts: { total: 1, succeeded: 0, failed: 1 },
				items: [
					{
						itemId: crypto.randomUUID(),
						conceptId: "c",
						status: "failed",
						errorCode: "RAW_PROVIDER_BODY",
					},
				],
			},
		],
	] as const)("F-03 rejects malformed status DTO: %s", async (_name, data) => {
		routeBoundary.rpc.mockResolvedValueOnce({ data, error: null });
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(502);
	});

	it.each([
		["queued all undone", "queued", ["undone", "undone"]],
		["processing mixed undone", "processing", ["processing", "undone"]],
		["undone mixed succeeded", "undone", ["undone", "succeeded"]],
		["completed mixed undone", "completed", ["succeeded", "undone"]],
		["partial mixed undone", "partial", ["succeeded", "failed", "undone"]],
		["failed mixed undone", "failed", ["failed", "undone"]],
	] as const)("R19-F3 rejects contradictory status matrix: %s", async (_name, status, states) => {
		const data = statusFixture(status, states);
		expect(parseImportStatusResponse(data)).toBeUndefined();
		routeBoundary.rpc.mockResolvedValueOnce({ data, error: null });
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(502);
	});

	it.each([
		["queued", ["queued", "succeeded", "failed"]],
		["processing", ["processing", "queued", "succeeded", "failed"]],
		["completed", ["succeeded", "succeeded"]],
		["partial", ["succeeded", "failed"]],
		["failed", ["failed", "failed"]],
		["undone", ["undone", "undone"]],
	] as const)("R19-F3 accepts reachable status matrix: %s", async (status, states) => {
		const data = statusFixture(status, states);
		expect(parseImportStatusResponse(data)).toBeDefined();
		routeBoundary.rpc.mockResolvedValueOnce({ data, error: null });
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(200);
	});

	it("IT-04 conditionally claims queued work before finalizing", async () => {
		const harness = createWorkerHarness();
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state.finalizeCalls).toBe(1);
	});

	it("IT-05 sequential terminal duplicate is ACKed without a second finalize", async () => {
		const harness = createWorkerHarness();
		await processOneConcept(harness.dependencies);
		expect(await processOneConcept(harness.dependencies)).toBe("acked");
		expect(harness.state).toMatchObject({ finalizeCalls: 1, ackCalls: 1 });
	});

	it("IT-06 an active parallel claim starts no duplicate side effect", async () => {
		const harness = createWorkerHarness();
		harness.state.jobState = "processing";
		harness.state.claimExpiresAt = Date.parse("2026-07-15T00:04:59Z");
		expect(await processOneConcept(harness.dependencies)).toBe("busy");
		expect(harness.state.finalizeCalls).toBe(0);
	});

	it("IT-07 a claim at the 300 second boundary can replace the stale claim", async () => {
		const harness = createWorkerHarness();
		harness.state.jobState = "processing";
		harness.state.claimExpiresAt = Date.parse("2026-07-15T00:05:00Z");
		harness.setNow(Date.parse("2026-07-15T00:05:00Z"));
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
	});

	it("IT-08 a stale replacement message is ACKed without provider or card work", async () => {
		const harness = createWorkerHarness({ imageMode: "ai" });
		harness.state.currentMessageId = 2;
		harness.setDelivery(1);
		expect(await processOneConcept(harness.dependencies)).toBe("acked");
		expect(harness.state.providerCalls).toBe(0);
	});

	it("IT-09 invalid queue payload is treated as inert poison and ACKed", async () => {
		const harness = createWorkerHarness();
		harness.setDelivery(1, { raw: "forbidden" });
		expect(await processOneConcept(harness.dependencies)).toBe("acked");
	});

	it("IT-10 queue adapter rejects malformed RPC payloads before claim side effects", async () => {
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () => Response.json([{ message_id: "not-a-number", message: {} }]),
		});
		await expect(database.readOne(300)).rejects.toThrow("RPC_CONTRACT_ERROR");
	});

	it("R11-R2-F2 prepare route accepts exactly five source entries", async () => {
		routeBoundary.rpc.mockImplementation(
			async (_name: string, args: Readonly<Record<string, unknown>>) => ({
				data: {
					uploadId: `upload-${String(args.p_upload_key)}`,
					path: `${OWNER_ID}/${String(args.p_upload_key)}/raw`,
				},
				error: null,
			})
		);
		routeBoundary.signedUpload.mockResolvedValue({
			data: { token: "signed-upload-token" },
			error: null,
		});
		const { POST } = await import(
			"../../../../frontend/app/api/ai/imports/sources/prepare/route"
		);
		const response = await POST(sourcePrepareRequest(5));
		expect(response.status).toBe(201);
		expect((await response.json()).uploads).toHaveLength(5);
		expect(routeBoundary.rpc).toHaveBeenCalledTimes(5);
		expect(routeBoundary.signedUpload).toHaveBeenCalledTimes(5);
	});

	it("R11-R2-F2 prepare route rejects six source entries before side effects", async () => {
		const { POST } = await import(
			"../../../../frontend/app/api/ai/imports/sources/prepare/route"
		);
		const response = await POST(sourcePrepareRequest(6));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR" } });
		expect(routeBoundary.rpc).not.toHaveBeenCalled();
		expect(routeBoundary.signedUpload).not.toHaveBeenCalled();
	});

	it.each(["prepare", "complete"] as const)(
		"R12-F2 %s route maps malformed JSON to a 400 validation contract",
		async (endpoint) => {
			const prepareRoute = await import(
				"../../../../frontend/app/api/ai/imports/sources/prepare/route"
			);
			const completeRoute = await import(
				"../../../../frontend/app/api/ai/imports/sources/complete/route"
			);
			const { POST } = endpoint === "prepare" ? prepareRoute : completeRoute;
			const response = await POST(
				new Request(`http://local/api/ai/imports/sources/${endpoint}`, {
					method: "POST",
					body: "{",
				})
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR" } });
			expect(routeBoundary.rpc).not.toHaveBeenCalled();
		}
	);

	it.each([
		["batchId=not-a-uuid", "invalid batch UUID"],
		[`idempotencyKey=${"a".repeat(129)}`, "oversized idempotency key"],
		["idempotencyKey=", "empty idempotency key"],
	] as const)("R12-F2 status rejects %s (%s) before RPC", async (query, _case) => {
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		const response = await GET(new Request(`http://local/api/ai/imports/status?${query}`));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR" } });
		expect(routeBoundary.rpc).not.toHaveBeenCalled();
	});

	it("R12-F1 cleanup only accepts prepared rows bound to the exact source write intent", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.mark_ai_upload_cleanup");
		const body = migration.slice(start, migration.indexOf("$$;", start));
		expect(body).toContain("status='prepared'");
		expect(body).toContain("source_write_intent_path=p_source_path");
		expect(body).not.toMatch(/status IN \('prepared','ready','consumed'/u);
		const gate = await readFile(new URL("./s11-local-real-integration-gate.ts", import.meta.url), "utf8");
		expect(gate).toContain("source-complete-winner-not-downgraded");
	});

	it("R12-F3 release migrations use bounded expand/backfill/validate stages", async () => {
		const [expand, validate, operations] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/migrations/20260715000002_s11_ai_card_async_validate.sql", import.meta.url), "utf8"),
			readFile(new URL("../operations.md", import.meta.url), "utf8"),
		]);
		expect(expand).toContain("SET lock_timeout = '5s'");
		expect(expand).toContain("NOT VALID");
		expect(expand).toContain("backfill_ai_uploads_s11");
		expect(expand).not.toMatch(/UPDATE public\.ai_uploads\s+SET source_storage_path/u);
		expect(validate).toContain("VALIDATE CONSTRAINT ai_uploads_s11_status_check");
		expect(operations).toContain("forward recovery");
		expect(operations).toContain("compatibility period");
	});

	it("R12-F4 resource-only gate rejects blank configured and presented secrets", async () => {
		const [source, config] = await Promise.all([
			readFile(new URL("../../../../supabase/functions/ai-card-import-resource-gate/index.ts", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/config.toml", import.meta.url), "utf8"),
		]);
		expect(source).toContain('Deno.env.get("AI_CARD_WORKER_SECRET")');
		expect(source).toContain('request.headers.get("x-ai-worker-secret")');
		expect(source).toMatch(/secret\.trim\(\)\.length === 0/u);
		expect(source).toContain("presentedSecret !== secret");
		expect(config).toContain("Resource-only local quality gate");
		expect(config).toMatch(/\[functions\.ai-card-import-resource-gate\][\s\S]*verify_jwt = true/u);
	});

	it("R13-F6 complete rejects a non-UUID uploadId before service-role DB or Storage", async () => {
		const { POST } = await import(
			"../../../../frontend/app/api/ai/imports/sources/complete/route"
		);
		const response = await POST(
			new Request("http://local/api/ai/imports/sources/complete", {
				method: "POST",
				body: JSON.stringify({ uploadId: "not-a-uuid" }),
			})
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: "VALIDATION_ERROR" } });
		expect(routeBoundary.from).not.toHaveBeenCalled();
		expect(routeBoundary.rpc).not.toHaveBeenCalled();
		expect(routeBoundary.upload).not.toHaveBeenCalled();
		expect(routeBoundary.remove).not.toHaveBeenCalled();
	});

	it("R14-F1 complete canonicalizes an uppercase UUID before every downstream boundary", async () => {
		const uploadId = "A0B1C2D3-E4F5-4678-9ABC-DEF012345678";
		const canonicalId = uploadId.toLowerCase();
		const rawPath = `${OWNER_ID}/${canonicalId}/raw`;
		const sourcePath = `${OWNER_ID}/${canonicalId}/source`;
		const png = Uint8Array.from(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64"
			)
		);
		const query = {
			select: vi.fn(),
			eq: vi.fn(),
			maybeSingle: vi.fn(),
		};
		query.select.mockReturnValue(query);
		query.eq.mockReturnValue(query);
		query.maybeSingle.mockResolvedValue({
			data: {
				id: canonicalId,
				owner_user_id: OWNER_ID,
				status: "prepared",
				raw_storage_path: rawPath,
				mime_type: "image/png",
				byte_size: png.byteLength,
			},
			error: null,
		});
		routeBoundary.from.mockReturnValue(query);
		routeBoundary.rpc.mockImplementation(async (name: string) => {
			if (name === "mark_ai_source_ready")
				return { data: null, error: { message: "response lost" } };
			if (name === "reconcile_ai_source_ready")
				return {
					data: { outcome: "ready", uploadId: canonicalId, status: "ready", path: sourcePath },
					error: null,
				};
			return { data: null, error: null };
		});
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "uppercase-test-anon");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "uppercase-test-service");
		const fetchMock = vi.fn(async () => new Response(png, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const { POST } = await import("../../../../frontend/app/api/ai/imports/sources/complete/route");
			const response = await POST(
				new Request("http://local/api/ai/imports/sources/complete", {
					method: "POST",
					body: JSON.stringify({ uploadId }),
				})
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ uploadId: canonicalId, status: "ready", path: sourcePath });
			expect(query.eq).toHaveBeenCalledWith("id", canonicalId);
			expect(routeBoundary.upload).toHaveBeenCalledWith(
				sourcePath,
				expect.any(Uint8Array),
				expect.objectContaining({ upsert: false })
			);
			expect(routeBoundary.remove).toHaveBeenCalledWith([rawPath]);
			expect(fetchMock).toHaveBeenCalledWith(
				`http://127.0.0.1:54321/storage/v1/object/ai-card-sources/${rawPath}`,
				expect.any(Object)
			);
			const successCalls = routeBoundary.rpc.mock.calls;
			expect(successCalls.map(([name]) => name)).toEqual([
				"mark_ai_source_write_intent",
				"mark_ai_source_ready",
				"reconcile_ai_source_ready",
				"mark_ai_source_raw_deleted",
			]);
			expect(successCalls[0]?.[1]).toEqual({
				p_owner_user_id: OWNER_ID,
				p_upload_id: canonicalId,
				p_source_path: sourcePath,
			});
			expect(successCalls[1]?.[1]).toEqual({
				p_owner_user_id: OWNER_ID,
				p_upload_id: canonicalId,
				p_detected_mime: "image/png",
				p_actual_byte_size: expect.any(Number),
				p_width: 1,
				p_height: 1,
				p_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
			});
			expect(successCalls[2]?.[1]).toEqual(successCalls[1]?.[1]);
			expect(successCalls[3]?.[1]).toEqual({
				p_owner_user_id: OWNER_ID,
				p_upload_id: canonicalId,
			});
			expect(JSON.stringify(successCalls)).not.toContain(uploadId);

			routeBoundary.rpc.mockClear();
			routeBoundary.rpc.mockImplementation(async (name: string) =>
				name === "mark_ai_source_write_intent"
					? { data: null, error: { message: "intent failed" } }
					: { data: null, error: null }
			);
			const cleanupResponse = await POST(
				new Request("http://local/api/ai/imports/sources/complete", {
					method: "POST",
					body: JSON.stringify({ uploadId }),
				})
			);
			expect(cleanupResponse.status).toBe(503);
			expect(routeBoundary.rpc.mock.calls).toEqual([
				[
					"mark_ai_source_write_intent",
					{ p_owner_user_id: OWNER_ID, p_upload_id: canonicalId, p_source_path: sourcePath },
				],
				[
					"mark_ai_upload_cleanup",
					{ p_owner_user_id: OWNER_ID, p_upload_id: canonicalId, p_source_path: sourcePath },
				],
			]);
			expect(JSON.stringify(routeBoundary.rpc.mock.calls)).not.toContain(uploadId);
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});

	it("R13-F1 reconciles a committed mark-ready response loss before any Storage delete", async () => {
		const [route, migration] = await Promise.all([
			readFile(
				new URL(
					"../../../../frontend/app/api/ai/imports/sources/complete/route.ts",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(route).toMatch(/service\.rpc\(\s*"reconcile_ai_source_ready"/u);
		expect(route).toContain('reconciliation.outcome === "ready"');
		expect(route).toContain('reconciliation.outcome === "uncommitted"');
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.reconcile_ai_source_ready");
		expect(migration).toContain("source_write_intent_path IS NULL");
		expect(migration).toContain("sha256=p_digest");
	});

	it.skipIf(!process.env.S11_FRESH_DATABASE_URL)(
		"R13-F1 committed response loss keeps the normalized source through the actual route and DB",
		async () => {
			const databaseUrl = process.env.S11_FRESH_DATABASE_URL;
			if (!databaseUrl) return;
			const db = createS11DbClient(databaseUrl);
			const uploadId = crypto.randomUUID();
			const rawPath = `${OWNER_ID}/${uploadId}/raw`;
			const sourcePath = `${OWNER_ID}/${uploadId}/source`;
			const png = Uint8Array.from(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
					"base64"
				)
			);
			await db.execute(`
				INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
				VALUES('${OWNER_ID}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','r13-route@example.local','not-for-login',now(),'{}','{}',now(),now())
				ON CONFLICT(id) DO NOTHING;
				INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,raw_storage_path,raw_storage_bucket,delete_due_at)
				VALUES('${uploadId}','${OWNER_ID}','r13-response-loss','card_illustration','${rawPath}','image/png',${png.byteLength},'prepared','${rawPath}','ai-card-sources',clock_timestamp()+interval '1 hour');
			`);
			const query = {
				select: vi.fn(),
				eq: vi.fn(),
				maybeSingle: vi.fn(async () => {
					const [row] = await db.query<Record<string, unknown>>(`
						SELECT id::text,owner_user_id::text,status,raw_storage_path,mime_type,byte_size::int
						FROM public.ai_uploads WHERE id='${uploadId}'
					`);
					return { data: row ?? null, error: null };
				}),
			};
			query.select.mockReturnValue(query);
			query.eq.mockReturnValue(query);
			routeBoundary.from.mockReturnValue(query);
			let committedReadyResponseLost = false;
			routeBoundary.rpc.mockImplementation(
				async (name: string, args: Readonly<Record<string, unknown>>) => {
					try {
						if (name === "mark_ai_source_write_intent") {
							await db.query(`SELECT public.mark_ai_source_write_intent('${OWNER_ID}','${uploadId}','${sourcePath}')`, { actor: { kind: "service", role: "service_role", userId: null } });
							return { data: null, error: null };
						}
						if (name === "mark_ai_source_ready" || name === "reconcile_ai_source_ready") {
							const functionName = name;
							const [row] = await db.query<{ result: unknown }>(`
								SELECT public.${functionName}('${OWNER_ID}','${uploadId}',
									'${String(args.p_detected_mime)}',${Number(args.p_actual_byte_size)},
									${Number(args.p_width)},${Number(args.p_height)},'${String(args.p_digest)}') result
							`, { actor: { kind: "service", role: "service_role", userId: null } });
							if (name === "mark_ai_source_ready" && !committedReadyResponseLost) {
								committedReadyResponseLost = true;
								return { data: null, error: { message: "response lost" } };
							}
							return { data: row?.result ?? null, error: null };
						}
						if (name === "mark_ai_source_raw_deleted") {
							await db.query(`SELECT public.mark_ai_source_raw_deleted('${OWNER_ID}','${uploadId}')`, { actor: { kind: "service", role: "service_role", userId: null } });
							return { data: null, error: null };
						}
						return { data: null, error: { message: "unexpected RPC" } };
					} catch (error) {
						return { data: null, error };
					}
				}
			);
			routeBoundary.upload.mockResolvedValue({ error: null });
			routeBoundary.remove.mockResolvedValue({ error: null });
			vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
			vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "r13-test-anon-key");
			vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "r13-test-service-key");
			vi.stubGlobal("fetch", async () => new Response(png, { status: 200 }));
			try {
				const { POST } = await import(
					"../../../../frontend/app/api/ai/imports/sources/complete/route"
				);
				const response = await POST(
					new Request("http://local/api/ai/imports/sources/complete", {
						method: "POST",
						body: JSON.stringify({ uploadId }),
					})
				);
				const responseBody = await response.json();
				const persisted = await db.query<Record<string, unknown>>(`
					SELECT status,storage_path,source_storage_path,source_storage_bucket,
						source_write_intent_path,detected_mime_type,byte_size,width,height,sha256
					FROM public.ai_uploads WHERE id='${uploadId}'
				`);
				expect(response.status, JSON.stringify({ responseBody, persisted })).toBe(200);
				expect(responseBody).toEqual({ uploadId, status: "ready", path: sourcePath });
				expect(routeBoundary.remove).toHaveBeenCalledTimes(1);
				expect(routeBoundary.remove).toHaveBeenCalledWith([rawPath]);
				expect(await db.query<{ status: string; path: string }>(`
					SELECT status,source_storage_path path FROM public.ai_uploads WHERE id='${uploadId}'
				`)).toEqual([{ status: "ready", path: sourcePath }]);
			} finally {
				vi.unstubAllGlobals();
				vi.unstubAllEnvs();
				await db.execute(`DELETE FROM public.ai_uploads WHERE id='${uploadId}'; DELETE FROM auth.users WHERE id='${OWNER_ID}'`);
			}
		}
	);

	it("R13-F2/F3 expand is autocommit-resumable and denies PUBLIC function execution first", async () => {
		const [migration, jobs] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./helpers/s11-db-jobs.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toMatch(/ALTER DEFAULT PRIVILEGES[\s\S]+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/u);
		expect(migration).toContain("after_expand_tables");
		expect(migration).toContain("after_runtime_functions");
		expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_import_concept_jobs/u);
		expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_ai_source_ready/u);
		expect(jobs).not.toContain("`BEGIN;\\nSET LOCAL app.s11_failpoint");
		expect(jobs).toContain("supabase_migrations.schema_migrations");
		expect(jobs).toContain("after_expand_tables");
		expect(jobs).toContain("after_runtime_functions");
	});

	it("R14-F2 failure migration uses psql stdin file autocommit and verifies each durable boundary", async () => {
		const [jobs, toolkit] = await Promise.all([
			readFile(new URL("./helpers/s11-db-jobs.ts", import.meta.url), "utf8"),
			readFile(
				new URL(
					"../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(jobs).toContain("runS10PsqlAutocommitScript");
		expect(jobs).toContain("assertAutocommitFailureState(databaseUrl, failpoint, baselineNonServiceAcl)");
		expect(jobs).toContain("procedures.prosecdef");
		expect(jobs).toContain("aclexplode(COALESCE(procedures.proacl");
		expect(jobs).toContain("roles.rolname IN ('anon','authenticated')");
		expect(jobs).toContain("roles.rolname='service_role'");
		expect(jobs).toContain("after_expand_tables");
		expect(jobs).toContain("after_runtime_functions");
		expect(jobs).toContain("before_core_commit");
		expect(toolkit).toMatch(/psql[\s\S]+"-f",\s*"-"/u);
	});

	it("R14-F3 commit reads the preview secret only through the typed environment layer", async () => {
		const [route, environment] = await Promise.all([
			readFile(
				new URL("../../../../frontend/app/api/ai/imports/commit/route.ts", import.meta.url),
				"utf8"
			),
			readFile(new URL("../../../../frontend/src/lib/env.ts", import.meta.url), "utf8"),
		]);
		expect(route).not.toContain("process.env.AI_PREVIEW_HMAC_SECRET");
		expect(route).toContain("getAiPreviewHmacSecret()");
		expect(environment).toContain('"AI_PREVIEW_HMAC_SECRET"');
		expect(environment).toContain("getAiPreviewHmacSecret");
		const { POST } = await import("../../../../frontend/app/api/ai/imports/commit/route");
		for (const [suffix, configuredSecret] of [
			["missing-secret", undefined],
			["blank-secret", "   "],
		] as const) {
			const request = await validCommitRequest(suffix);
			if (configuredSecret === undefined) delete process.env.AI_PREVIEW_HMAC_SECRET;
			else process.env.AI_PREVIEW_HMAC_SECRET = configuredSecret;
			const response = await POST(request);
			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
		}
		expect(routeBoundary.rpc).not.toHaveBeenCalled();
	});

	it("R15-F1 swaps legacy and S-11 upload constraints in one atomic ALTER boundary", async () => {
		const [migration, jobs] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./helpers/s11-db-jobs.ts", import.meta.url), "utf8"),
		]);
		const swap = migration.slice(
			migration.indexOf("ALTER TABLE public.ai_uploads\n  DROP CONSTRAINT IF EXISTS ai_uploads_status_check"),
			migration.indexOf("CREATE TABLE IF NOT EXISTS public.ai_import_concept_jobs")
		);
		expect(swap).toContain("ADD CONSTRAINT ai_uploads_s11_status_check");
		expect(swap).toContain("ADD CONSTRAINT ai_uploads_s11_status_time_check");
		expect(migration).toContain("before_constraint_swap");
		expect(jobs).toContain('"before_constraint_swap"');
		expect(jobs).toContain("ai_uploads_status_check");
		expect(jobs).toContain("ai_uploads_s11_status_check");
		expect(jobs).toContain("atomic_swap_error");
	});

	it("R19-F1 installs owner-safe column projections without exposing fencing tokens", async () => {
		const [core, hardening, jobs] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/migrations/20260716000000_s11_owner_safe_select.sql", import.meta.url), "utf8"),
			readFile(new URL("./helpers/s11-db-jobs.ts", import.meta.url), "utf8"),
		]);
		for (const sql of [core, hardening]) {
			expect(sql).toContain("REVOKE SELECT ON public.ai_uploads");
			expect(sql).toContain("GRANT SELECT (id,owner_user_id,upload_key,purpose,mime_type,byte_size,status");
			expect(sql).toContain("GRANT SELECT (id,owner_user_id,batch_id,concept_id,state,attempt");
			expect(sql).toContain("GRANT SELECT ON public.ai_uploads,public.ai_import_concept_jobs");
			expect(sql).not.toMatch(/GRANT SELECT ON public\.ai_import_concept_jobs[^;]+TO authenticated/u);
		}
		expect(hardening).toContain("cleanup_claim_token");
		expect(hardening).toContain("raw_cleanup_claim_token");
		expect(hardening).toContain("terminal_claim_token_hash");
		expect(jobs).toContain("OWNER_SAFE_SELECT_MIGRATION");
		expect(jobs).toContain("assertOwnerSafeSelectMatrix");
	});

	it("R23-F0 fixed release SSOT separates RC1 work from hosted merge acceptance", async () => {
		const [meta, plan, traceability, operations, releaseContract, releaseEvidence] = await Promise.all([
			readFile(new URL("../meta.json", import.meta.url), "utf8"),
			readFile(new URL("../plan.md", import.meta.url), "utf8"),
			readFile(new URL("../traceability.md", import.meta.url), "utf8"),
			readFile(new URL("../operations.md", import.meta.url), "utf8"),
			readFile(new URL("../../../../.codex/release-contract.json", import.meta.url), "utf8"),
			readFile(new URL("../../../../.codex/release-evidence.json", import.meta.url), "utf8"),
		]);
		const parsedMeta = JSON.parse(meta) as Record<string, unknown>;
		expect(parsedMeta.remediation_cycle).toBe(19);
		expect(parsedMeta.ssot_version).toBe("2.0.17");
		expect(parsedMeta.verification_state).toBe("rc1_local_pending_hosted_7_not_run_merge_blocked");
		expect(meta).not.toMatch(/ready_for_commit|zero_findings|approved/u);
		expect(plan).toContain("version: 2.0.17");
		expect(traceability).toContain("version: 2.0.17");
		expect(plan).toContain("[x] **T6-01L: local boundary E2E");
		expect(plan).toContain("[ ] **T6-01H: hosted full-system E2E");
		expect(operations).toContain("Current cycle-19 verification state: `RC1 local evidence pending; hosted 7 not_run; merge blocked`");
		expect(traceability).not.toMatch(/\bcurrent\s+R12\b/iu);
		expect(JSON.parse(releaseContract)).toMatchObject({ issue: 12, story: "S-11" });
		expect(JSON.parse(releaseEvidence)).toMatchObject({ state: "pending_rc1" });
	});

	it("R13-F3 schedule migration denies PUBLIC before creating SECURITY DEFINER functions", async () => {
		const schedule = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000001_s11_ai_card_async_schedule_controls.sql",
				import.meta.url
			),
			"utf8"
		);
		const deny = schedule.indexOf("ALTER DEFAULT PRIVILEGES");
		const firstFunction = schedule.indexOf("CREATE OR REPLACE FUNCTION");
		expect(deny).toBeGreaterThan(-1);
		expect(deny).toBeLessThan(firstFunction);
	});

	it("R13-F4 validates canonical HTTPS project origin and nonblank secret in activation and invoke", async () => {
		const [core, schedule] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000001_s11_ai_card_async_schedule_controls.sql",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(core).toContain("CREATE OR REPLACE FUNCTION public.ai_s11_validate_schedule_config");
		expect(core).toContain("^https://");
		expect(core).toContain("btrim(p_worker_secret)");
		expect(schedule.match(/ai_s11_validate_schedule_config/gu)).toHaveLength(2);
	});

	it("R11-F1 preserves the legitimate empty Queue response as idle through the real handler path", async () => {
		const result = await runQueueRpcThroughWorkerHandler([]);
		expect(result.response.status).toBe(200);
		expect(await result.response.json()).toEqual({ outcome: "idle" });
		expect(result.logs).toEqual([]);
	});

	it.each([
		["null", null, "unsafe-null-queue-detail"],
		["primitive", "unsafe-primitive-queue-detail", "unsafe-primitive-queue-detail"],
		[
			"record instead of result array",
			{ message_id: 1, message: "unsafe-record-queue-detail" },
			"unsafe-record-queue-detail",
		],
		["non-record array row", ["unsafe-array-queue-detail"], "unsafe-array-queue-detail"],
	] as const)(
		"R11-F1 rejects malformed %s Queue RPC output at the real worker handler boundary",
		async (_case, queueResponse, unsafeMarker) => {
			const result = await runQueueRpcThroughWorkerHandler(queueResponse);
			expect(result.response.status).toBe(500);
			expect(await result.response.json()).toEqual({ errorCode: "INTERNAL_ERROR" });
			expect(result.logs.map((line) => JSON.parse(line))).toEqual([
				{ event: "worker_recoverable", errorCode: "INTERNAL_ERROR" },
			]);
			expect(result.logs.join("\n")).not.toContain(unsafeMarker);
		}
	);
});

describe("S-11 retry, provider, and storage integration", () => {
	it.each([
		["missing", undefined, undefined, 500],
		["blank", "  \t", "anything", 500],
		["missing header", "configured-secret", undefined, 401],
		["mismatch", "configured-secret", "wrong-secret", 401],
		["match", " configured-secret ", "configured-secret", 200],
	] as const)(
		"F1 actual worker handler enforces the %s secret boundary",
		async (_case, configuredSecret, requestSecret, expectedStatus) => {
			const { handleWorkerRequest } = await import(
				"../../../../supabase/functions/_shared/ai-card-import/worker-entrypoint.ts"
			);
			const logs: SafeLogEvent[] = [];
			let executions = 0;
			const headers = new Headers();
			if (requestSecret !== undefined) headers.set("x-ai-worker-secret", requestSecret);
			const response = await handleWorkerRequest(
				new Request("http://worker.local", { method: "POST", headers }),
				{
					workerSecret: () => configuredSecret,
					execute: async () => {
						executions += 1;
						return "idle";
					},
					log: (event) => logs.push(event),
				}
			);
			expect(response.status).toBe(expectedStatus);
			if (expectedStatus === 500) {
				expect(await response.json()).toEqual({ errorCode: "INTERNAL_ERROR" });
				expect(logs).toEqual([
					expect.objectContaining({ event: "worker_recoverable", errorCode: "INTERNAL_ERROR" }),
				]);
			} else {
				expect(logs).toEqual([]);
			}
			expect(executions).toBe(expectedStatus === 200 ? 1 : 0);
		}
	);

	it.each(["secret-read", "execute"] as const)(
		"F1 actual handler contains adjacent %s faults and correlates the safe event",
		async (fault) => {
			const { handleWorkerRequest } = await import(
				"../../../../supabase/functions/_shared/ai-card-import/worker-entrypoint.ts"
			);
			const invocationId = "33000000-0000-4000-8000-000000000001";
			const logs: SafeLogEvent[] = [];
			const response = await handleWorkerRequest(
				new Request("http://worker.local", {
					method: "POST",
					headers: {
						"x-ai-worker-secret": "configured-secret",
						"x-ai-worker-invocation-id": invocationId,
					},
				}),
				{
					workerSecret: () => {
						if (fault === "secret-read") throw new Error("secret read fault");
						return "configured-secret";
					},
					execute: async () => {
						throw new Error("setup fault");
					},
					log: (event) => logs.push(event),
				}
			);
			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({
				errorCode: "INTERNAL_ERROR",
				invocationId,
			});
			expect(logs).toEqual([
				expect.objectContaining({
					event: "worker_recoverable",
					errorCode: "INTERNAL_ERROR",
					invocationId,
				}),
			]);
		}
	);

	it.each([
		["missing", undefined, undefined, 500],
		["blank", "  \t", "", 500],
		["missing header", "cleanup-secret", undefined, 401],
		["mismatch", " cleanup-secret ", "wrong-secret", 401],
		["match", " cleanup-secret ", "cleanup-secret", 200],
	] as const)(
		"R4-F4 cleanup handler enforces the safe %s secret boundary",
		async (_case, configuredSecret, requestSecret, expectedStatus) => {
			const { handleCleanupRequest } = await import(
				"../../../../supabase/functions/_shared/ai-card-import/cleanup-entrypoint.ts"
			);
			const logs: SafeLogEvent[] = [];
			let executions = 0;
			const headers = new Headers();
			if (requestSecret !== undefined) headers.set("x-ai-worker-secret", requestSecret);
			const response = await handleCleanupRequest(
				new Request("http://cleanup.local", { method: "POST", headers }),
				{
					workerSecret: () => configuredSecret,
					execute: async () => {
						executions += 1;
						return { claimed: 0, deleted: 0, retry: 0 };
					},
					log: (event) => logs.push(event),
				}
			);
			expect(response.status).toBe(expectedStatus);
			if (expectedStatus === 500) {
				expect(await response.json()).toEqual({ errorCode: "INTERNAL_ERROR" });
				expect(logs).toEqual([
					expect.objectContaining({ event: "cleanup", errorCode: "INTERNAL_ERROR" }),
				]);
			} else {
				expect(logs).toEqual([]);
			}
			expect(executions).toBe(expectedStatus === 200 ? 1 : 0);
		}
	);

	it.each(["secret-read", "setup"] as const)(
		"R4-F4 cleanup handler contains %s faults inside the safe boundary",
		async (fault) => {
			const { handleCleanupRequest } = await import(
				"../../../../supabase/functions/_shared/ai-card-import/cleanup-entrypoint.ts"
			);
			const logs: SafeLogEvent[] = [];
			const response = await handleCleanupRequest(
				new Request("http://cleanup.local", {
					method: "POST",
					headers: { "x-ai-worker-secret": "cleanup-secret" },
				}),
				{
					workerSecret: () => {
						if (fault === "secret-read") throw new Error("config read fault");
						return "cleanup-secret";
					},
					execute: async () => {
						throw new Error("setup fault");
					},
					log: (event) => logs.push(event),
				}
			);
			expect(response.status).toBe(500);
			expect(logs).toEqual([
				expect.objectContaining({ event: "cleanup", errorCode: "INTERNAL_ERROR" }),
			]);
		}
	);

	it.each(["read", "claim", "ack", "wasm", "config"] as const)(
		"F1 worker entrypoint reports %s infrastructure faults as recoverable, never terminal",
		async (fault) => {
			const { handleWorkerInvocation } = await import(
				"../../../../supabase/functions/_shared/ai-card-import/worker-entrypoint.ts"
			);
			const harness = createWorkerHarness();
			if (fault === "ack") harness.setDelivery(1, { malformed: true });
			const database = {
				...harness.dependencies.database,
				...(fault === "read"
					? { readOne: async () => Promise.reject(new Error("read fault")) }
					: {}),
				...(fault === "claim"
					? { claim: async () => Promise.reject(new Error("claim fault")) }
					: {}),
				...(fault === "ack"
					? { ackInert: async () => Promise.reject(new Error("ack fault")) }
					: {}),
			};
			const logs: { readonly event: string; readonly errorCode?: string }[] = [];
			const response = await handleWorkerInvocation({
				execute: async () => {
					if (fault === "wasm" || fault === "config") throw new Error(`${fault} fault`);
					return await processOneConcept({ ...harness.dependencies, database });
				},
				log: (event) => logs.push(event),
			});
			expect(response.status).toBe(500);
			expect(logs.filter((event) => event.event === "worker_failure")).toEqual([]);
			expect(logs).toEqual([
				expect.objectContaining({
					event: "worker_recoverable",
					errorCode: "INTERNAL_ERROR",
				}),
			]);
		}
	);
	it("IT-11 first transient failure schedules a 5 second replacement", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
		});
		expect(await processOneConcept(harness.dependencies)).toBe("retried");
		expect(harness.state.retryDelays).toEqual([5]);
	});

	it("IT-12 second transient failure schedules 30 seconds without a business result", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			attempt: 1,
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
		});
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({ retryDelays: [30], finalizeCalls: 0 });
	});

	it("IT-13 third transient failure schedules 120 seconds", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			attempt: 2,
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
		});
		await processOneConcept(harness.dependencies);
		expect(harness.state.retryDelays).toEqual([120]);
	});

	it("IT-14 exhausted transient failure terminates without a fourth retry", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			attempt: 3,
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(harness.state).toMatchObject({ retryDelays: [], failCalls: 1 });
	});

	it("IT-15 permanent failure creates no replacement message", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("permanent", "PROVIDER_PERMANENT_ERROR"),
		});
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({ retryDelays: [], failCalls: 1 });
		expect(workerFailureLogs(harness.state.logs)).toEqual([
			expect.objectContaining({
				event: "worker_failure",
				errorCode: "PROVIDER_PERMANENT_ERROR",
			}),
		]);
	});

	it("F-16 retry exhaustion emits exactly one terminal provider failure log", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			attempt: 3,
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(workerFailureLogs(harness.state.logs)).toEqual([
			expect.objectContaining({
				event: "worker_failure",
				errorCode: "PROVIDER_TRANSIENT_ERROR",
				attempt: 3,
			}),
		]);
	});

	it("IT-16 provider selection defaults only to OpenAI and a malformed success is permanent", async () => {
		expect(resolveProviderName(undefined)).toBe("openai");
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => new Response("not-json", { status: 200 }),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent" });
	});

	it("IT-17 transient Storage failure uses the same persistent retry policy", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			storageWriteResult: { kind: "transient", httpStatus: 503 },
		});
		expect(await processOneConcept(harness.dependencies)).toBe("retried");
		expect(harness.state.retryDelays).toEqual([5]);
	});

	it("IT-18 object conflict without matching tracked bytes fails safely", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			storageWriteResult: { kind: "conflict" },
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(harness.state.finalizeCalls).toBe(0);
	});

	it("F-16 permanent Storage failure emits exactly one terminal failure log", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			storageWriteResult: { kind: "permanent", httpStatus: 403 },
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(workerFailureLogs(harness.state.logs)).toEqual([
			expect.objectContaining({
				event: "worker_failure",
				errorCode: "STORAGE_PERMANENT_ERROR",
			}),
		]);
		expect(harness.state.objectDeletes).toBe(1);
	});

	it("P3-01 emits worker_failure after an ambiguous fail response only when reconciliation confirms terminal failure", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("permanent", "PROVIDER_PERMANENT_ERROR"),
			failError: true,
			failureReconcileOutcome: "terminal_failed",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(workerFailureLogs(harness.state.logs)).toEqual([
			expect.objectContaining({
				event: "worker_failure",
				errorCode: "PROVIDER_PERMANENT_ERROR",
			}),
		]);
	});

	it("F2 delayed claim A cannot reconcile claim B's terminal failure or emit a second terminal log", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("permanent", "PROVIDER_PERMANENT_ERROR"),
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(workerFailureLogs(harness.state.logs)).toHaveLength(1);
		expect(
			await harness.dependencies.database.reconcileFailure({
				jobId: "11000000-0000-4000-8000-000000000001",
				messageId: 1,
				claimToken: "11000000-0000-4000-8000-000000000099",
			})
		).toBe("claim_lost");
		expect(workerFailureLogs(harness.state.logs)).toHaveLength(1);
	});

	it("F2 SQL reconciliation binds terminal failure to its committed message and claim token", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		expect(migration).toMatch(/terminal_message_id\s*=\s*p_message_id/u);
		expect(migration).toMatch(/terminal_claim_token_hash\s*=\s*encode\(extensions\.digest/u);
		expect(migration).toMatch(
			/job\.state='failed'[^;]+job\.terminal_message_id=p_message_id[^;]+job\.terminal_claim_token_hash=encode\(extensions\.digest/u
		);
	});

	it("F3 real runtime gate requires recoverable served evidence and exact terminal correlation", async () => {
		const gate = await readFile(
			new URL("./s11-real-e2e-gate.ts", import.meta.url),
			"utf8"
		);
		expect(gate).toContain('"S11_REAL_RECOVERABLE_WORKER_URL"');
		expect(gate).toContain('"worker_recoverable"');
		expect(gate).toContain("terminal worker_failure count was not exactly one");
		expect(gate).toContain("recoverable scenario emitted worker_failure");
	});

	it("F2 real runtime gate binds both deployments to control-plane artifact attestations and probe correlation", async () => {
		const gate = await readFile(new URL("./s11-real-e2e-gate.ts", import.meta.url), "utf8");
		for (const name of [
			"S11_REAL_WORKER_ARTIFACT_SHA256",
			"S11_REAL_MAIN_WORKER_ARTIFACT_ATTESTATION_URL",
			"S11_REAL_RECOVERABLE_WORKER_ARTIFACT_ATTESTATION_URL",
		]) expect(gate).toContain(`"${name}"`);
		expect(gate).toContain("immutable control-plane artifact attestation");
		expect(gate).toContain('"x-ai-worker-invocation-id"');
		expect(gate).toContain("correlated worker_recoverable count was not exactly one");
		expect(gate).toContain("correlated recoverable invocation emitted worker_failure");
	});

	it("F3 malformed poison ACKs once with one safe observation and no terminal failure", async () => {
		const harness = createWorkerHarness();
		harness.setDelivery(1, { raw: "forbidden" });
		expect(await processOneConcept(harness.dependencies)).toBe("acked");
		expect(harness.state.ackCalls).toBe(1);
		expect(workerEventLogs(harness.state.logs, "worker_poison")).toEqual([
			expect.objectContaining({
				event: "worker_poison",
				reason: "MALFORMED_PAYLOAD",
				queueMessageId: 1,
			}),
		]);
		expect(workerFailureLogs(harness.state.logs)).toEqual([]);
		expect(harness.state.logs.join("\n")).not.toMatch(
			/"(?:raw|payload|prompt|front|back|Authorization)"\s*:/iu
		);
	});

	it("F3 missing-job poison ACKs once with one safe observation and no terminal failure", async () => {
		const harness = createWorkerHarness();
		const database = {
			...harness.dependencies.database,
			claim: async () => ({ outcome: "missing" as const }),
		};
		expect(await processOneConcept({ ...harness.dependencies, database })).toBe("acked");
		expect(harness.state.ackCalls).toBe(1);
		expect(workerEventLogs(harness.state.logs, "worker_poison")).toEqual([
			expect.objectContaining({
				event: "worker_poison",
				reason: "JOB_MISSING",
				queueMessageId: 1,
			}),
		]);
		expect(workerFailureLogs(harness.state.logs)).toEqual([]);
	});

	it.each(["malformed", "missing-job"] as const)(
		"R4-F2 %s poison is not observed until the exact delivery ACK is DB-confirmed",
		async (scenario) => {
			const harness = createWorkerHarness();
			if (scenario === "malformed") harness.setDelivery(1, { raw: "forbidden" });
			const database = {
				...harness.dependencies.database,
				...(scenario === "missing-job"
					? { claim: async () => ({ outcome: "missing" as const }) }
					: {}),
				ackInert: async () => {
					harness.state.ackCalls += 1;
					return false;
				},
			};
			expect(await processOneConcept({ ...harness.dependencies, database })).toBe("recoverable");
			expect(harness.state.ackCalls).toBe(1);
			expect(workerEventLogs(harness.state.logs, "worker_poison")).toEqual([]);
			expect(workerFailureLogs(harness.state.logs)).toEqual([]);
			expect(workerRecoverableLogs(harness.state.logs)).toHaveLength(1);
		}
	);

	it("R4-F2 RPC adapter rejects an unconfirmed inert ACK", async () => {
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () => Response.json(false),
		});
		await expect(database.ackInert(BATCH_ID, 1)).rejects.toThrow("RPC_CONTRACT_ERROR");
	});

	it.each([
		["deleted", { kind: "success" } as const, "COMPENSATION_DELETED"],
		["pending", { kind: "transient", httpStatus: 503 } as const, "COMPENSATION_PENDING"],
	] as const)(
		"F4 direct duplicate response is terminal business output with immediate compensation %s",
		async (_case, compensationDeleteResult, reason) => {
			const harness = createWorkerHarness({
				imageMode: "ai",
				finalizeOutcome: "failed_duplicate",
				compensationDeleteResult,
			});
			expect(await processOneConcept(harness.dependencies)).toBe("failed");
			expect(harness.state).toMatchObject({ objectDeletes: 1, objectOrphanCalls: 0 });
			expect(workerFailureLogs(harness.state.logs)).toEqual([]);
			expect(workerEventLogs(harness.state.logs, "worker_duplicate")).toEqual([
				expect.objectContaining({
					event: "worker_duplicate",
					errorCode: "DUPLICATE_EXISTING",
					reason,
				}),
			]);
		}
	);

	it.each([
		["deleted", { kind: "success" } as const, "COMPENSATION_DELETED"],
		["pending", { kind: "permanent", httpStatus: 403 } as const, "COMPENSATION_PENDING"],
	] as const)(
		"F4 response-loss duplicate reconciliation compensates only after durable confirmation: %s",
		async (_case, compensationDeleteResult, reason) => {
			const harness = createWorkerHarness({
				imageMode: "ai",
				finalizeError: true,
				reconcileOutcome: "terminal_duplicate",
				compensationDeleteResult,
			});
			expect(await processOneConcept(harness.dependencies)).toBe("failed");
			expect(harness.state.objectDeletes).toBe(1);
			expect(workerFailureLogs(harness.state.logs)).toEqual([]);
			expect(workerEventLogs(harness.state.logs, "worker_duplicate")).toEqual([
				expect.objectContaining({ event: "worker_duplicate", reason }),
			]);
		}
	);

	it("F4 never deletes an uploaded object before durable orphan confirmation", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			finalizeError: true,
			reconcileOutcome: "claim_lost",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("recoverable");
		expect(harness.state.objectDeletes).toBe(0);
		expect(workerFailureLogs(harness.state.logs)).toEqual([]);
	});

	it.each([
		["uncommitted", { failureReconcileOutcome: "claim_owned_uncommitted" as const }],
		["ambiguous", { failureReconcileError: true }],
	] as const)(
		"P3-01 does not emit worker_failure when terminal persistence remains %s",
		async (_case, reconciliation) => {
			const harness = createWorkerHarness({
				imageMode: "ai",
				providerResult: safeFailure("permanent", "PROVIDER_PERMANENT_ERROR"),
				failError: true,
				...reconciliation,
			});
			expect(await processOneConcept(harness.dependencies)).toBe("recoverable");
			expect(workerFailureLogs(harness.state.logs)).toEqual([]);
			expect(workerRecoverableLogs(harness.state.logs)).toEqual([
				expect.objectContaining({
					event: "worker_recoverable",
					errorCode: "PROVIDER_PERMANENT_ERROR",
				}),
			]);
		}
	);

	it("P3-01 records retry persistence infrastructure faults as recoverable, never terminal", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("transient", "PROVIDER_TRANSIENT_ERROR"),
			scheduleRetryError: true,
		});
		expect(await processOneConcept(harness.dependencies)).toBe("recoverable");
		expect(workerFailureLogs(harness.state.logs)).toEqual([]);
		expect(workerRecoverableLogs(harness.state.logs)).toHaveLength(1);
	});

	it("R4-F1 excludes configuration, image/decode, contract, and business outcomes from worker_failure", async () => {
		const configuration = createWorkerHarness({ imageMode: "ai" });
		const decode = createWorkerHarness({ imageMode: "ai", decodeError: true });
		const contract = createWorkerHarness({
			imageMode: "ai",
			providerResult: { kind: "permanent", code: "PROVIDER_PERMANENT_ERROR" },
		});
		const conflict = createWorkerHarness({
			imageMode: "ai",
			storageWriteResult: { kind: "conflict" },
		});
		const cases = [
			{
				harness: configuration,
				dependencies: {
					...configuration.dependencies,
					providerEnvironment: {
						...configuration.dependencies.providerEnvironment,
						ILLUSTRATION_PROVIDER: "invalid",
					},
				},
			},
			{ harness: decode, dependencies: decode.dependencies },
			{ harness: contract, dependencies: contract.dependencies },
			{ harness: conflict, dependencies: conflict.dependencies },
		];
		for (const testCase of cases) {
			expect(await processOneConcept(testCase.dependencies)).toBe("failed");
			expect(workerFailureLogs(testCase.harness.state.logs)).toEqual([]);
			expect(workerRecoverableLogs(testCase.harness.state.logs)).toHaveLength(1);
		}
	});

	it.each([
		["landscape", 4096, 64, 1024, 16],
		["portrait", 64, 4096, 16, 1024],
	] as const)(
		"P3-02 worker accepts a valid extreme-aspect %s input and persists its normalized dimensions",
		async (_orientation, inputWidth, inputHeight, outputWidth, outputHeight) => {
			const harness = createWorkerHarness({
				imageMode: "ai",
				providerResult: {
					kind: "success",
					bytes: pngFixture(inputWidth, inputHeight),
					declaredMime: "image/png",
				},
				decodedDimensions: { width: inputWidth, height: inputHeight },
			});
			expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
			expect(harness.state).toMatchObject({ objectWrites: 1, finalizeCalls: 1 });
			const stored = [...harness.storageObjects.values()][0];
			expect(stored).toEqual(pngFixture(outputWidth, outputHeight));
		}
	);

	it("P3-02 DB persistence accepts normalized short edges from 1 through 1024", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		expect(migration.match(/(?:p_)?width (?:NOT )?BETWEEN 1 AND 1024/gu)).toHaveLength(3);
		expect(migration.match(/(?:p_)?height (?:NOT )?BETWEEN 1 AND 1024/gu)).toHaveLength(3);
		expect(migration).not.toMatch(/(?:p_)?(?:width|height) (?:NOT )?BETWEEN 64 AND 1024/gu);
	});

	it("IT-19 a successful AI illustration writes and finalizes one stable object", async () => {
		const harness = createWorkerHarness({ imageMode: "ai" });
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({ providerCalls: 1, objectWrites: 1, finalizeCalls: 1 });
		expect(harness.storageObjects.size).toBe(1);
	});

	it("IT-20 upload mode removes its temporary source after terminal processing", async () => {
		const harness = createWorkerHarness({ imageMode: "upload" });
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({ sourceDeletes: 1, providerCalls: 0 });
	});
});

describe("S-11 cleanup, pair atomicity, and logging integration", () => {
	it("IT-21 cleanup treats Storage 404 as successful deletion", async () => {
		const completed: string[] = [];
		const result = await runCleanup({
			database: {
				claimCleanup: async () => [
					{
						trackingId: "t1",
						bucket: "illustrations",
						path: `${BATCH_ID}/x.png`,
						claimToken: "22000000-0000-4000-8000-000000000091",
					},
				],
				verifyCleanup: async () => "delete",
				completeCleanup: async (_id, outcome) => {
					completed.push(outcome);
				},
			},
			storage: {
				readSource: async () => new Uint8Array(),
				writeIllustration: async () => ({ kind: "success" }),
				readIllustration: async () => undefined,
				deleteObject: async () => ({ kind: "not_found" }),
			},
			now: () => new Date("2026-07-16T00:00:00Z"),
			log: () => {},
		});
		expect(result.deleted).toBe(1);
		expect(completed).toEqual(["deleted"]);
	});

	it("IT-22 private Storage boundary classifies owner-path 403 as permanent", async () => {
		const storage = createStorageClient({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () => new Response(null, { status: 403 }),
		});
		expect(await storage.writeIllustration(`${OWNER_ID}/x.png`, new Uint8Array([1]))).toMatchObject(
			{ kind: "permanent", httpStatus: 403 }
		);
	});

	it("IT-23 concept finalization is invoked once for the R1/W1 aggregate", async () => {
		const harness = createWorkerHarness();
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state.finalizeCalls).toBe(1);
	});

	it("IT-24 image mode none bypasses provider, quota image object, and Storage", async () => {
		const harness = createWorkerHarness({ imageMode: "none" });
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({ providerCalls: 0, objectWrites: 0, finalizeCalls: 1 });
	});

	it("IT-25 captured worker and cleanup logs contain only safe metadata", async () => {
		const harness = createWorkerHarness({ imageMode: "ai" });
		await processOneConcept(harness.dependencies);
		const logs = harness.state.logs.join("\n");
		expect(logs).not.toMatch(/api.?key|Authorization|base64|front|back|prompt|raw|payload/iu);
	});
});

describe("S-11 reviewer regression boundaries", () => {
	it("F-15 binds the configured endpoint to the selected provider request", async () => {
		const endpoint = "https://fake-provider.example.test/v1/images";
		const binding = "s11-binding-fixture";
		let requestUrl = "";
		let requestBinding: string | null = null;
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			endpoint,
			endpointBinding: binding,
			fetchImplementation: async (input, init) => {
				const request = new Request(input, init);
				requestUrl = request.url;
				requestBinding = request.headers.get("x-s11-provider-binding");
				return Response.json({ data: [] });
			},
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent" });
		expect({ requestUrl, requestBinding }).toEqual({ requestUrl: endpoint, requestBinding: binding });
	});

	it.each([null, { trackingId: "unexpected" }, [null], [{}]])(
		"F-05 rejects malformed cleanup claim RPC data instead of treating it as no work: %j",
		async (rpcValue) => {
			const database = createSupabaseDatabase({
				supabaseUrl: "http://supabase.local",
				serviceRoleKey: "service-fixture",
				fetchImplementation: async () => Response.json(rpcValue),
			});
			await expect(database.claimCleanup(20)).rejects.toThrow(
				"RPC_CONTRACT_ERROR"
			);
		}
	);

	it.each(["openai", "gemini"] as const)(
		"F-02 rejects a %s base64 image whose decoded size is 10 MiB + 1 before atob",
		async (providerName) => {
			const oversizedBase64 = "A".repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
			const body =
				providerName === "openai"
					? { data: [{ b64_json: oversizedBase64 }] }
					: {
							candidates: [
								{
									content: {
										parts: [{ inlineData: { data: oversizedBase64, mimeType: "image/png" } }],
									},
								},
							],
						};
			const fetchImplementation = async () => Response.json(body);
			const provider =
				providerName === "openai"
					? createOpenAiProvider({ apiKey: "fixture", model: "fixture", fetchImplementation })
					: createGeminiProvider({ apiKey: "fixture", model: "fixture", fetchImplementation });
			const atobSpy = vi.spyOn(globalThis, "atob");
			try {
				expect(
					await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
				).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
				expect(atobSpy).not.toHaveBeenCalled();
			} finally {
				atobSpy.mockRestore();
			}
		}
	);

	it.each(["missing", "underreported"] as const)(
		"F-02 enforces the streamed provider response bound with %s Content-Length",
		async (mode) => {
			const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
				start(controller) {
					controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
					controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
					controller.close();
				},
			});
			const provider = createOpenAiProvider({
				apiKey: "fixture",
				model: "fixture",
				fetchImplementation: async () =>
					new Response(stream, {
						status: 200,
						headers: mode === "underreported" ? { "Content-Length": "1" } : undefined,
					}),
			});
			expect(
				await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
			).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
		}
	);

	it("F-02 rejects an oversized declared provider body before reading it", async () => {
		const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(controller) {
				controller.enqueue(new Uint8Array([123, 125]));
				controller.close();
			},
		});
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () =>
				new Response(stream, {
					status: 200,
					headers: { "Content-Length": String(16 * 1024 * 1024) },
				}),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
	});

	it.each(["openai", "gemini"] as const)(
		"R10-F2 rejects declared-oversize %s responses before reads and cancels the body",
		async (providerName) => {
			let pulls = 0;
			let cancellations = 0;
			const response = new Response(
				new ReadableStream<Uint8Array<ArrayBuffer>>(
					{
						pull(controller) {
							pulls += 1;
							controller.enqueue(new Uint8Array([123, 125]));
						},
						cancel() {
							cancellations += 1;
						},
					},
					{ highWaterMark: 0 }
				),
				{ status: 200, headers: { "Content-Length": String(16 * 1024 * 1024) } }
			);
			const provider =
				providerName === "openai"
					? createOpenAiProvider({
							apiKey: "fixture",
							model: "fixture",
							fetchImplementation: async () => response,
						})
					: createGeminiProvider({
							apiKey: "fixture",
							model: "fixture",
							fetchImplementation: async () => response,
						});
			expect(
				await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
			).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
			expect({ pulls, cancellations }).toEqual({ pulls: 0, cancellations: 1 });
		}
	);

	it.each([
		["synchronous throw", () => {
			throw new Error("unsafe cancellation detail");
		}],
		["asynchronous rejection", async () => {
			throw new Error("unsafe cancellation detail");
		}],
	] as const)(
		"R10-F2 preserves IMAGE_TOO_LARGE when overflow cancellation has a %s",
		async (_mode, cancel) => {
			const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
				start(controller) {
					controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
					controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
				},
				cancel,
			});
			const provider = createOpenAiProvider({
				apiKey: "fixture",
				model: "fixture",
				fetchImplementation: async () =>
					new Response(stream, { status: 200, headers: { "Content-Length": "1" } }),
			});
			expect(
				await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
			).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
		}
	);

	it("R10-F2 preserves declared oversize when the response body and cancel are absent", async () => {
		const provider = createGeminiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () =>
				new Response(null, {
					status: 200,
					headers: { "Content-Length": String(16 * 1024 * 1024) },
				}),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
	});

	it("R10-F2 cancels a streamed overflow when Content-Length is absent", async () => {
		let cancelled = false;
		const provider = createGeminiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () =>
				new Response(
					new ReadableStream<Uint8Array<ArrayBuffer>>({
						start(controller) {
							controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
							controller.enqueue(new Uint8Array(new ArrayBuffer(8 * 1024 * 1024)));
						},
						cancel() {
							cancelled = true;
						},
					}),
					{ status: 200 }
				),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent", code: "IMAGE_TOO_LARGE" });
		expect(cancelled).toBe(true);
	});

	it("NR-15 rejects a declared-small stream that actually exceeds 10 MiB", async () => {
		const { readSourceResponseWithLimit } = await import(
			"../../../../frontend/app/api/ai/imports/sources/complete/route"
		);
		const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(controller) {
				controller.enqueue(new Uint8Array(new ArrayBuffer(6)));
				controller.enqueue(new Uint8Array(new ArrayBuffer(6)));
				controller.close();
			},
		});
		await expect(
			readSourceResponseWithLimit(
				new Response(stream, { headers: { "Content-Length": "1" } }),
				10
			)
		).rejects.toThrow("IMAGE_TOO_LARGE");
	});

	it.each(["missing", "underreported"] as const)(
		"F-17 bounds existing-illustration conflict reads with %s Content-Length",
		async (mode) => {
			let cancelled = false;
			const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
				start(controller) {
					controller.enqueue(new Uint8Array(new ArrayBuffer(6 * 1024 * 1024)));
					controller.enqueue(new Uint8Array(new ArrayBuffer(5 * 1024 * 1024)));
				},
				cancel() {
					cancelled = true;
				},
			});
			const storage = createStorageClient({
				supabaseUrl: "http://supabase.local",
				serviceRoleKey: "service-fixture",
				fetchImplementation: async () =>
					new Response(stream, {
						status: 200,
						headers: mode === "underreported" ? { "Content-Length": "1" } : undefined,
					}),
			});
			await expect(storage.readIllustration(`${OWNER_ID}/s11-managed/existing.png`)).rejects.toThrow(
				"Storage response exceeded"
			);
			expect(cancelled).toBe(true);
		}
	);

	it("F-17 rejects an oversized declared existing illustration before reading the stream", async () => {
		let pulls = 0;
		let cancelled = false;
		const storage = createStorageClient({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () =>
				new Response(
					new ReadableStream<Uint8Array<ArrayBuffer>>({
						pull(controller) {
							pulls += 1;
							controller.enqueue(new Uint8Array([1]));
						},
						cancel() {
							cancelled = true;
						},
					}, { highWaterMark: 0 }),
					{
						status: 200,
						headers: { "Content-Length": String(10 * 1024 * 1024 + 1) },
					}
				),
		});
		await expect(storage.readIllustration(`${OWNER_ID}/s11-managed/existing.png`)).rejects.toThrow(
			"Storage response exceeded"
		);
		expect(pulls).toBe(0);
		expect(cancelled).toBe(true);
	});

	it("R20-F1/F-18 reserves S-11 managed paths through a least-privilege owner helper", async () => {
		const [migration, forwardMigration] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260716000001_s11_storage_policy_helper.sql",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(migration).toContain(
			"storage_path = owner_user_id::text || '/s11-managed/' || illustration_id::text || '.png'"
		);
		for (const sql of [migration, forwardMigration]) {
			expect(sql).toContain(
				"CREATE OR REPLACE FUNCTION public.ai_s11_storage_object_is_managed"
			);
			expect(sql).toContain("SECURITY DEFINER");
			expect(sql).toContain("SET search_path = pg_catalog, pg_temp");
			expect(sql).toContain(
				"ALTER FUNCTION public.ai_s11_storage_object_is_managed(text,text) OWNER TO s10_migration_owner"
			);
			expect(sql).toMatch(
				/REVOKE ALL ON FUNCTION public\.ai_s11_storage_object_is_managed\(text,text\)\s+FROM PUBLIC,anon,authenticated,service_role/u
			);
			expect(sql).toMatch(
				/GRANT EXECUTE ON FUNCTION public\.ai_s11_storage_object_is_managed\(text,text\)\s+TO authenticated/u
			);
			expect(sql).toContain("current_setting('request.jwt.claims',true)");
			expect(sql).toContain("caller_claims->>'role'");
			expect(sql).toContain("caller_claims->>'sub'");
			expect(sql).toContain("caller_owner := caller_subject::uuid");
			expect(sql).not.toContain("caller_owner := auth.uid()");
			expect(sql).toContain("request.jwt.claim.role");
			for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
				const policyStart = sql.indexOf(
					`CREATE POLICY storage_objects_${operation.toLowerCase()}_owner_illustrations`
				);
				expect(policyStart).toBeGreaterThanOrEqual(0);
				const policy = sql.slice(policyStart, sql.indexOf(";", policyStart) + 1);
				expect(policy).toContain("split_part(name, '/', 1) = auth.uid()::text");
				expect(policy).toContain(
					"NOT public.ai_s11_storage_object_is_managed(bucket_id,name)"
				);
				expect(policy).not.toContain("public.ai_illustration_objects");
				if (operation === "UPDATE") {
					expect(policy.match(/ai_s11_storage_object_is_managed/g)).toHaveLength(2);
				}
			}
			expect(sql).not.toContain(
				"DROP POLICY IF EXISTS storage_objects_select_owner_illustrations"
			);
		}
	});

	it("R20-F3/F-19 keeps hosted sensitive snapshots service-only while owner safe RLS remains executable", async () => {
		const objectId = "16000000-0000-4000-8000-000000000019";
		const calls: Array<{ url: string; authorization: string | null }> = [];
		const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const authorization = new Headers(init?.headers).get("Authorization");
			calls.push({ url, authorization });
			if (url.includes("cleanup_claim_token")) {
				return new Response(JSON.stringify({ code: "42501" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (authorization === "Bearer owner-a") {
				return Response.json([{ id: objectId, owner_user_id: OWNER_ID, state: "ready" }]);
			}
			if (authorization === "Bearer owner-b") return Response.json([]);
			if (authorization === "Bearer service-role") {
				return Response.json([{ id: objectId, storage_path: `${OWNER_ID}/s11-managed/x.png` }]);
			}
			return Response.json({ code: "unexpected" }, { status: 500 });
		}) as typeof fetch;
		const boundary = {
			fetch: fetchImplementation,
			supabaseBase: "https://project.supabase.co",
			anonKey: "anon-fixture",
		};
		await assertOwnerProjectionBoundary(
			{
				...boundary,
				ownerHeaders: { Authorization: "Bearer owner-a" },
				otherOwnerHeaders: { Authorization: "Bearer owner-b" },
			},
			objectId
		);
		await expect(
			fetchServiceOwnerRows(
				boundary,
				{ Authorization: "Bearer service-role", apikey: "service-role" },
				OWNER_ID,
				"ai_illustration_objects?select=id,storage_path"
			)
		).resolves.toHaveLength(1);
		await expect(
			fetchServiceOwnerRows(
				boundary,
				{ Authorization: "Bearer owner-a", apikey: "anon-fixture" },
				OWNER_ID,
				"ai_illustration_objects?select=id,storage_path"
			)
		).rejects.toThrow("service-role bearer/apikey pair");
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ authorization: "Bearer owner-a" }),
				expect.objectContaining({ authorization: "Bearer owner-b" }),
				expect.objectContaining({ authorization: "Bearer service-role" }),
			])
		);
		expect(calls.at(-1)?.url).toContain(`owner_user_id=eq.${OWNER_ID}`);

		const hostedGate = await readFile(
			new URL("./s11-real-e2e-gate.ts", import.meta.url),
			"utf8"
		);
		expect(hostedGate).toContain("fetchServiceOwnerRows(");
		expect(hostedGate).toContain("assertOwnerProjectionBoundary(");
		expect(hostedGate).not.toMatch(/fetchOwnerRows\(|ownerObjects\(/u);
		expect(hostedGate).not.toContain(
			"ai_illustration_objects?select=storage_path,state"
		);
	});

	it.each(SERVICE_SNAPSHOT_CREDENTIAL_CASES)(
		"R21-F1 accepts only a normalized service bearer/api-key pair: $label",
		async ({ headers, valid }) => {
			const outgoingHeaders: Headers[] = [];
			const fetchImplementation = vi.fn(
				async (_input: string | URL | Request, init?: RequestInit) => {
					outgoingHeaders.push(new Headers(init?.headers));
					return Response.json([{ id: "safe-row" }]);
				}
			) as typeof fetch;
			const boundary = {
				fetch: fetchImplementation,
				supabaseBase: "https://project.supabase.co",
				anonKey: ANON_TEST_API_KEY,
			};
			const request = fetchServiceOwnerRows(
				boundary,
				headers,
				OWNER_ID,
				"ai_illustration_objects?select=id,storage_path"
			);

			if (!valid) {
				await expect(request).rejects.toThrow(
					"service owner snapshot requires the service-role bearer/apikey pair"
				);
				expect(fetchImplementation).not.toHaveBeenCalled();
				return;
			}

			await expect(request).resolves.toHaveLength(1);
			expect(fetchImplementation).toHaveBeenCalledTimes(1);
			expect(outgoingHeaders).toHaveLength(1);
			expect(outgoingHeaders[0]?.get("Authorization")).toBe(
				SERVICE_TEST_AUTHORIZATION
			);
			expect(outgoingHeaders[0]?.get("apikey")).toBe(SERVICE_TEST_API_KEY);
		}
	);

	it("NR-16 maps only existence-hidden status errors to 404 and backend errors to 5xx", async () => {
		const { GET } = await import("../../../../frontend/app/api/ai/imports/status/route");
		routeBoundary.rpc.mockResolvedValueOnce({ data: null, error: { code: "P1003" } });
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(404);
		routeBoundary.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: "backend unavailable" },
		});
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(500);
		routeBoundary.rpc.mockRejectedValueOnce(new TypeError("network down"));
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(503);
		routeBoundary.rpc.mockResolvedValueOnce({
			data: {
				batchId: BATCH_ID,
				status: "queued",
				counts: { total: 1, succeeded: 0, failed: 0 },
				items: [
					{
						itemId: "22000000-0000-4000-8000-000000000013",
						conceptId: "c-1",
						status: "queued",
						cardId: null,
						errorCode: null,
					},
				],
			},
			error: null,
		});
		expect(
			(await GET(new Request(`http://local/api/ai/imports/status?batchId=${BATCH_ID}`))).status
		).toBe(200);
	});

	it("CR-02 forwards every S-11 safe terminal code through the real RPC adapter", async () => {
		const bodies: unknown[] = [];
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async (_input, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				return Response.json({ status: "failed" });
			},
		});
		for (const errorCode of SAFE_IMPORT_ERROR_CODES) {
			await database.fail({ jobId: BATCH_ID, messageId: 1, claimToken: BATCH_ID, errorCode });
		}
		expect(bodies).toHaveLength(SAFE_IMPORT_ERROR_CODES.length);
		expect(bodies.map((body) => (body as { p_error_code: string }).p_error_code)).toEqual([
			...SAFE_IMPORT_ERROR_CODES,
		]);
	});

	it("CR-04 keeps an upload source across a transient retry", async () => {
		const harness = createWorkerHarness({
			imageMode: "upload",
			storageWriteResult: { kind: "transient", httpStatus: 503 },
		});
		expect(await processOneConcept(harness.dependencies)).toBe("retried");
		expect(harness.state).toMatchObject({ sourceDeletes: 0, sourceDeletedCalls: 0 });
	});

	it("CR-04 records terminal source deletion exceptions for cleanup", async () => {
		const harness = createWorkerHarness({ imageMode: "upload", sourceDeleteThrows: true });
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state).toMatchObject({ sourceDeletes: 1, sourceCleanupCalls: 1 });
	});

	it("CR-04 reconciles a lost failure RPC response and still deletes the terminal source", async () => {
		const harness = createWorkerHarness({
			imageMode: "upload",
			decodeError: true,
			failError: true,
			failureReconcileOutcome: "terminal_failed",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("failed");
		expect(harness.state).toMatchObject({ failCalls: 1, sourceDeletes: 1, sourceDeletedCalls: 1 });
	});

	it.each([
		["permanent", "claim"],
		["permanent", "complete"],
		["duplicate", "claim"],
		["duplicate", "complete"],
	] as const)(
		"R10-R2-F2 keeps terminal %s and immediate source release when outbox %s fails",
		async (terminalKind, fault) => {
			const harness = createWorkerHarness(
				terminalKind === "permanent"
					? {
							imageMode: "upload",
							storageWriteResult: { kind: "permanent", httpStatus: 403 },
						}
					: { imageMode: "upload", finalizeOutcome: "failed_duplicate" }
			);
			const durableDatabase = harness.dependencies.database;
			let claimCalls = 0;
			let completeFaultInjected = false;
			let claimedEvent: { readonly eventId: string } | undefined;
			const database = {
				...durableDatabase,
				claimWorkerEvent: async (claimToken: string) => {
					claimCalls += 1;
					if (claimCalls === 1) return undefined;
					if (fault === "claim" && claimCalls === 2) throw new Error("unsafe-outbox-claim-detail");
					const event = await durableDatabase.claimWorkerEvent(claimToken);
					if (event !== undefined) claimedEvent = event;
					return event;
				},
				completeWorkerEvent: async (eventId: string, claimToken: string) => {
					if (fault === "complete" && !completeFaultInjected) {
						completeFaultInjected = true;
						throw new Error("unsafe-outbox-complete-detail");
					}
					await durableDatabase.completeWorkerEvent(eventId, claimToken);
				},
			};

			expect(await processOneConcept({ ...harness.dependencies, database })).toBe("failed");
			expect(harness.state).toMatchObject({ jobState: "failed", sourceDeletes: 1 });
			expect(harness.state.logs.join("\n")).not.toContain("unsafe-outbox");

			const reclaimable = claimedEvent ?? await durableDatabase.claimWorkerEvent(CLAIM_TOKEN);
			expect(reclaimable).toBeDefined();
			if (reclaimable !== undefined) {
				await durableDatabase.completeWorkerEvent(reclaimable.eventId, CLAIM_TOKEN);
			}
			expect(await durableDatabase.claimWorkerEvent(CLAIM_TOKEN)).toBeUndefined();
		}
	);

	it("HI-12 reads and deletes a legacy S-10 source from its recorded illustrations bucket", async () => {
		const harness = createWorkerHarness({ imageMode: "upload", sourceBucket: "illustrations" });
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state.sourceReadBuckets).toEqual(["illustrations"]);
		expect(harness.state.sourceDeletes).toBe(0);
		expect(harness.state.objectDeletes).toBe(1);
	});

	it("NR-18 parallel shared-upload consumers retain until both are terminal and delete once", async () => {
		let terminalReleases = 0;
		const releaseSource = async () => {
			terminalReleases += 1;
			return terminalReleases < 2
				? ({ outcome: "retain" } as const)
				: ({ outcome: "delete", bucket: "ai-card-sources", path: `${BATCH_ID}/source` } as const);
		};
		const first = createWorkerHarness({ imageMode: "upload" });
		const second = createWorkerHarness({ imageMode: "upload" });
		const [firstOutcome, secondOutcome] = await Promise.all([
			processOneConcept({
				...first.dependencies,
				database: { ...first.dependencies.database, releaseSource },
			}),
			processOneConcept({
				...second.dependencies,
				database: { ...second.dependencies.database, releaseSource },
			}),
		]);
		expect([firstOutcome, secondOutcome]).toEqual(["succeeded", "succeeded"]);
		expect(first.state.sourceDeletes + second.state.sourceDeletes).toBe(1);
	});

	it("NR-18 out-of-order failure then success does not delete the shared source early", async () => {
		const failed = createWorkerHarness({
			imageMode: "upload",
			decodeError: true,
			sourceReleaseOutcome: "retain",
		});
		const succeeded = createWorkerHarness({ imageMode: "upload" });
		expect(await processOneConcept(failed.dependencies)).toBe("failed");
		expect(failed.state).toMatchObject({ sourceRetains: 1, sourceDeletes: 0 });
		expect(await processOneConcept(succeeded.dependencies)).toBe("succeeded");
		expect(succeeded.state.sourceDeletes).toBe(1);
	});

	it("HI-11 terminates decode and encode exceptions instead of retrying", async () => {
		for (const options of [{ decodeError: true }, { encodeError: true }]) {
			const harness = createWorkerHarness({ imageMode: "ai", ...options });
			expect(await processOneConcept(harness.dependencies)).toBe("failed");
			expect(harness.state.retryDelays).toEqual([]);
		}
	});

	it("HI-09 rechecks a cleanup lease before touching Storage", async () => {
		let storageDeletes = 0;
		const outcomes: string[] = [];
		const result = await runCleanup({
			database: {
				claimCleanup: async () => [
					{
						trackingId: "race",
						bucket: "illustrations",
						path: `${OWNER_ID}/race.png`,
						claimToken: "22000000-0000-4000-8000-000000000099",
					},
				],
				verifyCleanup: async () => "skip",
				completeCleanup: async (_claim, outcome) => {
					outcomes.push(outcome);
				},
			},
			storage: {
				readSource: async () => new Uint8Array(),
				writeIllustration: async () => ({ kind: "success" }),
				readIllustration: async () => undefined,
				deleteObject: async () => {
					storageDeletes += 1;
					return { kind: "success" };
				},
			},
			now: () => new Date("2026-07-16T00:00:00Z"),
			log: () => {},
		});
		expect({ result, storageDeletes, outcomes }).toMatchObject({
			storageDeletes: 0,
			outcomes: ["retry"],
		});
	});

	it("R4-F3 preserves delete_pending intent across failed cleanup deletion for immediate fenced retry", async () => {
		const migration = await readFile(
			new URL(
				"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
				import.meta.url
			),
			"utf8"
		);
		expect(migration).toContain("cleanup_previous_state text");
		expect(migration).toMatch(
			/cleanup_previous_state=CASE\s+WHEN objects\.state='cleaning' THEN objects\.cleanup_previous_state\s+ELSE objects\.state\s+END/u
		);
		expect(migration).toMatch(
			/state=CASE p_outcome\s+WHEN 'deleted' THEN 'deleted'\s+ELSE COALESCE\(cleanup_previous_state,'orphan'\) END/u
		);
		expect(migration).toMatch(
			/objects\.state='cleaning'[\s\S]+objects\.cleanup_previous_state='delete_pending'/u
		);
		expect(migration).toMatch(
			/object_row\.reference_count<>0 THEN RETURN jsonb_build_object\('outcome','skip'\)/u
		);
	});

	it("CR-05 does not compensate when finalize response loss reconciles to terminal success", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			finalizeError: true,
			reconcileOutcome: "terminal_success",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state.objectDeletes).toBe(0);
	});

	it("CR-05 compensates only while the same claim is proven uncommitted", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			finalizeError: true,
			reconcileOutcome: "claim_owned_uncommitted",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("recoverable");
		expect(harness.state.objectDeletes).toBe(1);
	});

	it("HI-19 makes a transiently failed finalize compensation reclaimable by cleanup", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			finalizeError: true,
			reconcileOutcome: "claim_owned_uncommitted",
			compensationDeleteResult: { kind: "transient", httpStatus: 503 },
		});
		expect(await processOneConcept(harness.dependencies)).toBe("recoverable");
		expect(harness.state).toMatchObject({ objectOrphanCalls: 1, objectDeletes: 1 });

		let claimed = harness.state.objectOrphanCalls === 1;
		const cleanup = await runCleanup({
			database: {
				claimCleanup: async () =>
					claimed
						? [{
							trackingId: "orphan",
							bucket: "illustrations",
							path: `${OWNER_ID}/orphan.png`,
							claimToken: "22000000-0000-4000-8000-000000000092",
						}]
						: [],
				verifyCleanup: async () => "delete",
				completeCleanup: async (_claim, outcome) => {
					if (outcome === "deleted") claimed = false;
				},
			},
			storage: {
				readSource: async () => new Uint8Array(),
				writeIllustration: async () => ({ kind: "success" }),
				readIllustration: async () => undefined,
				deleteObject: async () => ({ kind: "success" }),
			},
			now: () => new Date("2026-07-16T00:00:00Z"),
			log: () => {},
		});
		expect(cleanup).toMatchObject({ claimed: 1, deleted: 1 });
		expect(claimed).toBe(false);
	});

	it.each([
		["fresh declared oversized", "ai-card-sources", "declared"],
		["fresh missing Content-Length oversized stream", "ai-card-sources", "missing"],
		["legacy lying Content-Length oversized stream", "illustrations", "lying"],
	] as const)("HI-20 rejects %s before image decode", async (_name, sourceBucket, mode) => {
		const requests: string[] = [];
		const storage = createStorageClient({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async (input, init) => {
				requests.push(String(input));
				if (init?.method === "DELETE") return new Response(null, { status: 200 });
				return oversizedStorageResponse(mode);
			},
		});
		const harness = createWorkerHarness({ imageMode: "upload", sourceBucket });
		const outcome = await processOneConcept({ ...harness.dependencies, storage });
		expect(outcome).toBe("failed");
		expect(harness.state).toMatchObject({
			failCalls: 1,
			failureCodes: ["IMAGE_TOO_LARGE"],
			objectWrites: 0,
		});
		expect(requests[0]).toContain(`/storage/v1/object/${sourceBucket}/`);
	});

	it.each([408, 429, 500, 503])("HI-11 retries OpenAI HTTP %i", async (status) => {
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => new Response(null, { status }),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "transient", httpStatus: status });
	});

	it.each([400, 401, 403, 422])("HI-11 terminates OpenAI HTTP %i", async (status) => {
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => new Response(null, { status }),
		});
		expect(
			await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent", httpStatus: status });
	});

	it("HI-11 treats a fetch rejection as transient but malformed JSON as permanent", async () => {
		const network = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => {
				throw new TypeError("network down");
			},
		});
		const malformed = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => new Response("not-json", { status: 200 }),
		});
		expect(
			await network.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "transient" });
		expect(
			await malformed.generate({ prompt: "safe fixture", signal: new AbortController().signal })
		).toMatchObject({ kind: "permanent" });
	});

	it.each(["openai", "gemini"] as const)(
		"R23-F1 treats a successful %s HTTP response whose body transport aborts mid-stream as transient",
		async (providerName) => {
			const fetchImplementation = async () => midStreamFailureResponse();
			const provider = providerName === "openai"
				? createOpenAiProvider({ apiKey: "fixture", model: "fixture", fetchImplementation })
				: createGeminiProvider({ apiKey: "fixture", model: "fixture", fetchImplementation });
			expect(
				await provider.generate({ prompt: "safe fixture", signal: new AbortController().signal })
			).toEqual({ kind: "transient", code: "PROVIDER_TRANSIENT_ERROR" });
		}
	);

	it("R23-F1 persists the provider mid-stream transport retry schedule", async () => {
		const provider = createOpenAiProvider({
			apiKey: "fixture",
			model: "fixture",
			fetchImplementation: async () => midStreamFailureResponse(),
		});
		const harness = createWorkerHarness({ imageMode: "ai" });
		expect(await processOneConcept({
			...harness.dependencies,
			providers: { ...harness.dependencies.providers, openai: provider },
		})).toBe("retried");
		expect(harness.state.retryDelays).toEqual([5]);
		expect(harness.state.failCalls).toBe(0);
	});

	it("HI-11 schedules persistent retry when conflict verification Storage read has a network error", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			storageWriteResult: { kind: "conflict" },
			illustrationReadThrows: true,
		});
		expect(await processOneConcept(harness.dependencies)).toBe("retried");
		expect(harness.state.retryDelays).toEqual([5]);
	});

	it.each(["source", "conflict"] as const)(
		"R23-F1 treats a Storage %s body controller.error after bytes as retryable",
		async (path) => {
			let requests = 0;
			const storage = createStorageClient({
				supabaseUrl: "http://supabase.local",
				serviceRoleKey: "service-fixture",
				fetchImplementation: async (_input, init) => {
					requests += 1;
					if (path === "conflict" && init?.method === "POST") {
						return new Response(null, { status: 409 });
					}
					return midStreamFailureResponse();
				},
			});
			const harness = createWorkerHarness({
				imageMode: path === "source" ? "upload" : "ai",
			});
			expect(await processOneConcept({ ...harness.dependencies, storage })).toBe("retried");
			expect(harness.state.retryDelays).toEqual([5]);
			expect(harness.state.failCalls).toBe(0);
			expect(requests).toBe(path === "source" ? 1 : 2);
		}
	);

	it.each([
		["image/png", sourceFixture("image/png")],
		["image/jpeg", sourceFixture("image/jpeg")],
		["image/webp", sourceFixture("image/webp")],
	] as const)("HI-08 fully decodes and re-encodes %s source bytes", async (mime, bytes) => {
		const clean = pngFixture(128, 128);
		const decode = vi.fn(async () => ({ width: 128, height: 128 }));
		const encodePng = vi.fn(async () => clean);
		const result = await sanitizeSourceImage({ bytes, declaredMime: mime }, { decode, encodePng });
		expect(result).toMatchObject({ mime: "image/png", width: 128, height: 128 });
		expect(decode).toHaveBeenCalledWith(bytes);
		expect(result.bytes).toBe(clean);
	});

	it.each(["ai", "upload"] as const)(
		"R19-F2 rejects oversized normalized PNG for %s without retry or destination Storage",
		async (imageMode) => {
			const harness = createWorkerHarness({ imageMode });
			const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
			oversized.set(pngFixture(128, 128));
			harness.dependencies.codec.encodePng = async () => oversized;
			expect(await processOneConcept(harness.dependencies)).toBe("failed");
			expect(harness.state.failureCodes).toEqual(["IMAGE_TOO_LARGE"]);
			expect(harness.state.retryDelays).toEqual([]);
			expect(harness.state.objectWrites).toBe(0);
			expect(harness.state.finalizeCalls).toBe(0);
		}
	);

	it("R19-F2 rejects an oversized source normalization before write intent or destination Storage", async () => {
		const uploadId = "22000000-0000-4000-8000-000000000019";
		const rawPath = `${OWNER_ID}/${uploadId}/raw`;
		const input = pngFixture(1, 1);
		const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
		oversized.set(input);
		const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
		query.select.mockReturnValue(query);
		query.eq.mockReturnValue(query);
		query.maybeSingle.mockResolvedValue({
			data: {
				id: uploadId,
				owner_user_id: OWNER_ID,
				status: "prepared",
				raw_storage_path: rawPath,
				mime_type: "image/png",
				byte_size: input.byteLength,
			},
			error: null,
		});
		routeBoundary.from.mockReturnValue(query);
		routeBoundary.rpc.mockResolvedValue({ data: null, error: null });
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "r19-test-anon");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "r19-test-service");
		vi.stubGlobal("fetch", async () =>
			new Response(Uint8Array.from(input).buffer, { status: 200 })
		);
		vi.resetModules();
		vi.doMock("@/lib/ai-import/source-image-codec", () => ({
			createSourceImageCodec: async () => ({
				decode: async () => ({ width: 1, height: 1 }),
				encodePng: async () => oversized,
			}),
		}));
		try {
			const { POST } = await import(
				"../../../../frontend/app/api/ai/imports/sources/complete/route"
			);
			const response = await POST(
				new Request("http://local/api/ai/imports/sources/complete", {
					method: "POST",
					body: JSON.stringify({ uploadId }),
				})
			);
			expect(response.status).toBe(413);
			expect(await response.json()).toEqual({ error: { code: "IMAGE_TOO_LARGE" } });
			expect(routeBoundary.upload).not.toHaveBeenCalled();
			expect(routeBoundary.remove).toHaveBeenCalledWith([rawPath]);
			expect(routeBoundary.rpc.mock.calls).toEqual([
				[
					"mark_ai_upload_cleanup",
					{ p_owner_user_id: OWNER_ID, p_upload_id: uploadId, p_source_path: null },
				],
			]);
		} finally {
			vi.doUnmock("@/lib/ai-import/source-image-codec");
			vi.resetModules();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});

	it("R23-F3 M1 keeps prepared source retryable when codec initialization fails once", async () => {
		const uploadId = "22000000-0000-4000-8000-000000000024";
		const rawPath = `${OWNER_ID}/${uploadId}/raw`;
		const sourcePath = `${OWNER_ID}/${uploadId}/source`;
		const png = Uint8Array.from(Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			"base64"
		));
		const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
		query.select.mockReturnValue(query);
		query.eq.mockReturnValue(query);
		query.maybeSingle.mockResolvedValue({
			data: {
				id: uploadId,
				owner_user_id: OWNER_ID,
				status: "prepared",
				raw_storage_path: rawPath,
				mime_type: "image/png",
				byte_size: png.byteLength,
			},
			error: null,
		});
		routeBoundary.from.mockReturnValue(query);
		routeBoundary.rpc.mockImplementation(async (name: string) => name === "mark_ai_source_ready"
			? { data: { uploadId, status: "ready", path: sourcePath }, error: null }
			: { data: null, error: null });
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "codec-retry-test-anon");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "codec-retry-test-service");
		vi.stubGlobal("fetch", async () => new Response(png, { status: 200 }));
		const initializeCodec = vi.fn()
			.mockRejectedValueOnce(new TypeError("unsafe initialization detail"))
			.mockResolvedValue({
				decode: async () => ({ width: 1, height: 1 }),
				encodePng: async () => png,
			});
		vi.resetModules();
		vi.doMock("@/lib/ai-import/source-image-codec", () => ({
			createSourceImageCodec: initializeCodec,
		}));
		try {
			const { POST } = await import("../../../../frontend/app/api/ai/imports/sources/complete/route");
			const request = () => new Request("http://local/api/ai/imports/sources/complete", {
				method: "POST",
				body: JSON.stringify({ uploadId }),
			});
			const first = await POST(request());
			expect(first.status).toBe(503);
			const firstPayload = await first.json();
			expect(firstPayload).toEqual({ error: { code: "SOURCE_READ_FAILED" } });
			expect(JSON.stringify(firstPayload)).not.toContain("unsafe initialization detail");
			expect(routeBoundary.remove).not.toHaveBeenCalled();
			expect(routeBoundary.upload).not.toHaveBeenCalled();
			expect(routeBoundary.rpc).not.toHaveBeenCalled();

			const second = await POST(request());
			expect(second.status).toBe(200);
			expect(await second.json()).toEqual({ uploadId, status: "ready", path: sourcePath });
			expect(initializeCodec).toHaveBeenCalledTimes(2);
			expect(routeBoundary.remove).toHaveBeenCalledTimes(1);
			expect(routeBoundary.remove).toHaveBeenCalledWith([rawPath]);
			expect(routeBoundary.rpc.mock.calls.map(([name]) => name)).toEqual([
				"mark_ai_source_write_intent",
				"mark_ai_source_ready",
				"mark_ai_source_raw_deleted",
			]);
		} finally {
			vi.doUnmock("@/lib/ai-import/source-image-codec");
			vi.resetModules();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});

	it("R23-F3 M1 clears a rejected codec initialization while preserving successful concurrency cache", async () => {
		const module = {} as never;
		const loader = vi.fn()
			.mockRejectedValueOnce(new TypeError("unsafe initialization detail"))
			.mockResolvedValue(module);
		const createCodec = createSourceImageCodecFactory(loader);
		await expect(createCodec()).rejects.toThrow("IMAGE_CODEC_INITIALIZATION_FAILED");
		const [first, second] = await Promise.all([createCodec(), createCodec()]);
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(loader).toHaveBeenCalledTimes(2);
		await createCodec();
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("R23-F1 returns safe source failure and marks cleanup when non-OK body cancellation rejects", async () => {
		const uploadId = "22000000-0000-4000-8000-000000000023";
		const rawPath = `${OWNER_ID}/${uploadId}/raw`;
		const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
		query.select.mockReturnValue(query);
		query.eq.mockReturnValue(query);
		query.maybeSingle.mockResolvedValue({
			data: {
				id: uploadId,
				owner_user_id: OWNER_ID,
				status: "prepared",
				raw_storage_path: rawPath,
				mime_type: "image/png",
				byte_size: 1,
			},
			error: null,
		});
		routeBoundary.from.mockReturnValue(query);
		routeBoundary.rpc.mockResolvedValue({ data: null, error: null });
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cancel-test-anon");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cancel-test-service");
		vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
			cancel() {
				return Promise.reject(new TypeError("transport detail"));
			},
		}), { status: 503 }));
		try {
			const { POST } = await import("../../../../frontend/app/api/ai/imports/sources/complete/route");
			const response = await POST(new Request("http://local/api/ai/imports/sources/complete", {
				method: "POST",
				body: JSON.stringify({ uploadId }),
			}));
			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ error: { code: "SOURCE_READ_FAILED" } });
			expect(routeBoundary.rpc.mock.calls).toEqual([["mark_ai_upload_cleanup", {
				p_owner_user_id: OWNER_ID,
				p_upload_id: uploadId,
				p_source_path: null,
			}]]);
		} finally {
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});

	it("HI-08 rejects truncated bytes even when the magic prefix is present", async () => {
		await expect(
			sanitizeSourceImage(
				{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), declaredMime: "image/jpeg" },
				{
					decode: async () => ({ width: 128, height: 128 }),
					encodePng: async () => pngFixture(128, 128),
				}
			)
		).rejects.toThrow("IMAGE_DECODE_FAILED");
	});

	it("HI-08 persists only the re-encoded output, excluding EXIF metadata bytes", async () => {
		const jpegWithExif = sourceFixture("image/jpeg", true);
		const clean = pngFixture(128, 128);
		const result = await sanitizeSourceImage(
			{ bytes: jpegWithExif, declaredMime: "image/jpeg" },
			{ decode: async () => ({ width: 128, height: 128 }), encodePng: async () => clean }
		);
		expect(new TextDecoder().decode(result.bytes)).not.toContain("Exif");
	});

	it("HI-08 pinned ImageMagick WASM performs a real full decode and metadata-stripping encode", async () => {
		const bytes = Uint8Array.from(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64"
			)
		);
		const codec = await createSourceImageCodec();
		expect(await codec.decode(bytes)).toEqual({ width: 1, height: 1 });
		const encoded = await codec.encodePng({ bytes, width: 1, height: 1 });
		expect(encoded.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
	});

	it.each([
		["landscape", 4096, 64, 1024, 16],
		["portrait", 64, 4096, 16, 1024],
	] as const)(
		"P3-02 pinned ImageMagick codec normalizes a valid extreme-aspect %s input",
		async (_orientation, inputWidth, inputHeight, outputWidth, outputHeight) => {
			const codec = await createSourceImageCodec();
			const normalized = await normalizeIllustration(
				{ bytes: realPngFixture(inputWidth, inputHeight), declaredMime: "image/png" },
				codec
			);
			expect(normalized).toMatchObject({
				mime: "image/png",
				width: outputWidth,
				height: outputHeight,
			});
			expect(await codec.decode(normalized.bytes)).toEqual({
				width: outputWidth,
				height: outputHeight,
			});
		}
	);

	it("R5-F1 durably records terminal observability with a stable event ID before archive commit", async () => {
		const [migration, worker, logger] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/functions/_shared/ai-card-import/worker.ts",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/functions/_shared/ai-card-import/logger.ts",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.ai_worker_log_outbox");
		expect(migration).toMatch(/UNIQUE \(event_type, queue_message_id\)/u);
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.claim_ai_worker_log_outbox");
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.complete_ai_worker_log_outbox");
		expect(migration).toMatch(
			/ai_s11_record_worker_event[\s\S]+IF NOT pgmq\.archive\('ai_card_imports',p_message_id\)/u
		);
		expect(worker).toContain("dispatchPendingWorkerEvent");
		expect(logger).toContain("readonly eventId?: string");
		const lines: string[] = [];
		const safeLogger = createSafeLogger((line) => lines.push(line));
		const durableEvent: SafeLogEvent = {
			eventId: "22000000-0000-4000-8000-0000000000f1",
			event: "worker_failure",
			queueMessageId: 71,
			jobId: "22000000-0000-4000-8000-0000000000f2",
			errorCode: "PROVIDER_PERMANENT_ERROR",
		};
		safeLogger(durableEvent);
		safeLogger(durableEvent);
		expect(lines).toEqual([expect.stringContaining(durableEvent.eventId ?? "")]);
	});

	it("R11-F2 accepts every canonical safe code from the real outbox RPC adapter", async () => {
		for (const errorCode of SAFE_IMPORT_ERROR_CODES) {
			const database = createOutboxDatabase(errorCode);
			await expect(database.claimWorkerEvent(CLAIM_TOKEN)).resolves.toMatchObject({ errorCode });
		}
	});

	it.each([
		["null", null],
		["absent", undefined],
	] as const)("R11-F2 preserves %s outbox error-code semantics", async (_case, errorCode) => {
		const database = createOutboxDatabase(errorCode);
		await expect(database.claimWorkerEvent(CLAIM_TOKEN)).resolves.toEqual(
			expect.objectContaining({ errorCode: undefined })
		);
	});

	it.each([
		["unknown shaped string", "UNKNOWN_SAFE_SHAPED_CODE"],
		["number", 42],
		["record", { code: "INTERNAL_ERROR" }],
	] as const)("R11-F2 rejects an outbox %s outside the canonical allowlist", async (_case, errorCode) => {
		const database = createOutboxDatabase(errorCode);
		await expect(database.claimWorkerEvent(CLAIM_TOKEN)).rejects.toThrow("RPC_CONTRACT_ERROR");
	});

	it("R5-F2 fences every cleanup verify and completion with the exact claim UUID", async () => {
		const [migration, cleanup, adapter] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/functions/_shared/ai-card-import/cleanup.ts",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../supabase/functions/_shared/ai-card-import/supabase.ts",
					import.meta.url
				),
				"utf8"
			),
		]);
		expect(migration).toContain("ADD COLUMN IF NOT EXISTS cleanup_claim_token uuid");
		expect(migration).toContain("ADD COLUMN IF NOT EXISTS raw_cleanup_claim_token uuid");
		expect(migration).toContain("cleanup_claim_token uuid");
		expect(migration).toMatch(
			/verify_ai_import_cleanup\(\s*p_tracking_id uuid,p_bucket text,p_path text,p_claim_token uuid\s*\)/u
		);
		expect(migration).toMatch(
			/complete_ai_import_cleanup\(\s*p_tracking_id uuid,p_bucket text,p_path text,p_claim_token uuid,p_outcome text/u
		);
		expect(migration).toContain("MESSAGE='CLAIM_LOST'");
		expect(adapter).toContain("readonly claimToken: string");
		expect(adapter).toContain("p_claim_token: claim.claimToken");
		expect(cleanup).toContain("verifyCleanup(claim");
		expect(cleanup).toContain("completeCleanup(claim");
	});

	it("R5-F3 claims real source and raw objects independently in the first eligible cleanup run", async () => {
		const [migration, route, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../frontend/app/api/ai/imports/sources/complete/route.ts",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL("./s11-real-integration-gate.ts", import.meta.url),
				"utf8"
			),
		]);
		expect(migration).toMatch(
			/mark_ai_upload_cleanup\(\s*p_owner_user_id uuid,p_upload_id uuid,p_source_path text DEFAULT NULL\s*\)/u
		);
		expect(migration).not.toMatch(
			/source_storage_path=COALESCE\(\s*source_storage_path,\s*owner_user_id::text/u
		);
		expect(migration).not.toMatch(
			/AND NOT \(\s*uploads\.source_storage_path IS NOT NULL[\s\S]+uploads\.status IN \('prepared','ready','consumed','cleanup_pending','cleaning'\)\s*\)/u
		);
		expect(route).toContain('service.rpc("mark_ai_source_write_intent"');
		expect(route).toContain("await markCleanup(service, authData.user.id, uploadId, sourcePath)");
		expect(realGate).toContain("source-and-raw-first-run");
	});

	it("R6-F1 rejects every business side effect after the DB-clock claim expiry boundary", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.ai_s11_assert_active_claim");
		expect(migration.match(/PERFORM public\.ai_s11_assert_active_claim\(/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);
		expect(migration.match(/claim_expires_at>clock_timestamp\(\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
		expect(realGate).toContain("claim-expiry-side-effect-boundary");
	});

	it("R6-F2 registers the exact source write intent durably before the Storage write", async () => {
		const [migration, route, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(
				new URL(
					"../../../../frontend/app/api/ai/imports/sources/complete/route.ts",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("source_write_intent_path text");
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.mark_ai_source_write_intent");
		expect(route.indexOf('service.rpc("mark_ai_source_write_intent"')).toBeGreaterThan(-1);
		expect(route.indexOf('service.rpc("mark_ai_source_write_intent"')).toBeLessThan(
			route.indexOf("bucket.upload(sourcePath")
		);
		expect(migration).toContain("COALESCE(uploads.source_storage_path,uploads.source_write_intent_path)");
		expect(realGate).toContain("source-write-intent-ambiguous-cleanup");
	});

	it("R6-F3 applies cleanup LIMIT to entities before expanding a due source/raw pair", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("upload_entity_candidates AS");
		expect(migration).toContain("selected_entities AS");
		expect(realGate).toContain("cleanup-entity-limit-pair-expansion");
	});

	it("R6-F4 rejects cleanup completion after the DB-clock five-minute lease expires", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("cleanup_claimed_at>clock_timestamp()-interval '5 minutes'");
		expect(migration).toContain("raw_cleanup_claimed_at>clock_timestamp()-interval '5 minutes'");
		expect(realGate).toContain("cleanup-complete-expiry-fence");
	});

	it("R6-F5 atomically makes a deleted illustration nonattachable", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(
				new URL(
					"../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql",
					import.meta.url
				),
				"utf8"
			),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toMatch(
			/UPDATE public\.illustrations[\s\S]+status='failed'[\s\S]+storage_path=NULL/u
		);
		expect(realGate).toContain("deleted-illustration-reattach-rejected");
	});

	it("R7-F1 enforces cleanup-deleted illustration lifecycle across owner REST, attach, service cleanup, and legitimate updates", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain(
			"CREATE OR REPLACE FUNCTION public.ai_s11_guard_illustration_lifecycle"
		);
		expect(migration).toContain("CREATE TRIGGER ai_s11_guard_illustration_lifecycle");
		expect(migration).toContain("object_row.state<>'ready'");
		expect(migration).toMatch(/object_row\.illustration_status<>'ready' OR object_row\.illustration_storage_path IS NULL/u);
		for (const marker of ["owner-rest-resurrection-rejected", "deleted-attach-rejected", "service-cleanup-lifecycle", "nondeleted-owner-update-allowed"]) expect(realGate).toContain(marker);
	});

	it("R7-F2 removes caller-authoritative time from concept claims and all business claim fences", async () => {
		const [migration, adapter, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/functions/_shared/ai-card-import/supabase.ts", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("claim_ai_import_concept(\n  p_job_id uuid, p_message_id bigint, p_claim_token uuid\n)");
		expect(migration).not.toMatch(/claim_ai_import_concept\([\s\S]{0,160}p_now/u);
		expect(adapter).not.toContain("p_now: args.now");
		expect(realGate).toContain("db-clock-concept-malicious-time-ignored");
	});

	it("R7-F3 removes caller-authoritative time from cleanup claim, verification, and completion", async () => {
		const [migration, adapter, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/functions/_shared/ai-card-import/supabase.ts", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("claim_ai_import_cleanup(p_limit integer)");
		expect(migration).toContain("p_tracking_id uuid,p_bucket text,p_path text,p_claim_token uuid\n)");
		expect(adapter).not.toMatch(/claim_ai_import_cleanup[^\n]+p_now/u);
		expect(adapter).not.toContain("p_now: now");
		expect(realGate).toContain("db-clock-cleanup-malicious-time-ignored");
	});

	it("R7-F4 bounds the actual source Storage Response stream before Blob materialization", async () => {
		const route = await import("../../../../frontend/app/api/ai/imports/sources/complete/route");
		expect(route.readSourceResponseWithLimit).toBeTypeOf("function");
		if (typeof route.readSourceResponseWithLimit !== "function") return;
		for (const mode of ["missing", "lying"] as const) {
			let cancelled = false;
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.enqueue(new Uint8Array(6));
				},
				cancel() { cancelled = true; },
			});
			const response = new Response(stream, { headers: mode === "lying" ? { "Content-Length": "1" } : undefined });
			await expect(route.readSourceResponseWithLimit(response, 10)).rejects.toThrow("IMAGE_TOO_LARGE");
			expect(cancelled).toBe(true);
		}
		const source = await readFile(new URL("../../../../frontend/app/api/ai/imports/sources/complete/route.ts", import.meta.url), "utf8");
		expect(source).not.toContain("bucket.download(");
	});

	it("R7-F5 invokes the repository shared prompt-safety policy for S-11 claims", async () => {
		const database = createSupabaseDatabase({
			supabaseUrl: "http://supabase.local",
			serviceRoleKey: "service-fixture",
			fetchImplementation: async () => Response.json({
				outcome: "claimed", jobId: BATCH_ID, batchId: BATCH_ID,
				claimToken: OWNER_ID, attempt: 0, imageMode: "ai",
				backText: `雨\u0000${"あ".repeat(150)}`, skill: "reading",
			}),
		});
		const claim = await database.claim({ jobId: BATCH_ID, messageId: 1, claimToken: OWNER_ID });
		expect(claim.outcome).toBe("claimed");
		if (claim.outcome === "claimed") {
			expect(claim.prompt).not.toContain("\u0000");
			expect(claim.prompt).toContain("あ".repeat(98));
			expect(claim.prompt).toContain("不適切表現は禁止");
		}
		const migration = await readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8");
		expect(migration).not.toContain("Simple child-friendly illustration for:");
	});

	it("R7-F6 removes caller time from outbox claim/reclaim and DB-clock fences completion", async () => {
		const [migration, adapter, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/functions/_shared/ai-card-import/supabase.ts", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("claim_ai_worker_log_outbox(p_claim_token uuid)");
		expect(migration).toMatch(/complete_ai_worker_log_outbox[\s\S]+dispatch_claimed_at>clock_timestamp\(\)-interval '5 minutes'/u);
		expect(adapter).not.toContain("p_now: now");
		expect(realGate).toContain("db-clock-outbox-malicious-time-ignored");
	});

	it("R8-F1 preserves shared illustration readiness until the last reference and atomically fences pending re-reference", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toMatch(/ai_s11_track_card_reference_removal[\s\S]+reference_count=object_row\.reference_count-1[\s\S]+object_row\.reference_count=1/u);
		expect(migration).toMatch(/object_row\.state='delete_pending'[\s\S]+cleanup_claim_token IS NULL[\s\S]+SET state='ready'/u);
		for (const marker of [
			"shared-reference-two-to-one-ready",
			"shared-reference-third-s10-attach",
			"last-reference-delete-pending",
			"pending-rereference-cleanup-fenced",
		]) expect(realGate).toContain(marker);
	});

	it("R9-F1 uses one card-to-lifecycle lock order without sibling-card inversion", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("reference_count bigint NOT NULL DEFAULT 0");
		expect(migration).not.toMatch(/FROM public\.cards remaining[\s\S]{0,180}FOR UPDATE/u);
		expect(migration).toMatch(/array_agg\(objects\.id ORDER BY objects\.id\)[\s\S]+WHERE objects\.id=target_id FOR UPDATE/u);
		expect(migration).toMatch(/reference_count=object_row\.reference_count-1[\s\S]+object_row\.reference_count=1/u);
		for (const marker of [
			"shared-delete-delete-no-deadlock",
			"shared-delete-attach-no-deadlock",
			"shared-lock-timeout-bounded",
		]) expect(realGate).toContain(marker);
	});

	it("R10-F1 applies cards -> illustrations -> lifecycle tracking across every mutation and cleanup path", async () => {
		const [s10Migration, migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql", import.meta.url), "utf8"),
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.ai_s11_lock_illustration_lifecycle");
		const helperStart = migration.indexOf(
			"CREATE OR REPLACE FUNCTION public.ai_s11_lock_illustration_lifecycle"
		);
		const helperEnd = migration.indexOf("$$;", helperStart);
		const helper = migration.slice(helperStart, helperEnd);
		expect(helper.indexOf("FROM public.illustrations")).toBeGreaterThanOrEqual(0);
		expect(helper.indexOf("FROM public.ai_illustration_objects")).toBeGreaterThan(
			helper.indexOf("FROM public.illustrations")
		);
		for (const functionName of [
			"ai_s11_fail_concept_locked",
			"finalize_ai_import_concept",
			"ai_s11_guard_illustration_lifecycle",
			"ai_s11_guard_illustration_reference",
			"verify_ai_import_cleanup",
			"complete_ai_import_cleanup",
		]) {
			const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
			const body = migration.slice(start, migration.indexOf("$$;", start));
			expect(body, functionName).toContain("ai_s11_lock_illustration_lifecycle");
		}
		const attachStart = s10Migration.indexOf("CREATE FUNCTION public.set_card_illustration_internal");
		const attachBody = s10Migration.slice(attachStart, s10Migration.indexOf("$$;", attachStart));
		expect(attachBody.indexOf("FROM public.cards")).toBeLessThan(
			attachBody.indexOf("FROM public.illustrations")
		);
		for (const marker of [
			"complete-attach-attach-first-no-40p01",
			"complete-attach-complete-first-no-40p01",
			"complete-attach-serializable-winner",
		]) expect(realGate).toContain(marker);
	});

	it("R10-R1-F1 locks both old and new illustrations before a different-key S-10 attach", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		const overrideStart = migration.indexOf(
			"CREATE OR REPLACE FUNCTION public.set_card_illustration_internal"
		);
		expect(overrideStart).toBeGreaterThanOrEqual(0);
		const overrideBody = migration.slice(overrideStart, migration.indexOf("$$;", overrideStart));
		expect(overrideBody).toContain("locked_card.illustration_key");
		expect(overrideBody).toContain("p_illustration_id");
		expect(overrideBody).toMatch(/array_agg\(DISTINCT illustrations\.id ORDER BY illustrations\.id\)/u);
		expect(overrideBody.indexOf("ai_s11_lock_illustration_lifecycle")).toBeLessThan(
			overrideBody.indexOf("UPDATE public.cards")
		);
		for (const marker of [
			"cross-swap-a-first-no-40p01",
			"cross-swap-b-first-no-40p01",
			"cross-swap-serializable-outcome",
		]) expect(realGate).toContain(marker);
	});

	it("R10-R2-F1 uses caller JWT role, not SECURITY DEFINER current_user, for deleted lifecycle fencing", async () => {
		const [migration, realGate] = await Promise.all([
			readFile(new URL("../../../../supabase/migrations/20260715000000_s11_ai_card_async_processing.sql", import.meta.url), "utf8"),
			readFile(new URL("./s11-real-integration-gate.ts", import.meta.url), "utf8"),
		]);
		const guardStart = migration.indexOf(
			"CREATE OR REPLACE FUNCTION public.ai_s11_guard_illustration_lifecycle"
		);
		const guardBody = migration.slice(guardStart, migration.indexOf("$$;", guardStart));
		expect(guardBody).not.toContain("current_user");
		expect(guardBody).toContain(
			"current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'"
		);
		for (const marker of [
			"owner-rest-resurrection-rejected",
			"service-cleanup-lifecycle",
			"nondeleted-owner-update-allowed",
			"deleted-illustration-reattach-rejected",
		]) expect(realGate).toContain(marker);
	});
});

function sourceFixture(mime: "image/png" | "image/jpeg" | "image/webp", exif = false): Uint8Array {
	if (mime === "image/png") return pngFixture(128, 128);
	if (mime === "image/webp") {
		const bytes = new Uint8Array(30);
		bytes.set(new TextEncoder().encode("RIFF"), 0);
		bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
		bytes[24] = 127;
		bytes[27] = 127;
		return bytes;
	}
	const prefix = exif ? [0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0] : [0xff, 0xd8];
	return new Uint8Array([...prefix, 0xff, 0xc0, 0, 8, 8, 0, 128, 0, 128, 0]);
}

function realPngFixture(width: number, height: number): Uint8Array {
	const raw = new Uint8Array(height * (1 + width * 4));
	for (let y = 0; y < height; y += 1) {
		const row = y * (1 + width * 4);
		raw[row] = 0;
		for (let x = 0; x < width; x += 1) raw[row + 1 + x * 4 + 3] = 255;
	}
	const ihdr = new Uint8Array(13);
	writeU32(ihdr, 0, width);
	writeU32(ihdr, 4, height);
	ihdr.set([8, 6, 0, 0, 0], 8);
	return concatBytes(
		new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
		pngChunk("IEND", new Uint8Array())
	);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new TextEncoder().encode(type);
	const chunk = new Uint8Array(12 + data.byteLength);
	writeU32(chunk, 0, data.byteLength);
	chunk.set(typeBytes, 4);
	chunk.set(data, 8);
	writeU32(chunk, 8 + data.byteLength, crc32(concatBytes(typeBytes, data)));
	return chunk;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = (value >>> 24) & 255;
	bytes[offset + 1] = (value >>> 16) & 255;
	bytes[offset + 2] = (value >>> 8) & 255;
	bytes[offset + 3] = value & 255;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

async function validCommitRequest(suffix: string): Promise<Request> {
	const secret = "s11-route-preview-secret-with-at-least-32-bytes";
	process.env.AI_PREVIEW_HMAC_SECRET = secret;
	const request = {
		deck: { create: { name: `Async ${suffix}` } },
		items: [
			{
				clientItemId: `r-${suffix}`,
				conceptId: `c-${suffix}`,
				pattern: "R1" as const,
				front: "漢字",
				back: "かんじ",
				tags: [],
				image: { mode: "none" as const },
			},
		],
	};
	const importRequestHash = await hashImportRequest(request);
	const cardReservationKey = `reservation-${suffix}`;
	const previewToken = await signPreviewToken(
		{ userId: OWNER_ID, reservationKey: cardReservationKey, importRequestHash },
		secret,
		Math.floor(Date.now() / 1000)
	);
	return new Request("http://local/api/ai/imports/commit", {
		method: "POST",
		body: JSON.stringify({
			idempotencyKey: `idem-${suffix}`,
			importRequestHash,
			cardReservationKey,
			previewToken,
			request,
		}),
	});
}

function sourcePrepareRequest(sourceCount: number): Request {
	return new Request("http://local/api/ai/imports/sources/prepare", {
		method: "POST",
		body: JSON.stringify({
			sources: Array.from({ length: sourceCount }, (_, index) => ({
				uploadKey: `source-${index + 1}`,
				declaredMime: "image/png",
				byteSize: 1,
			})),
		}),
	});
}

async function runQueueRpcThroughWorkerHandler(queueResponse: unknown): Promise<{
	readonly response: Response;
	readonly logs: readonly string[];
}> {
	const logs: string[] = [];
	const logger = createSafeLogger((line) => logs.push(line));
	const database = createSupabaseDatabase({
		supabaseUrl: "http://supabase.local",
		serviceRoleKey: "service-fixture",
		fetchImplementation: async (input) => {
			const url = String(input);
			if (url.endsWith("/claim_ai_worker_log_outbox")) {
				return Response.json({ outcome: "empty" });
			}
			if (url.endsWith("/read_ai_import_queue")) {
				return new Response(JSON.stringify(queueResponse), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw new Error("unexpected RPC");
		},
	});
	const harness = createWorkerHarness();
	const { handleWorkerRequest } = await import(
		"../../../../supabase/functions/_shared/ai-card-import/worker-entrypoint.ts"
	);
	const response = await handleWorkerRequest(
		new Request("http://worker.local", {
			method: "POST",
			headers: { "x-ai-worker-secret": "configured-secret" },
		}),
		{
			workerSecret: () => "configured-secret",
			execute: async () =>
				await processOneConcept({ ...harness.dependencies, database, log: logger }),
			log: logger,
		}
	);
	return { response, logs };
}

function createOutboxDatabase(errorCode: unknown) {
	const event = {
		outcome: "claimed",
		eventId: "22000000-0000-4000-8000-0000000000f1",
		event: "worker_failure",
		queueMessageId: 71,
		...(errorCode === undefined ? {} : { errorCode }),
	};
	return createSupabaseDatabase({
		supabaseUrl: "http://supabase.local",
		serviceRoleKey: "service-fixture",
		fetchImplementation: async () => Response.json(event),
	});
}

function oversizedStorageResponse(mode: "declared" | "missing" | "lying"): Response {
	if (mode === "declared") {
		return new Response(new Uint8Array([1]), {
			status: 200,
			headers: { "Content-Length": String(10 * 1024 * 1024 + 1) },
		});
	}
	const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) {
			controller.enqueue(new Uint8Array(new ArrayBuffer(6 * 1024 * 1024)));
			controller.enqueue(new Uint8Array(new ArrayBuffer(5 * 1024 * 1024)));
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: mode === "lying" ? { "Content-Length": "1" } : undefined,
	});
}

function midStreamFailureResponse(): Response {
	return new Response(new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([123]));
			controller.error(new TypeError("transport detail"));
		},
	}), { status: 200 });
}

function workerFailureLogs(logs: readonly string[]): Record<string, unknown>[] {
	return logs
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((entry) => entry.event === "worker_failure");
}

function workerRecoverableLogs(logs: readonly string[]): Record<string, unknown>[] {
	return logs
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((entry) => entry.event === "worker_recoverable");
}

function workerEventLogs(logs: readonly string[], event: string): Record<string, unknown>[] {
	return logs
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((entry) => entry.event === event);
}
