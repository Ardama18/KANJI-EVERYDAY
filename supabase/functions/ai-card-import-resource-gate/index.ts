import { normalizeIllustration } from "../_shared/ai-card-import/image-codec.ts";
import { createMagickCodec } from "../_shared/ai-card-import/magick-codec.ts";
import { ILLUSTRATION_PROVIDER_TIMEOUT_MS } from "../_shared/ai-card-import/provider.ts";
import { createOpenAiProvider } from "../_shared/ai-card-import/providers/openai.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const configuredPort = Number(Deno.env.get("S11_RESOURCE_PORT") ?? "8000");

Deno.serve({ hostname: "127.0.0.1", port: configuredPort }, async (request) => {
	if (request.method === "GET" && new URL(request.url).pathname === "/health") {
		return new Response(null, { status: 204 });
	}
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const secret = Deno.env.get("AI_CARD_WORKER_SECRET");
	const presentedSecret = request.headers.get("x-ai-worker-secret");
	if (
		secret === undefined ||
		secret.trim().length === 0 ||
		presentedSecret === undefined ||
		presentedSecret.trim().length === 0 ||
		presentedSecret !== secret
	) {
		return new Response(null, { status: 401 });
	}
	const started = performance.now();
	let peakRssBytes = Deno.memoryUsage().rss;
	const observeResource = (): void => {
		peakRssBytes = Math.max(peakRssBytes, Deno.memoryUsage().rss);
	};
	const sampler = setInterval(observeResource, 10);
	try {
		const wasmPath = requiredEnvironment("S11_RESOURCE_WASM_PATH");
		const codec = await createMagickCodec({
			wasmBytes: await Deno.readFile(wasmPath),
			observeResource,
		});
		const resourceCase = request.headers.get("x-resource-case") ?? "codec";
		if (resourceCase.startsWith("provider-")) {
			const providerBaseUrl = requiredEnvironment("S11_RESOURCE_PROVIDER_BASE_URL");
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), ILLUSTRATION_PROVIDER_TIMEOUT_MS);
			try {
				const provider = createOpenAiProvider({
					apiKey: "resource-gate-local-only",
					model: "resource-gate-local-only",
					endpoint: `${providerBaseUrl}/${resourceCase}`,
				});
				const result = await provider.generate({
					prompt: "resource-gate-local-only",
					signal: controller.signal,
				});
				observeResource();
				if (resourceCase === "provider-timeout") {
					if (result.kind !== "transient" || !controller.signal.aborted) {
						return Response.json({ errorCode: "PROVIDER_TIMEOUT_NOT_ENFORCED" }, { status: 500 });
					}
					return Response.json(
						{
							status: "provider_timeout",
							processingMs: performance.now() - started,
							peakRssBytes,
						},
						{ status: 504 }
					);
				}
				if (
					resourceCase === "provider-oversized-base64" ||
					resourceCase === "provider-missing-content-length" ||
					resourceCase === "provider-declared-oversized"
				) {
					if (result.kind !== "permanent" || result.code !== "IMAGE_TOO_LARGE") {
						return Response.json({ errorCode: "PROVIDER_BOUND_NOT_ENFORCED" }, { status: 500 });
					}
					return Response.json({
						status: "provider_rejected",
						errorCode: result.code,
						processingMs: performance.now() - started,
						peakRssBytes,
					}, { status: 422 });
				}
				if (result.kind !== "success" || result.bytes.byteLength !== MAX_BYTES) {
					return Response.json({ errorCode: "PROVIDER_MAX_RESPONSE_INVALID" }, { status: 502 });
				}
				return await processImage({
					bytes: result.bytes,
					declaredMime: result.declaredMime,
					requireMaximumPixels: true,
					codec,
					started,
					peakRssBytes: () => peakRssBytes,
					observeResource,
					status: "provider_processed",
				});
			} finally {
				clearTimeout(timeout);
			}
		}
		if (resourceCase !== "codec") {
			return Response.json({ errorCode: "RESOURCE_CASE_INVALID" }, { status: 400 });
		}
		const declaredMime = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
		const contentLength = Number(request.headers.get("content-length"));
		if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_BYTES) {
			return Response.json({ errorCode: "IMAGE_TOO_LARGE" }, { status: 413 });
		}
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.byteLength !== contentLength || bytes.byteLength > MAX_BYTES) {
			return Response.json({ errorCode: "IMAGE_TOO_LARGE" }, { status: 413 });
		}
		return await processImage({
			bytes,
			declaredMime,
			requireMaximumPixels: request.headers.get("x-require-max-fixture") === "true",
			codec,
			started,
			peakRssBytes: () => peakRssBytes,
			observeResource,
			status: "processed",
		});
	} catch (error) {
		observeResource();
		if (error instanceof Error && error.message === "IMAGE_DECODE_FAILED") {
			return Response.json(
				{
					status: "image_decode_failed",
					errorCode: "IMAGE_DECODE_FAILED",
					processingMs: performance.now() - started,
					peakRssBytes,
				},
				{ status: 422 }
			);
		}
		return Response.json({ errorCode: "RESOURCE_PROCESSING_FAILED" }, { status: 500 });
	} finally {
		clearInterval(sampler);
	}
});

async function processImage(input: {
	readonly bytes: Uint8Array;
	readonly declaredMime: string;
	readonly requireMaximumPixels: boolean;
	readonly codec: Awaited<ReturnType<typeof createMagickCodec>>;
	readonly started: number;
	readonly peakRssBytes: () => number;
	readonly observeResource: () => void;
	readonly status: "processed" | "provider_processed";
}): Promise<Response> {
	let decoded: Awaited<ReturnType<typeof input.codec.decode>>;
	try {
		decoded = await input.codec.decode(input.bytes);
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	if (input.requireMaximumPixels && decoded.width * decoded.height !== MAX_PIXELS) {
		return Response.json({ errorCode: "RESOURCE_FIXTURE_INVALID" }, { status: 422 });
	}
	const normalized = await normalizeIllustration(
		{ bytes: input.bytes, declaredMime: input.declaredMime },
		input.codec
	);
	input.observeResource();
	return Response.json({
		status: input.status,
		inputBytes: input.bytes.byteLength,
		inputWidth: decoded.width,
		inputHeight: decoded.height,
		outputBytes: normalized.bytes.byteLength,
		outputWidth: normalized.width,
		outputHeight: normalized.height,
		processingMs: performance.now() - input.started,
		peakRssBytes: input.peakRssBytes(),
	});
}

function requiredEnvironment(name: string): string {
	const value = Deno.env.get(name)?.trim();
	if (value === undefined || value.length === 0) throw new Error("RESOURCE_ENVIRONMENT_MISSING");
	return value;
}
