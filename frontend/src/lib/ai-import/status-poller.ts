import type { ImportBatchStatus } from "./async-contract";
import { isCanonicalUuid } from "./uuid";

export interface BatchPointer {
	readonly version: 1;
	readonly deckId: string;
	readonly batchId: string;
}

export const STATUS_CHANNEL_NAME = "ai-card-import-status-v1";

export function batchPointerKey(deckId: string): string {
	return `kanji-everyday:ai-card-import:v1:${deckId}`;
}

export function serializeBatchPointer(pointer: BatchPointer): string {
	return JSON.stringify(pointer);
}

export function parseBatchPointer(value: string, expectedDeckId: string): BatchPointer | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (
		!isRecord(parsed) ||
		Object.keys(parsed).length !== 3 ||
		parsed.version !== 1 ||
		typeof parsed.deckId !== "string" ||
		typeof parsed.batchId !== "string" ||
		!isCanonicalUuid(parsed.deckId) ||
		!isCanonicalUuid(parsed.batchId) ||
		parsed.deckId.toLowerCase() !== expectedDeckId.toLowerCase()
	)
		return undefined;
	return { version: 1, deckId: parsed.deckId.toLowerCase(), batchId: parsed.batchId.toLowerCase() };
}

export function nextPollDelay(elapsedMs: number, status: ImportBatchStatus): number | undefined {
	if (["completed", "partial", "failed", "undone"].includes(status)) return undefined;
	return elapsedMs < 30_000 ? 2_000 : 5_000;
}

export function selectStatusLeader(
	tabs: readonly { readonly id: string; readonly visible: boolean; readonly heartbeatAt: number }[],
	now: number
): string | undefined {
	return tabs
		.filter((tab) => tab.visible && now - tab.heartbeatAt <= 10_000)
		.map((tab) => tab.id)
		.sort()[0];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
