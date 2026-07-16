import { describe, expect, it, vi } from "vitest";

import type {
	IllustrationProvider,
	ProviderResult,
} from "../../../../supabase/functions/_shared/ai-card-import/contracts.ts";
import {
	type ImageCodec,
	normalizeIllustration,
} from "../../../../supabase/functions/_shared/ai-card-import/image-codec.ts";
import {
	MAX_IMAGE_BYTES,
	inspectImage,
} from "../../../../supabase/functions/_shared/ai-card-import/image-validation.ts";
import { createSafeLogger } from "../../../../supabase/functions/_shared/ai-card-import/logger.ts";
import {
	generateWithSelectedProvider,
	resolveProviderEndpointBinding,
	resolveProviderName,
} from "../../../../supabase/functions/_shared/ai-card-import/provider.ts";
import {
	classifyFailure,
	retryDelaySeconds,
} from "../../../../supabase/functions/_shared/ai-card-import/retry-policy.ts";

function png(width: number, height: number, byteLength = 24): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	writeU32Be(bytes, 16, width);
	writeU32Be(bytes, 20, height);
	return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xc0,
		0x00,
		0x11,
		0x08,
		(height >> 8) & 0xff,
		height & 0xff,
		(width >> 8) & 0xff,
		width & 0xff,
		0x03,
		0x01,
		0x11,
		0x00,
		0x02,
		0x11,
		0x00,
		0x03,
		0x11,
		0x00,
	]);
}

function webp(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
	writeU24Le(bytes, 24, width - 1);
	writeU24Le(bytes, 27, height - 1);
	return bytes;
}

function provider(result: ProviderResult): IllustrationProvider {
	return { generate: vi.fn(async () => result) };
}

describe("S-11 image validation", () => {
	it("#1 accepts PNG magic bytes that match the declared MIME", () => {
		expect(inspectImage(png(64, 64), "image/png", { illustration: true })).toEqual({
			ok: true,
			mime: "image/png",
			width: 64,
			height: 64,
		});
	});

	it("#2 accepts JPEG magic bytes that match the declared MIME", () => {
		expect(inspectImage(jpeg(640, 480), "image/jpeg")).toMatchObject({
			ok: true,
			width: 640,
			height: 480,
		});
	});

	it("#3 accepts WebP magic bytes that match the declared MIME", () => {
		expect(inspectImage(webp(320, 240), "image/webp")).toMatchObject({
			ok: true,
			width: 320,
			height: 240,
		});
	});

	it("#4 rejects a declared MIME that disagrees with magic bytes", () => {
		expect(inspectImage(png(64, 64), "image/jpeg")).toEqual({
			ok: false,
			code: "IMAGE_FORMAT_INVALID",
		});
	});

	it("#5 rejects bytes above the 10 MiB boundary", () => {
		expect(inspectImage(png(64, 64, MAX_IMAGE_BYTES + 1), "image/png")).toEqual({
			ok: false,
			code: "IMAGE_TOO_LARGE",
		});
	});

	it("#6 rejects decoded dimensions above 16 megapixels", () => {
		expect(inspectImage(png(4001, 4000), "image/png")).toEqual({
			ok: false,
			code: "IMAGE_DIMENSIONS_INVALID",
		});
	});

	it("#7 rejects an illustration edge below 64 pixels", () => {
		expect(inspectImage(png(63, 128), "image/png", { illustration: true })).toEqual({
			ok: false,
			code: "IMAGE_DIMENSIONS_INVALID",
		});
	});

	it("#8 normalizes to a metadata-free PNG no larger than 1024 pixels", async () => {
		const encoded = png(1024, 512);
		const codec: ImageCodec = {
			decode: vi.fn(async () => ({ width: 2048, height: 1024 })),
			encodePng: vi.fn(async ({ width, height }) => {
				expect({ width, height }).toEqual({ width: 1024, height: 512 });
				return encoded;
			}),
		};
		expect(
			await normalizeIllustration({ bytes: png(2048, 1024), declaredMime: "image/png" }, codec)
		).toEqual({
			bytes: encoded,
			mime: "image/png",
			width: 1024,
			height: 512,
		});
	});

	it.each([
		["landscape", 4096, 64, 1024, 16],
		["portrait", 64, 4096, 16, 1024],
	] as const)(
		"#8b accepts a valid extreme-aspect %s input when normalization makes its short edge below 64",
		async (_orientation, inputWidth, inputHeight, outputWidth, outputHeight) => {
			const encoded = png(outputWidth, outputHeight);
			await expect(
				normalizeIllustration(
					{ bytes: png(inputWidth, inputHeight), declaredMime: "image/png" },
					{
						decode: async () => ({ width: inputWidth, height: inputHeight }),
						encodePng: async ({ width, height }) => {
							expect({ width, height }).toEqual({ width: outputWidth, height: outputHeight });
							return encoded;
						},
					}
				)
			).resolves.toEqual({
				bytes: encoded,
				mime: "image/png",
				width: outputWidth,
				height: outputHeight,
			});
		}
	);

	it.each(["decode", "encode"] as const)("#8c maps %s codec exceptions to IMAGE_DECODE_FAILED", async (stage) => {
		await expect(
			normalizeIllustration(
				{ bytes: png(128, 128), declaredMime: "image/png" },
				{
					decode: async () => stage === "decode" ? Promise.reject(new Error("raw")) : { width: 128, height: 128 },
					encodePng: async () => stage === "encode" ? Promise.reject(new Error("raw")) : png(128, 128),
				}
			)
		).rejects.toThrow("IMAGE_DECODE_FAILED");
	});

	it("#8d rejects a codec response that is not a valid normalized PNG", async () => {
		await expect(
			normalizeIllustration(
				{ bytes: png(128, 128), declaredMime: "image/png" },
				{ decode: async () => ({ width: 128, height: 128 }), encodePng: async () => new Uint8Array([1, 2, 3]) }
			)
		).rejects.toThrow("IMAGE_FORMAT_INVALID");
	});
});

