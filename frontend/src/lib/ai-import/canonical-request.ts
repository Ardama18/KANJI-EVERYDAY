import { sha256Hex } from "./card-key";
import { normalizeDisplayText, normalizeForKey } from "./normalize";

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
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
