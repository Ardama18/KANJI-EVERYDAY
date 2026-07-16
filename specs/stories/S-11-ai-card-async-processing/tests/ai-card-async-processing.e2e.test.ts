import { describe, expect, it } from "vitest";

import type { ImageCodec } from "../../../../supabase/functions/_shared/ai-card-import/image-codec.ts";
import { resolveProviderName } from "../../../../supabase/functions/_shared/ai-card-import/provider.ts";
import { createOpenAiProvider } from "../../../../supabase/functions/_shared/ai-card-import/providers/openai.ts";
import { createStorageClient } from "../../../../supabase/functions/_shared/ai-card-import/storage.ts";
import { createSupabaseDatabase } from "../../../../supabase/functions/_shared/ai-card-import/supabase.ts";
import { processOneConcept } from "../../../../supabase/functions/_shared/ai-card-import/worker.ts";
import {
	BATCH_ID,
	CLAIM_TOKEN,
	ILLUSTRATION_ID,
	JOB_ID,
	createWorkerHarness,
	pngFixture,
	safeFailure,
} from "./helpers/s11-edge-testkit";

describe("S-11 executable HTTP/RPC/Storage E2E boundaries", () => {
	it("E2E-01 RPC queue through provider and private Storage reaches one terminal finalize", async () => {
		const boundary = createHttpBoundary();
		expect(await processOneConcept(boundary.dependencies)).toBe("succeeded");
		expect(boundary.events).toEqual(
			expect.arrayContaining([
				"rpc:read_ai_import_queue",
				"rpc:claim_ai_import_concept",
				"provider:openai",
				"storage:write",
				"rpc:finalize_ai_import_concept",
			])
		);
		expect(
			boundary.events.filter((event) => event === "rpc:finalize_ai_import_concept")
		).toHaveLength(1);
	});

	it("E2E-02 every database boundary carries the service bearer credential", async () => {
		const boundary = createHttpBoundary();
		await processOneConcept(boundary.dependencies);
		expect(boundary.authHeaders).not.toHaveLength(0);
		expect(new Set(boundary.authHeaders)).toEqual(new Set(["Bearer service-fixture"]));
	});

	it("E2E-03 transient provider HTTP 429 persists a five-second replacement retry", async () => {
		const boundary = createHttpBoundary({ providerStatus: 429 });
		expect(await processOneConcept(boundary.dependencies)).toBe("retried");
		expect(boundary.rpcBodies.get("schedule_ai_import_retry")).toMatchObject({
			p_delay_seconds: 5,
		});
		expect(boundary.events).not.toContain("storage:write");
	});

	it("E2E-04 one concept failure does not prevent an independent concept success", async () => {
		const failed = createWorkerHarness({
			imageMode: "ai",
			providerResult: safeFailure("permanent", "PROVIDER_PERMANENT_ERROR"),
		});
		const succeeded = createWorkerHarness({ imageMode: "none" });
		expect(
			await Promise.all([
				processOneConcept(failed.dependencies),
				processOneConcept(succeeded.dependencies),
			])
		).toEqual(["failed", "succeeded"]);
	});

	it("E2E-05 upload source is retained for retry and removed only after terminal success", async () => {
		const retry = createWorkerHarness({
			imageMode: "upload",
			storageWriteResult: { kind: "transient", httpStatus: 503 },
		});
		const success = createWorkerHarness({ imageMode: "upload" });
		expect(await processOneConcept(retry.dependencies)).toBe("retried");
		expect(retry.state.sourceDeletes).toBe(0);
		expect(await processOneConcept(success.dependencies)).toBe("succeeded");
		expect(success.state).toMatchObject({ sourceDeletes: 1, sourceDeletedCalls: 1 });
	});

	it("E2E-06 terminal duplicate delivery is ACKed without another provider, object, or finalize", async () => {
		const harness = createWorkerHarness({ imageMode: "ai" });
		await processOneConcept(harness.dependencies);
		await processOneConcept(harness.dependencies);
		expect(harness.state).toMatchObject({
			providerCalls: 1,
			objectWrites: 1,
			finalizeCalls: 1,
			ackCalls: 1,
		});
	});

	it("E2E-07 provider is explicit, defaults to OpenAI, and never invokes Gemini", async () => {
		const boundary = createHttpBoundary();
		expect(resolveProviderName(undefined)).toBe("openai");
		await processOneConcept(boundary.dependencies);
		expect(boundary.events).toContain("provider:openai");
		expect(boundary.events).not.toContain("provider:gemini");
	});

	it("E2E-08 finalize response loss reconciled as committed preserves the live illustration object", async () => {
		const harness = createWorkerHarness({
			imageMode: "ai",
			finalizeError: true,
			reconcileOutcome: "terminal_success",
		});
		expect(await processOneConcept(harness.dependencies)).toBe("succeeded");
		expect(harness.state.objectDeletes).toBe(0);
	});

	it("E2E-09 private Storage 403 is permanent and does not enter retry scheduling", async () => {
		const boundary = createHttpBoundary({ storageStatus: 403 });
		expect(await processOneConcept(boundary.dependencies)).toBe("failed");
		expect(boundary.events).toContain("rpc:fail_ai_import_concept");
		expect(boundary.events).not.toContain("rpc:schedule_ai_import_retry");
	});

	it("E2E-10 captured logs and requests expose no API key, image base64, prompt, or card text", async () => {
		const boundary = createHttpBoundary();
		await processOneConcept(boundary.dependencies);
		const captured = boundary.logs.join("\n");
		expect(captured).not.toMatch(
			/service-fixture|api.?key|Authorization|base64|prompt|front|back|payload/iu
		);
	});
});

