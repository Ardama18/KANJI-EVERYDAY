import type { Database, Json } from "@/types/database";
import { IMPORT_REQUEST_LIMITS } from "./canonical-request";
import { type CardPattern, computeCardKey } from "./card-key";
import { isUnicodeScalarText, normalizeDisplayText, normalizeForKey } from "./normalize";
import { isCanonicalUuid } from "./uuid";

export type ImportPattern = CardPattern;
export type ImportSkill = "reading" | "writing";
export type ImportSource = "app_ai" | "remote_mcp";

export type ClientDeckInput = { id: string } | { name: string } | { create: { name: string } };

export type ClientImageInput =
	| { mode: "none" }
	| { mode: "ai" }
	| { mode: "upload"; uploadId: string };

export interface ClientImportItemInput {
	clientItemId: string;
	conceptId: string;
	pattern: ImportPattern;
	front: string;
	back: string;
	tags: string[];
	image: ClientImageInput;
}

export interface ClientImportRequestInput {
	deck: ClientDeckInput;
	items: ClientImportItemInput[];
}

export type TrustedImportContext =
	| {
			readonly actorUserId: string;
			readonly source: "app_ai";
			readonly quotaPolicy: "consume";
	  }
	| {
			readonly actorUserId: string;
			readonly source: "remote_mcp";
			readonly quotaPolicy: "exempt";
	  };

export interface CommitImportWrapperArgs {
	readonly context: TrustedImportContext;
	readonly idempotencyKey: string;
	readonly importRequestHash: string;
	readonly cardReservationKey: string;
	readonly request: NormalizedImportRequest;
}

export interface ValidationIssue {
	readonly path: string;
	readonly rule: string;
}

export interface NormalizedTag {
	readonly displayName: string;
	readonly normalizedName: string;
}

export type NormalizedDeckInput =
	| { readonly id: string }
	| { readonly name: string }
	| { readonly create: { readonly name: string } };

export type NormalizedImageInput =
	| { readonly mode: "none" }
	| { readonly mode: "ai" }
	| { readonly mode: "upload"; readonly uploadId: string };

export interface NormalizedImportItem {
	readonly clientItemId: string;
	readonly conceptId: string;
	readonly pattern: ImportPattern;
	readonly skill: ImportSkill;
	readonly front: string;
	readonly back: string;
	readonly tags: readonly string[];
	readonly normalizedTags: readonly NormalizedTag[];
	readonly image: NormalizedImageInput;
	readonly cardKey: string;
}

const normalizedImportRequestBrand: unique symbol = Symbol("NormalizedImportRequest");

export interface NormalizedImportRequest {
	readonly deck: NormalizedDeckInput;
	readonly items: readonly NormalizedImportItem[];
	readonly [normalizedImportRequestBrand]: true;
}

export type ImportRequestValidationResult =
	| { readonly success: true; readonly data: NormalizedImportRequest }
	| {
			readonly success: false;
			readonly code: "VALIDATION_ERROR" | "DUPLICATE_IN_REQUEST";
			readonly issues: readonly ValidationIssue[];
	  };

interface ParsedItem {
	readonly index: number;
	readonly clientItemId: string;
	readonly conceptId: string;
	readonly pattern: ImportPattern;
	readonly skill: ImportSkill;
	readonly front: string;
	readonly back: string;
	readonly tags: readonly string[];
	readonly normalizedTags: readonly NormalizedTag[];
	readonly image: NormalizedImageInput;
}

const HAN_PATTERN = /[㐀-䶿一-鿿豈-﫿𠀀-𮹟丽-𪘀𰀀-𲎯々〇〆]/u;
const ROOT_FIELDS = new Set(["deck", "items"]);
const ITEM_FIELDS = new Set([
	"clientItemId",
	"conceptId",
	"pattern",
	"front",
	"back",
	"tags",
	"image",
]);

