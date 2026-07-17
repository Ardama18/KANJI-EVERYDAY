export const SAFE_IMPORT_ERROR_CODES = [
	"INVALID_QUEUE_MESSAGE",
	"CLAIM_LOST",
	"PROVIDER_CONFIG_ERROR",
	"PROVIDER_TRANSIENT_ERROR",
	"PROVIDER_PERMANENT_ERROR",
	"IMAGE_FORMAT_INVALID",
	"IMAGE_TOO_LARGE",
	"IMAGE_DIMENSIONS_INVALID",
	"IMAGE_DECODE_FAILED",
	"OBJECT_CONFLICT",
	"STORAGE_TRANSIENT_ERROR",
	"STORAGE_PERMANENT_ERROR",
	"DUPLICATE_EXISTING",
	"INTERNAL_ERROR",
] as const;

export type SafeImportErrorCode = (typeof SAFE_IMPORT_ERROR_CODES)[number];
export type ProviderName = "openai" | "gemini";
export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface QueueMessageV1 {
	readonly version: 1;
	readonly jobId: string;
	readonly batchId: string;
}

export type ProviderResult =
	| { readonly kind: "success"; readonly bytes: Uint8Array; readonly declaredMime: string }
	| {
			readonly kind: "transient";
			readonly code: SafeImportErrorCode;
			readonly httpStatus?: number;
	  }
	| {
			readonly kind: "permanent";
			readonly code: SafeImportErrorCode;
			readonly httpStatus?: number;
	  };

export interface IllustrationProvider {
	generate(input: {
		readonly prompt: string;
		readonly signal: AbortSignal;
	}): Promise<ProviderResult>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseQueueMessage(value: unknown): QueueMessageV1 | undefined {
	if (!isRecord(value)) return undefined;
	if (Object.keys(value).some((key) => !["version", "jobId", "batchId"].includes(key))) {
		return undefined;
	}
	if (
		value.version !== 1 ||
		typeof value.jobId !== "string" ||
		typeof value.batchId !== "string" ||
		!UUID_PATTERN.test(value.jobId) ||
		!UUID_PATTERN.test(value.batchId)
	) {
		return undefined;
	}
	return { version: 1, jobId: value.jobId.toLowerCase(), batchId: value.batchId.toLowerCase() };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
