import {
	GEMINI_IMAGE_MODEL,
	GEMINI_PROVIDER,
	type GeminiGenerationResult,
	type GeminiModelInfoFailure,
	type GeminiModelInfoSuccess,
	type ModelInfoFailureReason,
} from "./types"

const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>
type NowFunction = () => Date

export type GenerateIllustrationInput = {
	prompt: string
	apiKey: string | undefined
	model?: string
}

export type GenerateIllustrationDependencies = {
	fetchFn?: FetchFunction
	now?: NowFunction
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null

const defaultFetchFn: FetchFunction = (input, init) => fetch(input, init)

const readRequestId = (response: Response): string | undefined =>
	response.headers.get("x-request-id") ?? response.headers.get("x-goog-request-id") ?? undefined

const parseJsonResponse = async (response: Response): Promise<unknown> => {
	try {
		return await response.json()
	} catch {
		return null
	}
}

const collectNestedStrings = (value: unknown, output: string[]): void => {
	if (typeof value === "string") {
		output.push(value.toLowerCase())
		return
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectNestedStrings(item, output)
		}
		return
	}

	if (!isRecord(value)) {
		return
	}

	for (const nestedValue of Object.values(value)) {
		collectNestedStrings(nestedValue, output)
	}
}

const containsSafetySignal = (payload: unknown): boolean => {
	const collectedStrings: string[] = []
	collectNestedStrings(payload, collectedStrings)
	const joined = collectedStrings.join(" ")

	return (
		joined.includes("safety") ||
		joined.includes("blocked") ||
		joined.includes("policy") ||
		joined.includes("prohibited")
	)
}

const classifyFailureReason = (status: number | undefined, payload: unknown): ModelInfoFailureReason => {
	if (status === undefined) {
		return "network"
	}

	if (status === 429) {
		return "rate_limit"
	}

	if (containsSafetySignal(payload)) {
		return "safety"
	}

	return "unknown"
}

const extractInlineDataRecord = (part: Record<string, unknown>): Record<string, unknown> | null => {
	const inlineData = part.inlineData ?? part.inline_data
	if (!isRecord(inlineData)) {
		return null
	}

	return inlineData
}

const extractImageBase64 = (payload: unknown): string | null => {
	if (!isRecord(payload)) {
		return null
	}

	const candidates = payload.candidates
	if (!Array.isArray(candidates)) {
		return null
	}

	for (const candidate of candidates) {
		if (!isRecord(candidate)) {
			continue
		}

		const content = candidate.content
		if (!isRecord(content)) {
			continue
		}

		const parts = content.parts
		if (!Array.isArray(parts)) {
			continue
		}

		for (const part of parts) {
			if (!isRecord(part)) {
				continue
			}

			const inlineData = extractInlineDataRecord(part)
			if (!inlineData) {
				continue
			}

			const data = inlineData.data
			if (typeof data !== "string" || data.length === 0) {
				continue
			}

			const mimeType = inlineData.mimeType ?? inlineData.mime_type
			if (typeof mimeType === "string" && !mimeType.startsWith("image/")) {
				continue
			}

			return data
		}
	}

	return null
}

const createSuccessModelInfo = (params: {
	model: string
	httpStatus: number
	requestId?: string
	now: NowFunction
}): GeminiModelInfoSuccess => ({
	provider: GEMINI_PROVIDER,
	model: params.model,
	outcome: "ready",
	reason: "success",
	httpStatus: params.httpStatus,
	requestId: params.requestId,
	timestamp: params.now().toISOString(),
})

const createFailureModelInfo = (params: {
	model: string
	reason: ModelInfoFailureReason
	httpStatus?: number
	requestId?: string
	now: NowFunction
}): GeminiModelInfoFailure => ({
	provider: GEMINI_PROVIDER,
	model: params.model,
	outcome: "failed",
	reason: params.reason,
	httpStatus: params.httpStatus,
	requestId: params.requestId,
	timestamp: params.now().toISOString(),
})

const createGeminiRequestBody = (prompt: string) => ({
	contents: [
		{
			parts: [{ text: prompt }],
		},
	],
	generationConfig: {
		responseModalities: ["IMAGE"],
	},
})

const createFailureResult = (params: {
	model: string
	reason: ModelInfoFailureReason
	httpStatus?: number
	requestId?: string
	now: NowFunction
}): GeminiGenerationResult => ({
	ok: false,
	imageBuffer: null,
	modelInfo: createFailureModelInfo(params),
})

const resolveEndpoint = (model: string, apiKey: string): string =>
	`${GEMINI_API_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

export const generateIllustration = async (
	input: GenerateIllustrationInput,
	dependencies: GenerateIllustrationDependencies = {}
): Promise<GeminiGenerationResult> => {
	const now = dependencies.now ?? (() => new Date())
	const fetchFn = dependencies.fetchFn ?? defaultFetchFn
	const model = input.model ?? GEMINI_IMAGE_MODEL
	const apiKey = input.apiKey?.trim()

	if (!apiKey) {
		return createFailureResult({
			model,
			reason: "api_key_missing",
			now,
		})
	}

	const endpoint = resolveEndpoint(model, apiKey)
	let response: Response

	try {
		response = await fetchFn(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(createGeminiRequestBody(input.prompt)),
		})
	} catch {
		return createFailureResult({
			model,
			reason: "network",
			now,
		})
	}

	const payload = await parseJsonResponse(response)
	const requestId = readRequestId(response)

	if (!response.ok) {
		return createFailureResult({
			model,
			reason: classifyFailureReason(response.status, payload),
			httpStatus: response.status,
			requestId,
			now,
		})
	}

	const imageBase64 = extractImageBase64(payload)
	if (!imageBase64) {
		return createFailureResult({
			model,
			reason: "unknown",
			httpStatus: response.status,
			requestId,
			now,
		})
	}

	const imageBuffer = Buffer.from(imageBase64, "base64")
	if (imageBuffer.byteLength === 0) {
		return createFailureResult({
			model,
			reason: "unknown",
			httpStatus: response.status,
			requestId,
			now,
		})
	}

	return {
		ok: true,
		imageBuffer,
		modelInfo: createSuccessModelInfo({
			model,
			httpStatus: response.status,
			requestId,
			now,
		}),
	}
}