export async function validateImportRequest(
	input: unknown
): Promise<ImportRequestValidationResult> {
	const issues: ValidationIssue[] = [];
	if (!isRecord(input)) {
		return failure([{ path: "$", rule: "object" }]);
	}
	addUnknownFieldIssues(input, ROOT_FIELDS, "", issues);
	const deck = parseDeck(input.deck, issues);
	const parsedItems = parseItems(input.items, issues);
	const duplicateInRequest = validateItemSets(parsedItems, issues);
	const normalizedItems = await addCardKeys(parsedItems, issues);
	const hasCardKeyDuplicate = issues.some((issue) => issue.rule === "duplicate_card_key");
	if (deck === undefined || issues.length > 0) {
		return failure(issues, duplicateInRequest || hasCardKeyDuplicate);
	}
	return {
		success: true,
		data: {
			deck,
			items: normalizedItems,
			[normalizedImportRequestBrand]: true,
		},
	};
}

export function buildCommitImportRpcArgs(
	args: CommitImportWrapperArgs
): Database["public"]["Functions"]["commit_import"]["Args"] {
	return {
		p_actor_user_id: args.context.actorUserId,
		p_source: args.context.source,
		p_idempotency_key: args.idempotencyKey,
		p_import_request_hash: args.importRequestHash,
		p_request: normalizedRequestJson(args.request),
		p_card_reservation_key: args.cardReservationKey,
	};
}

function normalizedRequestJson(request: NormalizedImportRequest): Json {
	return {
		deck: normalizedDeckJson(request.deck),
		items: request.items.map((item) => ({
			clientItemId: item.clientItemId,
			conceptId: item.conceptId,
			pattern: item.pattern,
			front: item.front,
			back: item.back,
			tags: [...item.tags],
			image: normalizedImageJson(item.image),
		})),
	};
}

function normalizedDeckJson(deck: NormalizedDeckInput): Json {
	if ("id" in deck) return { id: deck.id };
	if ("name" in deck) return { name: deck.name };
	return { create: { name: deck.create.name } };
}

function normalizedImageJson(image: NormalizedImageInput): Json {
	return image.mode === "upload"
		? { mode: image.mode, uploadId: image.uploadId }
		: { mode: image.mode };
}

function failure(
	issues: readonly ValidationIssue[],
	duplicateInRequest = false
): ImportRequestValidationResult {
	return {
		success: false,
		code: duplicateInRequest ? "DUPLICATE_IN_REQUEST" : "VALIDATION_ERROR",
		issues,
	};
}

function parseDeck(value: unknown, issues: ValidationIssue[]): NormalizedDeckInput | undefined {
	if (!isRecord(value)) {
		issues.push({ path: "deck", rule: "object" });
		return undefined;
	}
	addUnknownFieldIssues(value, new Set(["id", "name", "create"]), "deck", issues);
	const selected = ["id", "name", "create"].filter((key) => value[key] !== undefined);
	if (selected.length !== 1) {
		issues.push({ path: "deck", rule: "deck_union" });
		return undefined;
	}
	if (selected[0] === "id") {
		if (typeof value.id !== "string" || !isCanonicalUuid(value.id)) {
			issues.push({ path: "deck.id", rule: "uuid" });
			return undefined;
		}
		return { id: value.id.toLowerCase() };
	}
	if (selected[0] === "name") {
		const name = normalizedText(value.name, "deck.name", issues);
		return name === undefined ? undefined : { name };
	}
	if (!isRecord(value.create)) {
		issues.push({ path: "deck.create", rule: "object" });
		return undefined;
	}
	addUnknownFieldIssues(value.create, new Set(["name"]), "deck.create", issues);
	const name = normalizedText(value.create.name, "deck.create.name", issues);
	return name === undefined ? undefined : { create: { name } };
}

function parseItems(value: unknown, issues: ValidationIssue[]): ParsedItem[] {
	if (!Array.isArray(value)) {
		issues.push({ path: "items", rule: "array" });
		return [];
	}
	if (
		value.length < IMPORT_REQUEST_LIMITS.itemsMin ||
		value.length > IMPORT_REQUEST_LIMITS.itemsMax
	) {
		issues.push({ path: "items", rule: "items_count" });
	}
	const parsed: ParsedItem[] = [];
	for (const [index, item] of value.entries()) {
		const normalized = parseItem(item, index, issues);
		if (normalized !== undefined) parsed.push(normalized);
	}
	return parsed;
}

