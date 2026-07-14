import { normalizeForKey } from "./normalize";

export type CardPattern = "R1" | "W1";

export interface CardKeyInput {
	pattern: CardPattern;
	front: string;
	back: string;
}

const CARD_KEY_SEPARATOR = "\u001f";

export function buildCardKeyMaterial({ pattern, front, back }: CardKeyInput): string {
	return [pattern, normalizeForKey(front), normalizeForKey(back)].join(CARD_KEY_SEPARATOR);
}

export async function computeCardKey(input: CardKeyInput): Promise<string> {
	return await sha256Hex(buildCardKeyMaterial(input));
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
