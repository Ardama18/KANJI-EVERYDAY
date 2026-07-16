import type { Json } from "@/types/database";
import { SAFE_IMPORT_ERROR_CODES } from "../../../../supabase/functions/_shared/ai-card-import/contracts";
import type { NormalizedImportRequest } from "./schema";
import { isCanonicalUuid } from "./uuid";

export interface CommitAsyncRpcArgs {
	readonly p_actor_user_id: string;
	readonly p_source: "app_ai" | "remote_mcp";
	readonly p_idempotency_key: string;
	readonly p_import_request_hash: string;
	readonly p_request: Json;
	readonly p_card_reservation_key: string;
}

export interface CommitAsyncResponse {
	readonly batchId: string;
	readonly status: "queued";
	readonly statusUrl: string;
}

export type ImportBatchStatus =
	| "queued"
	| "processing"
	| "completed"
	| "partial"
	| "failed"
	| "undone";
export type ImportItemStatus = "queued" | "processing" | "succeeded" | "failed" | "undone";

export interface ImportStatusResponse {
	readonly batchId: string;
	readonly status: ImportBatchStatus;
	readonly counts: { readonly total: number; readonly succeeded: number; readonly failed: number };
	readonly items: readonly {
		readonly itemId: string;
		readonly conceptId: string;
		readonly status: ImportItemStatus;
		readonly cardId?: string;
		readonly errorCode?: string;
	}[];
}

export function normalizedRequestToJson(request: NormalizedImportRequest): Json {
	return {
		deck:
			"id" in request.deck
				? { id: request.deck.id }
				: "name" in request.deck
					? { name: request.deck.name }
					: { create: { name: request.deck.create.name } },
		items: request.items.map((item) => ({
			clientItemId: item.clientItemId,
			conceptId: item.conceptId,
			pattern: item.pattern,
			front: item.front,
			back: item.back,
			tags: [...item.tags],
			image:
				item.image.mode === "upload"
					? { mode: "upload", uploadId: item.image.uploadId }
					: { mode: item.image.mode },
		})),
	};
}

export function isCommitAsyncResponse(value: unknown): value is CommitAsyncResponse {
	return parseCommitAsyncResponse(value) !== undefined;
}

export function isImportStatusResponse(value: unknown): value is ImportStatusResponse {
	return parseImportStatusResponse(value) !== undefined;
}

export function parseCommitAsyncResponse(value: unknown): CommitAsyncResponse | undefined {
	if (!isRecord(value) || typeof value.batchId !== "string" || !isCanonicalUuid(value.batchId)) {
		return undefined;
	}
	const batchId = value.batchId.toLowerCase();
	const expectedStatusUrl = `/api/ai/imports/status?batchId=${batchId}`;
	if (value.status !== "queued" || value.statusUrl !== expectedStatusUrl) return undefined;
	return { batchId, status: "queued", statusUrl: expectedStatusUrl };
}

export function parseImportStatusResponse(value: unknown): ImportStatusResponse | undefined {
	if (
		!isRecord(value) ||
		typeof value.batchId !== "string" ||
		!isCanonicalUuid(value.batchId) ||
		!isBatchStatus(value.status) ||
		!isRecord(value.counts) ||
		!Array.isArray(value.items)
	)
		return undefined;
	const total = nonNegativeInteger(value.counts.total);
	const succeeded = nonNegativeInteger(value.counts.succeeded);
	const failed = nonNegativeInteger(value.counts.failed);
	if (
		total === undefined ||
		succeeded === undefined ||
		failed === undefined ||
		total !== value.items.length
	) {
		return undefined;
	}
	const items: ImportStatusResponse["items"][number][] = [];
	for (const rawItem of value.items) {
		const item = parseStatusItem(rawItem);
		if (item === undefined) return undefined;
		items.push(item);
	}
	const actualSucceeded = items.filter((item) => item.status === "succeeded").length;
	const actualFailed = items.filter((item) => item.status === "failed").length;
	if (
		succeeded !== actualSucceeded ||
		failed !== actualFailed ||
		!statusMatchesCounts(value.status, items)
	) {
		return undefined;
	}
	return {
		batchId: value.batchId.toLowerCase(),
		status: value.status,
		counts: { total, succeeded, failed },
		items,
	};
}

const SAFE_STATUS_ERRORS = new Set<string>(SAFE_IMPORT_ERROR_CODES);

function parseStatusItem(value: unknown): ImportStatusResponse["items"][number] | undefined {
	if (
		!isRecord(value) ||
		typeof value.itemId !== "string" ||
		!isCanonicalUuid(value.itemId) ||
		!safeConceptId(value.conceptId) ||
		!isItemStatus(value.status)
	)
		return undefined;
	const cardId = value.cardId === null ? undefined : value.cardId;
	const errorCode = value.errorCode === null ? undefined : value.errorCode;
	if (cardId !== undefined && (typeof cardId !== "string" || !isCanonicalUuid(cardId)))
		return undefined;
	if (
		errorCode !== undefined &&
		(typeof errorCode !== "string" || !SAFE_STATUS_ERRORS.has(errorCode))
	) {
		return undefined;
	}
	if (
		value.status === "succeeded"
			? cardId === undefined || errorCode !== undefined
			: cardId !== undefined
	) {
		return undefined;
	}
	if (value.status === "failed" ? errorCode === undefined : errorCode !== undefined)
		return undefined;
	return {
		itemId: value.itemId.toLowerCase(),
		conceptId: value.conceptId,
		status: value.status,
		...(cardId === undefined ? {} : { cardId: cardId.toLowerCase() }),
		...(errorCode === undefined ? {} : { errorCode }),
	};
}

function statusMatchesCounts(
	status: ImportBatchStatus,
	items: readonly ImportStatusResponse["items"][number][]
): boolean {
	if (items.length === 0) return false;
	const succeeded = items.filter((item) => item.status === "succeeded").length;
	const failed = items.filter((item) => item.status === "failed").length;
	const undone = items.filter((item) => item.status === "undone").length;
	if (undone > 0) return status === "undone" && undone === items.length;
	if (status === "undone") return false;
	if (status === "completed") return succeeded === items.length;
	if (status === "partial")
		return succeeded > 0 && failed > 0 && succeeded + failed === items.length;
	if (status === "failed") return failed === items.length;
	if (status === "processing") return items.some((item) => item.status === "processing");
	return (
		items.some((item) => item.status === "queued") &&
		!items.some((item) => item.status === "processing")
	);
}

function isBatchStatus(value: unknown): value is ImportBatchStatus {
	return ["queued", "processing", "completed", "partial", "failed", "undone"].includes(
		String(value)
	);
}

function isItemStatus(value: unknown): value is ImportItemStatus {
	return ["queued", "processing", "succeeded", "failed", "undone"].includes(String(value));
}

function nonNegativeInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeConceptId(value: unknown): value is string {
	if (typeof value !== "string" || value.length < 1 || value.length > 64) return false;
	return !Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