function parseItem(
	value: unknown,
	index: number,
	issues: ValidationIssue[]
): ParsedItem | undefined {
	const basePath = `items[${index}]`;
	if (!isRecord(value)) {
		issues.push({ path: basePath, rule: "object" });
		return undefined;
	}
	addUnknownFieldIssues(value, ITEM_FIELDS, basePath, issues);
	const clientItemId = boundedIdentifier(
		value.clientItemId,
		`${basePath}.clientItemId`,
		"client_item_id_length",
		issues
	);
	const conceptId = boundedIdentifier(
		value.conceptId,
		`${basePath}.conceptId`,
		"concept_id_length",
		issues
	);
	const pattern = parsePattern(value.pattern, `${basePath}.pattern`, issues);
	const front = normalizedText(value.front, `${basePath}.front`, issues);
	const back = normalizedText(value.back, `${basePath}.back`, issues);
	const tagResult = parseTags(value.tags, `${basePath}.tags`, issues);
	const image = parseImage(value.image, `${basePath}.image`, issues);
	if (pattern !== undefined && front !== undefined && back !== undefined) {
		const hanValue = pattern === "R1" ? front : back;
		if (!HAN_PATTERN.test(hanValue)) {
			issues.push({
				path: `${basePath}.${pattern === "R1" ? "front" : "back"}`,
				rule: "han_required",
			});
		}
	}
	if (
		clientItemId === undefined ||
		conceptId === undefined ||
		pattern === undefined ||
		front === undefined ||
		back === undefined ||
		tagResult === undefined ||
		image === undefined
	) {
		return undefined;
	}
	return {
		index,
		clientItemId,
		conceptId,
		pattern,
		skill: pattern === "R1" ? "reading" : "writing",
		front,
		back,
		tags: tagResult.map((tag) => tag.displayName),
		normalizedTags: tagResult,
		image,
	};
}

function parsePattern(
	value: unknown,
	path: string,
	issues: ValidationIssue[]
): ImportPattern | undefined {
	if (value !== "R1" && value !== "W1") {
		issues.push({ path, rule: "pattern" });
		return undefined;
	}
	return value;
}

function parseTags(
	value: unknown,
	path: string,
	issues: ValidationIssue[]
): readonly NormalizedTag[] | undefined {
	if (!Array.isArray(value)) {
		issues.push({ path, rule: "array" });
		return undefined;
	}
	if (
		value.length < IMPORT_REQUEST_LIMITS.tagsMin ||
		value.length > IMPORT_REQUEST_LIMITS.tagsMax
	) {
		issues.push({ path, rule: "tags_count" });
	}
	const result: NormalizedTag[] = [];
	const seen = new Set<string>();
	for (const [index, tag] of value.entries()) {
		if (typeof tag !== "string") {
			issues.push({ path: `${path}[${index}]`, rule: "string" });
			continue;
		}
		if (!isUnicodeScalarText(tag)) {
			issues.push({ path: `${path}[${index}]`, rule: "unicode_scalar" });
			continue;
		}
		const displayName = normalizeDisplayText(tag);
		const length = codePointLength(displayName);
		if (length < IMPORT_REQUEST_LIMITS.tagTextMin || length > IMPORT_REQUEST_LIMITS.tagTextMax) {
			issues.push({ path: `${path}[${index}]`, rule: "tag_length" });
			continue;
		}
		const normalizedName = normalizeForKey(displayName);
		if (seen.has(normalizedName)) {
			issues.push({ path: `${path}[${index}]`, rule: "duplicate_tag" });
		} else {
			seen.add(normalizedName);
		}
		result.push({ displayName, normalizedName });
	}
	return result;
}

function parseImage(
	value: unknown,
	path: string,
	issues: ValidationIssue[]
): NormalizedImageInput | undefined {
	if (!isRecord(value)) {
		issues.push({ path, rule: "object" });
		return undefined;
	}
	addUnknownFieldIssues(value, new Set(["mode", "uploadId"]), path, issues);
	if (value.mode === "none" || value.mode === "ai") {
		if (value.uploadId !== undefined) {
			issues.push({ path, rule: "image_union" });
			return undefined;
		}
		return { mode: value.mode };
	}
	if (value.mode === "upload") {
		if (typeof value.uploadId !== "string" || !isCanonicalUuid(value.uploadId)) {
			issues.push({ path, rule: "image_union" });
			return undefined;
		}
		return { mode: "upload", uploadId: value.uploadId.toLowerCase() };
	}
	issues.push({ path, rule: "image_union" });
	return undefined;
}

