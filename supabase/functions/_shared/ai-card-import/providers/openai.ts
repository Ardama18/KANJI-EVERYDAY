import type { IllustrationProvider, ProviderResult } from "../contracts.ts";
import {
	decodeBase64WithinLimit,
	isProviderResponseLimitError,
	isProviderResponseNetworkError,
	readBoundedJsonResponse,
} from "../provider-response.ts";
import { classifyFailure } from "../retry-policy.ts";

export function createOpenAiProvider(input: {
	readonly apiKey: string;
	readonly model: string;
	readonly endpoint?: string;
	readonly endpointBinding?: string;
	readonly fetchImplementation?: typeof fetch;
}): IllustrationProvider {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const endpoint = input.endpoint ?? "https://api.openai.com/v1/images/generations";
	return {
		async generate({ prompt, signal }): Promise<ProviderResult> {
			let response: Response;
			try {
				response = await fetchImplementation(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${input.apiKey}`,
						"Content-Type": "application/json",
						...(input.endpointBinding === undefined
							? {}
							: { "x-s11-provider-binding": input.endpointBinding }),
					},
					body: JSON.stringify({
						model: input.model,
						prompt,
						size: "1024x1024",
						...(isDallEModel(input.model)
							? { response_format: "b64_json" }
							: { output_format: "png" }),
					}),
					signal,
				});
			} catch {
				return { kind: "transient", code: "PROVIDER_TRANSIENT_ERROR" };
			}
			if (!response.ok) return httpFailure(response.status);
			try {
				const body = await readBoundedJsonResponse(response);
				const encoded = readOpenAiBase64(body);
				if (encoded === undefined) return { kind: "permanent", code: "PROVIDER_PERMANENT_ERROR" };
				return { kind: "success", bytes: decodeBase64WithinLimit(encoded), declaredMime: "image/png" };
			} catch (error) {
				if (isProviderResponseNetworkError(error)) {
					return { kind: "transient", code: "PROVIDER_TRANSIENT_ERROR" };
				}
				if (isProviderResponseLimitError(error)) {
					return { kind: "permanent", code: "IMAGE_TOO_LARGE" };
				}
				return { kind: "permanent", code: "PROVIDER_PERMANENT_ERROR" };
			}
		},
	};
}

function isDallEModel(model: string): boolean {
	return model === "dall-e-2" || model === "dall-e-3";
}

function httpFailure(httpStatus: number): ProviderResult {
	const classification = classifyFailure({ category: "http", httpStatus });
	return { kind: classification.kind, code: classification.code, httpStatus };
}

function readOpenAiBase64(value: unknown): string | undefined {
	if (!isRecord(value) || !Array.isArray(value.data)) return undefined;
	const first = value.data[0];
	return isRecord(first) && typeof first.b64_json === "string" ? first.b64_json : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
