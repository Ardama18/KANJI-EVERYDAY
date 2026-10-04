import type { MnemonicDraft } from "./contracts";

export const MNEMONIC_ERROR_CODES = [
	"MNEMONIC_HTTP_TRANSIENT",
	"MNEMONIC_HTTP_PERMANENT",
	"MNEMONIC_TIMEOUT",
	"MNEMONIC_NETWORK",
	"MNEMONIC_RESPONSE_INVALID",
	"MNEMONIC_VALIDATION_FAILED",
	"MNEMONIC_REFUSED",
	"MNEMONIC_MODERATION_BLOCKED",
	"MNEMONIC_MODERATION_UNAVAILABLE",
	"MNEMONIC_LIMIT_EXCEEDED",
	"MNEMONIC_BUDGET_EXCEEDED",
	"MNEMONIC_DISABLED",
	"MNEMONIC_CONFIG_MISSING",
	"MNEMONIC_TARGET_UNSUPPORTED",
	"MNEMONIC_INTERNAL_ERROR",
] as const;
export type MnemonicErrorCode = (typeof MNEMONIC_ERROR_CODES)[number];
export type MnemonicOutcome =
	| { readonly conceptId: string; readonly status: "approved"; readonly mnemonic: MnemonicDraft }
	| { readonly conceptId: string; readonly status: "blocked"; readonly code: MnemonicErrorCode }
	| { readonly conceptId: string; readonly status: "not_required" };
export function isMnemonicErrorCode(value: unknown): value is MnemonicErrorCode {
	return typeof value === "string" && MNEMONIC_ERROR_CODES.some((code) => code === value);
}
export function isMnemonicRetryable(code: MnemonicErrorCode): boolean {
	return [
		"MNEMONIC_HTTP_TRANSIENT",
		"MNEMONIC_TIMEOUT",
		"MNEMONIC_NETWORK",
		"MNEMONIC_RESPONSE_INVALID",
		"MNEMONIC_VALIDATION_FAILED",
		"MNEMONIC_MODERATION_UNAVAILABLE",
		"MNEMONIC_LIMIT_EXCEEDED",
		"MNEMONIC_BUDGET_EXCEEDED",
	].includes(code);
}