function validateItemSets(items: readonly ParsedItem[], issues: ValidationIssue[]): boolean {
	let duplicateInRequest = false;
	const clientIds = new Map<string, number>();
	const conceptPatterns = new Map<string, ParsedItem>();
	const concepts = new Map<string, { reading?: ParsedItem; writing?: ParsedItem }>();
	for (const item of items) {
		if (clientIds.has(item.clientItemId)) {
			issues.push({ path: `items[${item.index}].clientItemId`, rule: "duplicate_client_item_id" });
			duplicateInRequest = true;
		} else {
			clientIds.set(item.clientItemId, item.index);
		}
		const pairKey = `${item.conceptId}\u001f${item.pattern}`;
		if (conceptPatterns.has(pairKey)) {
			issues.push({ path: `items[${item.index}].pattern`, rule: "duplicate_concept_pattern" });
		} else {
			conceptPatterns.set(pairKey, item);
		}
		const pair = concepts.get(item.conceptId) ?? {};
		if (item.pattern === "R1") pair.reading = item;
		else pair.writing = item;
		concepts.set(item.conceptId, pair);
	}
	for (const pair of concepts.values()) {
		if (
			pair.reading !== undefined &&
			pair.writing !== undefined &&
			(pair.reading.front !== pair.writing.back || pair.reading.back !== pair.writing.front)
		) {
			issues.push({ path: `items[${pair.writing.index}]`, rule: "concept_pair_mismatch" });
		}
	}
	return duplicateInRequest;
}

async function addCardKeys(
	items: readonly ParsedItem[],
	issues: ValidationIssue[]
): Promise<readonly NormalizedImportItem[]> {
	const result: NormalizedImportItem[] = [];
	const cardKeys = new Set<string>();
	for (const item of items) {
		const cardKey = await computeCardKey(item);
		if (cardKeys.has(cardKey)) {
			issues.push({ path: `items[${item.index}]`, rule: "duplicate_card_key" });
		} else {
			cardKeys.add(cardKey);
		}
		result.push({
			clientItemId: item.clientItemId,
			conceptId: item.conceptId,
			pattern: item.pattern,
			skill: item.skill,
			front: item.front,
			back: item.back,
			tags: item.tags,
			normalizedTags: item.normalizedTags,
			image: item.image,
			cardKey,
		});
	}
	return result;
}

function normalizedText(
	value: unknown,
	path: string,
	issues: ValidationIssue[]
): string | undefined {
	if (typeof value !== "string") {
		issues.push({ path, rule: "string" });
		return undefined;
	}
	if (!isUnicodeScalarText(value)) {
		issues.push({ path, rule: "unicode_scalar" });
		return undefined;
	}
	const normalized = normalizeDisplayText(value);
	const length = codePointLength(normalized);
	if (length < IMPORT_REQUEST_LIMITS.textMin || length > IMPORT_REQUEST_LIMITS.textMax) {
		issues.push({ path, rule: "text_length" });
		return undefined;
	}
	return normalized;
}

function boundedIdentifier(
	value: unknown,
	path: string,
	rule: string,
	issues: ValidationIssue[]
): string | undefined {
	if (typeof value !== "string") {
		issues.push({ path, rule: "string" });
		return undefined;
	}
	if (!isUnicodeScalarText(value)) {
		issues.push({ path, rule: "unicode_scalar" });
		return undefined;
	}
	const length = codePointLength(value);
	if (
		length < IMPORT_REQUEST_LIMITS.identifierMin ||
		length > IMPORT_REQUEST_LIMITS.identifierMax
	) {
		issues.push({ path, rule });
		return undefined;
	}
	return value;
}

function addUnknownFieldIssues(
	value: Readonly<Record<string, unknown>>,
	allowed: ReadonlySet<string>,
	basePath: string,
	issues: ValidationIssue[]
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key))
			issues.push({
				path: basePath.length === 0 ? key : `${basePath}.${key}`,
				rule: "unknown_field",
			});
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}
