import type { SafeImportErrorCode } from "./contracts.ts";

export const RETRY_DELAYS_SECONDS = [5, 30, 120] as const;
export const MAX_PROVIDER_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

export type FailureClassification =
	| { readonly kind: "transient"; readonly code: SafeImportErrorCode }
	| { readonly kind: "permanent"; readonly code: SafeImportErrorCode };

export interface HttpFailureInput {
	readonly networkError?: boolean;
	readonly httpStatus?: number;
	readonly category?: "http" | "validation" | "decode" | "moderation" | "configuration";
}

export function classifyFailure(input: HttpFailureInput): FailureClassification {
	if (input.networkError === true) {
		return { kind: "transient", code: "PROVIDER_TRANSIENT_ERROR" };
	}
	if (input.category !== undefined && input.category !== "http") {
		return {
			kind: "permanent",
			code:
				input.category === "configuration" ? "PROVIDER_CONFIG_ERROR" : "PROVIDER_PERMANENT_ERROR",
		};
	}
	const status = input.httpStatus;
	if (
		status === 408 ||
		status === 429 ||
		(status !== undefined && status >= 500 && status <= 599)
	) {
		return { kind: "transient", code: "PROVIDER_TRANSIENT_ERROR" };
	}
	return { kind: "permanent", code: "PROVIDER_PERMANENT_ERROR" };
}

export function retryDelaySeconds(attempt: number): number | undefined {
	if (!Number.isInteger(attempt) || attempt < 0) return undefined;
	return RETRY_DELAYS_SECONDS[attempt];
}