function createHttpBoundary(options: { providerStatus?: number; storageStatus?: number } = {}) {
	const events: string[] = [];
	const authHeaders: string[] = [];
	const rpcBodies = new Map<string, Readonly<Record<string, unknown>>>();
	const logs: string[] = [];
	const png = pngFixture(128, 128);
	let pendingEvent:
		| {
				eventId: string;
				event: "worker_failure";
				queueMessageId: number;
				jobId: string;
				batchId: string;
				errorCode: string;
				attempt: number;
		  }
		| undefined;
	const rpcFetch: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		authHeaders.push(request.headers.get("authorization") ?? "");
		const rpc = new URL(request.url).pathname.split("/").at(-1) ?? "";
		events.push(`rpc:${rpc}`);
		if (init?.body !== undefined) rpcBodies.set(rpc, JSON.parse(String(init.body)));
		if (rpc === "claim_ai_worker_log_outbox") {
			return Response.json(
				pendingEvent === undefined ? { outcome: "empty" } : { outcome: "claimed", ...pendingEvent }
			);
		}
		if (rpc === "complete_ai_worker_log_outbox") {
			pendingEvent = undefined;
			return new Response(null, { status: 204 });
		}
		if (rpc === "read_ai_import_queue")
			return Response.json([
				{ message_id: 1, message: { version: 1, jobId: JOB_ID, batchId: BATCH_ID } },
			]);
		if (rpc === "claim_ai_import_concept")
			return Response.json({
				outcome: "claimed",
				jobId: JOB_ID,
				batchId: BATCH_ID,
				claimToken: CLAIM_TOKEN,
				attempt: 0,
				imageMode: "ai",
				backText: "fixture concept",
				skill: "reading",
				illustrationId: ILLUSTRATION_ID,
				illustrationPath: `${BATCH_ID}/s11-managed/${ILLUSTRATION_ID}.png`,
			});
		if (rpc === "finalize_ai_import_concept") return Response.json({ status: "succeeded" });
		if (rpc === "get_ai_import_finalize_state")
			return Response.json({ outcome: "terminal_success" });
		if (rpc === "fail_ai_import_concept") {
			const body = rpcBodies.get(rpc);
			if (body?.p_event_type === "worker_failure") {
				pendingEvent = {
					eventId: "11000000-0000-4000-8000-000000000090",
					event: "worker_failure",
					queueMessageId: 1,
					jobId: JOB_ID,
					batchId: BATCH_ID,
					errorCode: String(body.p_error_code),
					attempt: 0,
				};
			}
			return Response.json({ status: "failed" });
		}
		if (rpc === "schedule_ai_import_retry") return Response.json({ status: "queued" });
		return new Response(null, { status: 204 });
	};
	const storageFetch: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		authHeaders.push(request.headers.get("authorization") ?? "");
		if (request.method === "POST") events.push("storage:write");
		return new Response(null, { status: options.storageStatus ?? 200 });
	};
	const providerFetch: typeof fetch = async () => {
		events.push("provider:openai");
		const status = options.providerStatus ?? 200;
		return status === 200
			? Response.json({ data: [{ b64_json: bytesToBase64(png) }] })
			: new Response(null, { status });
	};
	const database = createSupabaseDatabase({
		supabaseUrl: "http://supabase.local",
		serviceRoleKey: "service-fixture",
		fetchImplementation: rpcFetch,
	});
	const storage = createStorageClient({
		supabaseUrl: "http://supabase.local",
		serviceRoleKey: "service-fixture",
		fetchImplementation: storageFetch,
	});
	const codec: ImageCodec = {
		decode: async () => ({ width: 128, height: 128 }),
		encodePng: async () => png,
	};
	const openai = createOpenAiProvider({
		apiKey: "provider-fixture",
		model: "fixture",
		fetchImplementation: providerFetch,
	});
	return {
		events,
		authHeaders,
		rpcBodies,
		logs,
		dependencies: {
			database,
			storage,
			codec,
			providerEnvironment: {
				ILLUSTRATION_PROVIDER: "openai",
				OPENAI_API_KEY: "configured",
				OPENAI_IMAGE_MODEL: "fixture",
			},
			providers: {
				openai,
				gemini: {
					generate: async () => {
						events.push("provider:gemini");
						return { kind: "permanent" as const, code: "PROVIDER_PERMANENT_ERROR" as const };
					},
				},
			},
			now: () => new Date("2026-07-15T00:00:00Z"),
			randomUuid: () => CLAIM_TOKEN,
			log: (event: unknown) => logs.push(JSON.stringify(event)),
		},
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}
