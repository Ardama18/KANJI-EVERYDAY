import { describe, expect, it, vi } from "vitest"

import { GEMINI_IMAGE_MODEL, type GeminiModelInfo } from "./types"
import { generateIllustration } from "./gemini-client"

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>

const FIXED_TIMESTAMP = new Date("2026-02-24T12:34:56.000Z")

const createModelInfoMatcher = (
	overrides: Partial<GeminiModelInfo>
): Partial<GeminiModelInfo> => ({
	provider: "gemini",
	model: GEMINI_IMAGE_MODEL,
	timestamp: FIXED_TIMESTAMP.toISOString(),
	...overrides,
})

const extractRequestBody = (fetchMock: ReturnType<typeof vi.fn<FetchFunction>>) => {
	const call = fetchMock.mock.calls.at(0)
	if (!call) {
		throw new Error("fetch has not been called")
	}

	const [, init] = call
	if (!init || typeof init.body !== "string") {
		throw new Error("request body is missing")
	}

	return JSON.parse(init.body) as unknown
}

describe("generateIllustration", () => {
	it("UT-AC09-FETCH-ONLY: fetchでGemini APIを呼び出して画像Bufferと成功model_infoを返す", async () => {
		const imageBuffer = Buffer.from("fake-png-binary")
		const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
			new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [
									{
										inlineData: {
											mimeType: "image/png",
											data: imageBuffer.toString("base64"),
										},
									},
								],
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"x-request-id": "request-1",
					},
				}
			)
		)

		const result = await generateIllustration(
			{
				prompt: "雨のイラスト",
				apiKey: "gemini-test-key",
			},
			{
				fetchFn: fetchMock,
				now: () => FIXED_TIMESTAMP,
			}
		)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=gemini-test-key`,
			expect.objectContaining({
				method: "POST",
			})
		)

		const requestBody = extractRequestBody(fetchMock)
		expect(requestBody).toEqual(
			expect.objectContaining({
				contents: [
					{
						parts: [
							{
								text: "雨のイラスト",
							},
						],
					},
				],
			})
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.imageBuffer.toString()).toBe(imageBuffer.toString())
			expect(result.modelInfo).toMatchObject(
				createModelInfoMatcher({
					outcome: "ready",
					reason: "success",
					httpStatus: 200,
					requestId: "request-1",
				})
			)
		}
	})

	it("UT-AC11-RATE-LIMIT: HTTP 429 を rate_limit として分類する", async () => {
		const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						message: "quota exceeded",
					},
				}),
				{ status: 429 }
			)
		)

		const result = await generateIllustration(
			{
				prompt: "雨のイラスト",
				apiKey: "gemini-test-key",
			},
			{
				fetchFn: fetchMock,
				now: () => FIXED_TIMESTAMP,
			}
		)

		expect(result).toMatchObject({
			ok: false,
			modelInfo: createModelInfoMatcher({
				outcome: "failed",
				reason: "rate_limit",
				httpStatus: 429,
			}),
		})
	})

	it("UT-AC11-SAFETY: safety系エラーを safety として分類する", async () => {
		const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						message: "Request blocked by safety policy",
					},
				}),
				{ status: 400 }
			)
		)

		const result = await generateIllustration(
			{
				prompt: "雨のイラスト",
				apiKey: "gemini-test-key",
			},
			{
				fetchFn: fetchMock,
				now: () => FIXED_TIMESTAMP,
			}
		)

		expect(result).toMatchObject({
			ok: false,
			modelInfo: createModelInfoMatcher({
				outcome: "failed",
				reason: "safety",
				httpStatus: 400,
			}),
		})
	})

	it("UT-AC11-INVALID-PAYLOAD: HTTP成功でも画像payloadが不正なら unknown として失敗する", async () => {
		const fetchMock = vi.fn<FetchFunction>().mockResolvedValue(
			new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [{ text: "image missing" }],
							},
						},
					],
				}),
				{ status: 200 }
			)
		)

		const result = await generateIllustration(
			{
				prompt: "雨のイラスト",
				apiKey: "gemini-test-key",
			},
			{
				fetchFn: fetchMock,
				now: () => FIXED_TIMESTAMP,
			}
		)

		expect(result).toMatchObject({
			ok: false,
			modelInfo: createModelInfoMatcher({
				outcome: "failed",
				reason: "unknown",
				httpStatus: 200,
			}),
		})
	})

	it("UT-AC11-NETWORK: fetch失敗を network として分類する", async () => {
		const fetchMock = vi
			.fn<FetchFunction>()
			.mockRejectedValue(new TypeError("network is unavailable"))

		const result = await generateIllustration(
			{
				prompt: "雨のイラスト",
				apiKey: "gemini-test-key",
			},
			{
				fetchFn: fetchMock,
				now: () => FIXED_TIMESTAMP,
			}
		)

		expect(result).toMatchObject({
			ok: false,
			modelInfo: createModelInfoMatcher({
				outcome: "failed",
				reason: "network",
			}),
		})
	})
})
