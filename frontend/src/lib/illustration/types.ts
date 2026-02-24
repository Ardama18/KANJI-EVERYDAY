export const GEMINI_PROVIDER = "gemini" as const;
export const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation" as const;

export type IllustrationSkill = "reading" | "writing";

export type ModelInfoReason =
	| "success"
	| "api_key_missing"
	| "rate_limit"
	| "safety"
	| "network"
	| "storage_upload_failed"
	| "unknown";

export type ModelInfoFailureReason = Exclude<ModelInfoReason, "success">;

type GeminiModelInfoBase = {
	provider: typeof GEMINI_PROVIDER;
	model: string;
	httpStatus?: number;
	requestId?: string;
	timestamp: string;
};

export type GeminiModelInfoSuccess = GeminiModelInfoBase & {
	outcome: "ready";
	reason: "success";
};

export type GeminiModelInfoFailure = GeminiModelInfoBase & {
	outcome: "failed";
	reason: ModelInfoFailureReason;
};

export type GeminiModelInfo = GeminiModelInfoSuccess | GeminiModelInfoFailure;

export type GeminiGenerationSuccess = {
	ok: true;
	imageBuffer: Buffer;
	modelInfo: GeminiModelInfoSuccess;
};

export type GeminiGenerationFailure = {
	ok: false;
	imageBuffer: null;
	modelInfo: GeminiModelInfoFailure;
};

export type GeminiGenerationResult = GeminiGenerationSuccess | GeminiGenerationFailure;
