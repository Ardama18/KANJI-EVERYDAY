import { sha256Hex } from "./card-key";
import { normalizeDisplayText, normalizeForKey } from "./normalize";

export const IMPORT_REQUEST_LIMITS = Object.freeze({
	itemsMin: 1,
	itemsMax: 50,
	textMin: 1,
	textMax: 200,
	identifierMin: 1,
	identifierMax: 64,
	tagsMin: 0,
	tagsMax: 10,
	tagTextMin: 1,
	tagTextMax: 30,
});

export type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| CanonicalJsonValue[]
	| CanonicalJsonObject;

export interface CanonicalJsonObject {
	readonly [key: string]: CanonicalJsonValue | undefined;
}

export interface GenerationRequestInput {
	input: CanonicalJsonObject;
	options: CanonicalJsonObject;
	requestedUnits: {
		cardGeneration: number;
		illustrationConcept: number;
	};
}

export interface CanonicalImportRequestInput {
	deck: {
		id?: string;
		name?: string;
		create?: { name: string };
	};
	items: readonly {
		clientItemId: string;
		conceptId: string;
		pattern: string;
		front: string;
		back: string;
		tags: readonly string[];
		image: { mode: string; uploadId?: string };
	}[];
}

const REMOTE_GENERATION_HASH_DOMAIN = "kanji-everyday:remote-mcp:generation:v1";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function canonicalizeGenerationRequest(request: GenerationRequestInput): string {
	return JSON.stringify(
		canonicalizeJsonObject({
			input: request.input,
			options: request.options,
			requestedUnits: {
				cardGeneration: request.requestedUnits.cardGeneration,
				illustrationConcept: request.requestedUnits.illustrationConcept,
			},
		})
	);
}

export async function hashGenerationRequest(request: GenerationRequestInput): Promise<string> {
	return await sha256Hex(canonicalizeGenerationRequest(request));
}

export function canonicalizeImportRequest(request: CanonicalImportRequestInput): string {
	const canonical = {
		deck: canonicalizeDeck(request.deck),
		items: request.items.map((item) => ({
			clientItemId: item.clientItemId,
			conceptId: item.conceptId,
			pattern: item.pattern,
			front: normalizeDisplayText(item.front),
			back: normalizeDisplayText(item.back),
			tags: item.tags.map(normalizeForKey).sort(compareCanonicalText),
			image: canonicalizeImage(item.image),
		})),
	};
	return JSON.stringify(canonical);
}

export async function hashImportRequest(request: CanonicalImportRequestInput): Promise<string> {
	return await sha256Hex(canonicalizeImportRequest(request));
}

export async function deriveRemoteGenerationRequestHash(
	importRequestHash: string,
	clientId: string
): Promise<string> {
	const normalizedClientId = clientId.toLowerCase();
	if (!SHA256_HEX_PATTERN.test(importRequestHash) || !UUID_PATTERN.test(normalizedClientId)) {
		throw new Error("Remote generation hash input is invalid");
	}
	const parts = [REMOTE_GENERATION_HASH_DOMAIN, importRequestHash, normalizedClientId].map(
		(value) => new TextEncoder().encode(value)
	);
	const length = parts.reduce((total, part) => total + 4 + part.length, 0);
	const canonicalBytes = new Uint8Array(length);
	const view = new DataView(canonicalBytes.buffer);
	let offset = 0;
	for (const part of parts) {
		view.setUint32(offset, part.length, false);
		offset += 4;
		canonicalBytes.set(part, offset);
		offset += part.length;
	}
	const digest = await globalThis.crypto.subtle.digest("SHA-256", canonicalBytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalizeJsonObject(value: CanonicalJsonObject): CanonicalJsonObject {
	const result: Record<string, CanonicalJsonValue> = {};
	for (const key of Object.keys(value).sort(compareCanonicalText)) {
		const child = value[key];
		if (child !== undefined) {
			result[key] = canonicalizeJsonValue(child);
		}
	}
	return result;
}

function canonicalizeJsonValue(value: CanonicalJsonValue): CanonicalJsonValue {
	if (typeof value === "string") {
		return normalizeDisplayText(value);
	}
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new Error("Canonical request numbers must be safe integers");
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(canonicalizeJsonValue);
	}
	if (value !== null && typeof value === "object") {
		return canonicalizeJsonObject(value);
	}
	return value;
}

function canonicalizeDeck(deck: CanonicalImportRequestInput["deck"]): CanonicalJsonObject {
	if (deck.id !== undefined) {
		return { id: deck.id.toLowerCase() };
	}
	if (deck.name !== undefined) {
		return { name: normalizeDisplayText(deck.name) };
	}
	if (deck.create !== undefined) {
		return { create: { name: normalizeDisplayText(deck.create.name) } };
	}
	throw new Error("Canonical import deck must have id, name, or create");
}

function canonicalizeImage(
	image: CanonicalImportRequestInput["items"][number]["image"]
): CanonicalJsonObject {
	if (image.mode === "none" || image.mode === "ai") {
		return { mode: image.mode };
	}
	if (image.mode === "upload" && image.uploadId !== undefined) {
		return { mode: "upload", uploadId: image.uploadId.toLowerCase() };
	}
	throw new Error("Canonical import image mode is invalid");
}

function compareCanonicalText(left: string, right: string): number {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const sharedLength = Math.min(leftBytes.length, rightBytes.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return leftBytes.length - rightBytes.length;
}