describe("S-11 provider and retry policy", () => {
	it("#9 defaults an unset provider to OpenAI", () => {
		expect(resolveProviderName(undefined)).toBe("openai");
	});

	it("#10 resolves explicit OpenAI and Gemini values", () => {
		expect([resolveProviderName("openai"), resolveProviderName("gemini")]).toEqual([
			"openai",
			"gemini",
		]);
	});

	it("#11 rejects invalid configuration without calling a fallback adapter", async () => {
		const success = { kind: "success", bytes: png(64, 64), declaredMime: "image/png" } as const;
		const openai = provider(success);
		const gemini = provider(success);
		await expect(
			generateWithSelectedProvider({
				environment: {
					ILLUSTRATION_PROVIDER: "invalid",
					OPENAI_API_KEY: "unused",
					OPENAI_IMAGE_MODEL: "unused",
				},
				adapters: { openai, gemini },
				prompt: "not logged",
				signal: new AbortController().signal,
			})
		).rejects.toThrow("PROVIDER_CONFIG_ERROR");
		expect(openai.generate).not.toHaveBeenCalled();
		expect(gemini.generate).not.toHaveBeenCalled();
	});

	it("#12 classifies only network, 408, 429, and 5xx as transient", () => {
		expect([
			classifyFailure({ networkError: true }).kind,
			classifyFailure({ category: "http", httpStatus: 408 }).kind,
			classifyFailure({ category: "http", httpStatus: 429 }).kind,
			classifyFailure({ category: "http", httpStatus: 503 }).kind,
		]).toEqual(["transient", "transient", "transient", "transient"]);
	});

	it("#13 classifies other 4xx, moderation, validation, and decode as permanent", () => {
		expect([
			classifyFailure({ category: "http", httpStatus: 400 }).kind,
			classifyFailure({ category: "moderation" }).kind,
			classifyFailure({ category: "validation" }).kind,
			classifyFailure({ category: "decode" }).kind,
		]).toEqual(["permanent", "permanent", "permanent", "permanent"]);
	});

	it("#14 returns fixed 5, 30, and 120 second backoff with no fourth retry", () => {
		expect([0, 1, 2, 3].map(retryDelaySeconds)).toEqual([5, 30, 120, undefined]);
	});

	it("F-15 defaults to official provider endpoints without an override binding", () => {
		expect(resolveProviderEndpointBinding({})).toEqual({});
	});

	it("F-15 accepts a bound HTTPS provider override and rejects partial or unsafe bindings", () => {
		expect(
			resolveProviderEndpointBinding({
				ILLUSTRATION_PROVIDER_ENDPOINT: "https://fake-provider.example.test/v1/images",
				ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: "s11-binding",
			})
		).toEqual({
			endpoint: "https://fake-provider.example.test/v1/images",
			binding: "s11-binding",
		});
		for (const environment of [
			{ ILLUSTRATION_PROVIDER_ENDPOINT: "https://fake-provider.example.test/v1/images" },
			{ ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: "s11-binding" },
			{
				ILLUSTRATION_PROVIDER_ENDPOINT: "http://fake-provider.example.test/v1/images",
				ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: "s11-binding",
			},
			{
				ILLUSTRATION_PROVIDER_ENDPOINT: "https://user:password@fake-provider.example.test/v1/images",
				ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: "s11-binding",
			},
		]) {
			expect(() => resolveProviderEndpointBinding(environment)).toThrow("PROVIDER_CONFIG_ERROR");
		}
	});
});

describe("S-11 safe logging", () => {
	it("#15 serializes only the allowlisted metadata contract", () => {
		const records: string[] = [];
		createSafeLogger((record) => records.push(record))({
			event: "worker_retry",
			batchId: "batch-safe",
			provider: "openai",
			httpStatus: 429,
			errorCode: "PROVIDER_TRANSIENT_ERROR",
			attempt: 1,
			durationMs: 25,
		});
		expect(JSON.parse(records[0] ?? "{}")).toEqual({
			event: "worker_retry",
			batchId: "batch-safe",
			provider: "openai",
			httpStatus: 429,
			errorCode: "PROVIDER_TRANSIENT_ERROR",
			attempt: 1,
			durationMs: 25,
		});
		expect(records.join("\n")).not.toMatch(/Authorization|base64|front|back|prompt|api[_-]?key/iu);
	});

	it("P3-01 allowlists a payload-free recoverable worker event", () => {
		const records: string[] = [];
		createSafeLogger((line) => records.push(line))({
			event: "worker_recoverable",
			jobId: "job-safe",
			errorCode: "INTERNAL_ERROR",
			attempt: 1,
		});
		expect(records.map((line) => JSON.parse(line))).toEqual([
			{
				event: "worker_recoverable",
				jobId: "job-safe",
				errorCode: "INTERNAL_ERROR",
				attempt: 1,
			},
		]);
	});
});

function writeU32Be(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = (value >>> 24) & 0xff;
	bytes[offset + 1] = (value >>> 16) & 0xff;
	bytes[offset + 2] = (value >>> 8) & 0xff;
	bytes[offset + 3] = value & 0xff;
}

function writeU24Le(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >>> 8) & 0xff;
	bytes[offset + 2] = (value >>> 16) & 0xff;
}
