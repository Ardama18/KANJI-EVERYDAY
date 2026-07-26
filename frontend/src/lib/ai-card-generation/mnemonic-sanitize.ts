import { isUnicodeScalarText, normalizeDisplayText } from "@/lib/ai-import/normalize";

import type { MnemonicExplanationDraft, MnemonicSlotsDraft } from "./contracts";

/**
 * Canonical server-side limits for approved mnemonics (ADR-012 decision 5).
 * Both write paths share them: the import commit body (`ai-import/service.ts`)
 * and the post-commit edit (`ai-card-management/service.ts`, ADR-013 decision 4).
 * Duplicating them would let the two paths drift apart.
 */
export const MNEMONIC_TEXT_LIMITS = {
	kanjiMin: 1,
	kanjiMax: 16,
	textMin: 1,
	textMax: 100,
	summaryMin: 1,
	summaryMax: 120,
	mappingsMin: 2,
	mappingsMax: 4,
} as const;

/**
 * Returns `undefined` (mapped to VALIDATION_ERROR by the caller) when the value
 * is malformed.  Each text field is checked for Unicode scalar validity,
 * NFKC-normalized, and length-capped on code points.
 */
export function sanitizeMnemonicSlots(value: unknown): MnemonicSlotsDraft | undefined {
	if (!isRecord(value) || typeof value.isSingleKanji !== "boolean" || !isRecord(value.shapeHint)) {
		return undefined;
	}
	const kanji = normalizeCapped(
		value.kanji,
		MNEMONIC_TEXT_LIMITS.kanjiMin,
		MNEMONIC_TEXT_LIMITS.kanjiMax
	);
	const part = normalizeCapped(
		value.shapeHint.part,
		MNEMONIC_TEXT_LIMITS.textMin,
		MNEMONIC_TEXT_LIMITS.textMax
	);
	const picture = normalizeCapped(
		value.shapeHint.picture,
		MNEMONIC_TEXT_LIMITS.textMin,
		MNEMONIC_TEXT_LIMITS.textMax
	);
	const meaningHint = normalizeCapped(
		value.meaningHint,
		MNEMONIC_TEXT_LIMITS.textMin,
		MNEMONIC_TEXT_LIMITS.textMax
	);
	const story = normalizeCapped(
		value.story,
		MNEMONIC_TEXT_LIMITS.textMin,
		MNEMONIC_TEXT_LIMITS.textMax
	);
	if (
		kanji === undefined ||
		part === undefined ||
		picture === undefined ||
		meaningHint === undefined ||
		story === undefined
	) {
		return undefined;
	}
	return {
		kanji,
		isSingleKanji: value.isSingleKanji,
		shapeHint: { part, picture },
		meaningHint,
		story,
	};
}

/** Same contract as {@link sanitizeMnemonicSlots}; `mappings` must be 2-4. */
export function sanitizeMnemonicExplanation(value: unknown): MnemonicExplanationDraft | undefined {
	if (!isRecord(value) || !Array.isArray(value.mappings)) return undefined;
	if (
		value.mappings.length < MNEMONIC_TEXT_LIMITS.mappingsMin ||
		value.mappings.length > MNEMONIC_TEXT_LIMITS.mappingsMax
	) {
		return undefined;
	}
	const summary = normalizeCapped(
		value.summary,
		MNEMONIC_TEXT_LIMITS.summaryMin,
		MNEMONIC_TEXT_LIMITS.summaryMax
	);
	if (summary === undefined) return undefined;
	const mappings: { readonly part: string; readonly meaning: string }[] = [];
	for (const mapping of value.mappings) {
		if (!isRecord(mapping)) return undefined;
		const part = normalizeCapped(
			mapping.part,
			MNEMONIC_TEXT_LIMITS.textMin,
			MNEMONIC_TEXT_LIMITS.textMax
		);
		const meaning = normalizeCapped(
			mapping.meaning,
			MNEMONIC_TEXT_LIMITS.textMin,
			MNEMONIC_TEXT_LIMITS.textMax
		);
		if (part === undefined || meaning === undefined) return undefined;
		mappings.push({ part, meaning });
	}
	return { summary, mappings };
}

function normalizeCapped(value: unknown, min: number, max: number): string | undefined {
	if (typeof value !== "string" || !isUnicodeScalarText(value)) return undefined;
	const normalized = normalizeDisplayText(value);
	const length = Array.from(normalized).length;
	if (length < min || length > max) return undefined;
	return normalized;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
