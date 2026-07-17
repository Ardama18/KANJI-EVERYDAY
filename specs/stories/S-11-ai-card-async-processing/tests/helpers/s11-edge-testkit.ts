import { vi } from "vitest";

import type {
	ProviderResult,
	SafeImportErrorCode,
} from "../../../../../supabase/functions/_shared/ai-card-import/contracts.ts";
import type { ImageCodec } from "../../../../../supabase/functions/_shared/ai-card-import/image-codec.ts";
import type {
	IllustrationStorage,
	StorageResult,
} from "../../../../../supabase/functions/_shared/ai-card-import/storage.ts";
import type {
	ClaimResult,
	PendingWorkerEvent,
	QueueDelivery,
	WorkerDatabase,
	WorkerDependencies,
} from "../../../../../supabase/functions/_shared/ai-card-import/worker.ts";

export const JOB_ID = "11000000-0000-4000-8000-000000000001";
export const BATCH_ID = "11000000-0000-4000-8000-000000000002";
export const CLAIM_TOKEN = "11000000-0000-4000-8000-000000000003";
export const ILLUSTRATION_ID = "11000000-0000-4000-8000-000000000004";

export interface HarnessState {
	jobState: "queued" | "processing" | "succeeded" | "failed";
	currentMessageId: number;
	attempt: number;
	claimToken?: string;
	claimExpiresAt?: number;
	terminalMessageId?: number;
	terminalClaimToken?: string;
	providerCalls: number;
	finalizeCalls: number;
	failCalls: number;
	failureCodes: SafeImportErrorCode[];
	ackCalls: number;
	retryDelays: number[];
	objectWrites: number;
	objectDeletes: number;
	objectOrphanCalls: number;
	sourceDeletes: number;
	sourceCleanupCalls: number;
	sourceDeletedCalls: number;
	sourceRetains: number;
	sourceReadBuckets: string[];
	logs: string[];
}

export interface WorkerHarness {
	readonly dependencies: WorkerDependencies;
	readonly state: HarnessState;
	readonly storageObjects: Map<string, Uint8Array>;
	setDelivery(messageId: number, payload?: unknown): void;
	setNow(milliseconds: number): void;
}

export function createWorkerHarness(
	options: {
		readonly imageMode?: "none" | "ai" | "upload";
		readonly providerResult?: ProviderResult;
		readonly storageWriteResult?: StorageResult;
		readonly attempt?: number;
		readonly finalizeError?: boolean;
		readonly finalizeOutcome?: "succeeded" | "failed_duplicate";
		readonly reconcileOutcome?:
			| "terminal_success"
			| "terminal_duplicate"
			| "claim_owned_uncommitted"
			| "claim_lost";
		readonly failError?: boolean;
		readonly scheduleRetryError?: boolean;
		readonly failureReconcileError?: boolean;
		readonly failureReconcileOutcome?: "terminal_failed" | "claim_owned_uncommitted" | "claim_lost";
		readonly decodeError?: boolean;
		readonly encodeError?: boolean;
		readonly decodedDimensions?: { readonly width: number; readonly height: number };
		readonly sourceBytes?: Uint8Array;
		readonly sourceDeleteThrows?: boolean;
		readonly illustrationReadThrows?: boolean;
		readonly sourceBucket?: "ai-card-sources" | "illustrations";
		readonly sourceReleaseOutcome?: "retain" | "delete";
		readonly compensationDeleteResult?: StorageResult;
	} = {}
): WorkerHarness {
	let now = Date.parse("2026-07-15T00:00:00.000Z");
	let delivery: QueueDelivery | undefined = {
		messageId: 1,
		payload: { version: 1, jobId: JOB_ID, batchId: BATCH_ID },
	};
	const state: HarnessState = {
		jobState: "queued",
		currentMessageId: 1,
		attempt: options.attempt ?? 0,
		providerCalls: 0,
		finalizeCalls: 0,
		failCalls: 0,
		failureCodes: [],
		ackCalls: 0,
		retryDelays: [],
		objectWrites: 0,
		objectDeletes: 0,
		objectOrphanCalls: 0,
		sourceDeletes: 0,
		sourceCleanupCalls: 0,
		sourceDeletedCalls: 0,
		sourceRetains: 0,
		sourceReadBuckets: [],
		logs: [],
	};
	const pendingEvents: PendingWorkerEvent[] = [];
	let claimedEventId: string | undefined;
	const recordEvent = (event: Omit<PendingWorkerEvent, "eventId">): void => {
		if (pendingEvents.some((candidate) =>
			candidate.event === event.event && candidate.queueMessageId === event.queueMessageId
		)) return;
		pendingEvents.push({ ...event, eventId: `11000000-0000-4000-8000-${String(pendingEvents.length + 10).padStart(12, "0")}` });
	};
	const storageObjects = new Map<string, Uint8Array>();
	const database: WorkerDatabase = {
		async readOne(): Promise<QueueDelivery | undefined> {
			return delivery;
		},
		async claim(input): Promise<ClaimResult> {
			if (state.jobState === "succeeded" || state.jobState === "failed")
				return { outcome: "terminal" };
			if (input.messageId !== state.currentMessageId) return { outcome: "stale" };
			if (state.jobState === "processing" && (state.claimExpiresAt ?? 0) > now)
				return { outcome: "active" };
			state.jobState = "processing";
			state.claimToken = input.claimToken;
			state.claimExpiresAt = now + 300_000;
			return {
				outcome: "claimed",
				jobId: JOB_ID,
				batchId: BATCH_ID,
				claimToken: input.claimToken,
				attempt: state.attempt,
				imageMode: options.imageMode ?? "none",
				prompt: options.imageMode === "ai" ? "fixture prompt" : undefined,
				sourcePath: options.imageMode === "upload" ? `${BATCH_ID}/source` : undefined,
				sourceBucket:
					options.imageMode === "upload" ? (options.sourceBucket ?? "ai-card-sources") : undefined,
				sourceMime: options.imageMode === "upload" ? "image/png" : undefined,
				illustrationId: options.imageMode === "none" ? undefined : ILLUSTRATION_ID,
				illustrationPath:
					options.imageMode === "none"
						? undefined
						: `${BATCH_ID}/s11-managed/${ILLUSTRATION_ID}.png`,
			};
		},
		async ackInert(_jobId, messageId, event): Promise<boolean> {
			state.ackCalls += 1;
			if (event !== undefined) {
				recordEvent({
					event: event.event,
					queueMessageId: messageId,
					jobId: event.reason === "JOB_MISSING" ? JOB_ID : undefined,
					errorCode: "INVALID_QUEUE_MESSAGE",
					reason: event.reason,
				});
			}
			return true;
		},
		async claimWorkerEvent(): Promise<PendingWorkerEvent | undefined> {
			const event = pendingEvents.find((candidate) => candidate.eventId !== claimedEventId);
			if (event !== undefined) claimedEventId = event.eventId;
			return event;
		},
		async completeWorkerEvent(eventId): Promise<void> {
			const index = pendingEvents.findIndex((event) => event.eventId === eventId);
			if (index < 0 || claimedEventId !== eventId) throw new Error("CLAIM_LOST");
			pendingEvents.splice(index, 1);
			claimedEventId = undefined;
		},
		async updateWorkerEventReason(messageId, event, reason): Promise<void> {
			const index = pendingEvents.findIndex(
				(candidate) => candidate.queueMessageId === messageId && candidate.event === event
			);
			if (index >= 0) pendingEvents[index] = { ...pendingEvents[index], reason };
		},
		async scheduleRetry(input): Promise<void> {
			assertToken(input.claimToken);
			if (options.scheduleRetryError === true) throw new Error("RPC_503");
			state.retryDelays.push(input.delaySeconds);
			state.attempt += 1;
			state.jobState = "queued";
			state.currentMessageId += 1;
		},
		async finalize(input): Promise<"succeeded" | "failed_duplicate"> {
			assertToken(input.claimToken);
			state.finalizeCalls += 1;
			if (options.finalizeError === true) {
				if (options.reconcileOutcome === "terminal_duplicate") {
					recordEvent({
						event: "worker_duplicate",
						queueMessageId: input.messageId,
						jobId: JOB_ID,
						batchId: BATCH_ID,
						errorCode: "DUPLICATE_EXISTING",
						reason: "COMPENSATION_PENDING",
						attempt: state.attempt,
					});
				}
				throw new Error("RPC_503");
			}
			const result = options.finalizeOutcome ?? "succeeded";
			state.jobState = result === "succeeded" ? "succeeded" : "failed";
			if (result === "failed_duplicate") {
				state.terminalMessageId = input.messageId;
				state.terminalClaimToken = input.claimToken;
				recordEvent({
					event: "worker_duplicate",
					queueMessageId: input.messageId,
					jobId: JOB_ID,
					batchId: BATCH_ID,
					errorCode: "DUPLICATE_EXISTING",
					reason: "COMPENSATION_PENDING",
					attempt: state.attempt,
				});
			}
			return result;
		},
		async reconcileFinalize() {
			const result = options.reconcileOutcome ?? "claim_owned_uncommitted";
			if (result === "terminal_success") state.jobState = "succeeded";
			if (result === "terminal_duplicate") state.jobState = "failed";
			return result;
		},
		async reconcileFailure(input) {
			if (options.failureReconcileError === true) throw new Error("RPC_503");
			if (options.failureReconcileOutcome !== undefined) {
				return options.failureReconcileOutcome;
			}
			if (state.jobState === "failed") {
				return state.terminalMessageId === input.messageId &&
					state.terminalClaimToken === input.claimToken
					? "terminal_failed"
					: "claim_lost";
			}
			return "claim_owned_uncommitted";
		},
		async fail(input): Promise<"failed"> {
			assertToken(input.claimToken);
			state.failCalls += 1;
			state.failureCodes.push(input.errorCode);
			state.jobState = "failed";
			state.terminalMessageId = input.messageId;
			state.terminalClaimToken = input.claimToken;
			if (input.eventType === "worker_failure") {
				recordEvent({
					event: "worker_failure",
					queueMessageId: input.messageId,
					jobId: JOB_ID,
					batchId: BATCH_ID,
					errorCode: input.errorCode,
					attempt: state.attempt,
				});
			}
			if (options.failError === true) throw new Error("RPC_503");
			return "failed";
		},
		async markObjectUploading(input): Promise<void> {
			assertToken(input.claimToken);
		},
		async markObjectOrphan(input): Promise<void> {
			assertToken(input.claimToken);
			state.objectOrphanCalls += 1;
		},
		async releaseSource(): Promise<
			| { readonly outcome: "retain" }
			| {
					readonly outcome: "delete";
					readonly bucket: "ai-card-sources" | "illustrations";
					readonly path: string;
			  }
		> {
			if (options.sourceReleaseOutcome === "retain") {
				state.sourceRetains += 1;
				return { outcome: "retain" };
			}
			return {
				outcome: "delete",
				bucket: options.sourceBucket ?? "ai-card-sources",
				path: `${BATCH_ID}/source`,
			};
		},
		async markSourceCleanup(): Promise<void> {
			state.sourceCleanupCalls += 1;
		},
		async markSourceDeleted(): Promise<void> {
			state.sourceDeletedCalls += 1;
		},
	};
	function assertToken(token: string): void {
		if (state.claimToken !== token) throw new Error("CLAIM_LOST");
	}
	const png = options.sourceBytes ?? pngFixture(128, 128);
	const storage: IllustrationStorage = {
		async readSource(bucket): Promise<Uint8Array> {
			state.sourceReadBuckets.push(bucket);
			return png;
		},
		async writeIllustration(path, bytes): Promise<StorageResult> {
			state.objectWrites += 1;
			const result = options.storageWriteResult ?? { kind: "success" };
			if (result.kind === "success") storageObjects.set(path, bytes);
			return result;
		},
		async readIllustration(path): Promise<Uint8Array | undefined> {
			if (options.illustrationReadThrows === true) {
				const { StorageNetworkError } = await import(
					"../../../../../supabase/functions/_shared/ai-card-import/storage.ts"
				);
				throw new StorageNetworkError();
			}
			return storageObjects.get(path);
		},
		async deleteObject(bucket, path): Promise<StorageResult> {
			if (bucket === "illustrations") {
				state.objectDeletes += 1;
				if (options.compensationDeleteResult !== undefined) {
					return options.compensationDeleteResult;
				}
			} else {
				state.sourceDeletes += 1;
				if (options.sourceDeleteThrows === true) throw new TypeError("network down");
			}
			storageObjects.delete(path);
			return { kind: "success" };
		},
	};
	const codec: ImageCodec = {
		decode: vi.fn(async () => {
			if (options.decodeError === true) throw new Error("codec decode failed");
			return options.decodedDimensions ?? { width: 128, height: 128 };
		}),
		encodePng: vi.fn(async ({ width, height }) => {
			if (options.encodeError === true) throw new Error("codec encode failed");
			return pngFixture(width, height);
		}),
	};
	const providerResult = options.providerResult ?? {
		kind: "success",
		bytes: png,
		declaredMime: "image/png",
	};
	const selectedProvider = {
		async generate(): Promise<ProviderResult> {
			state.providerCalls += 1;
			return providerResult;
		},
	};
	return {
		state,
		storageObjects,
		dependencies: {
			database,
			storage,
			codec,
			providerEnvironment: {
				ILLUSTRATION_PROVIDER: "openai",
				OPENAI_API_KEY: "fixture",
				OPENAI_IMAGE_MODEL: "fixture",
			},
			providers: { openai: selectedProvider, gemini: selectedProvider },
			now: () => new Date(now),
			randomUuid: () => CLAIM_TOKEN,
			log: (event) => state.logs.push(JSON.stringify(event)),
		},
		setDelivery(messageId, payload = { version: 1, jobId: JOB_ID, batchId: BATCH_ID }): void {
			delivery = { messageId, payload };
		},
		setNow(milliseconds): void {
			now = milliseconds;
		},
	};
}

export function pngFixture(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	for (const [offset, value] of [
		[16, width],
		[20, height],
	] as const) {
		bytes[offset] = (value >>> 24) & 255;
		bytes[offset + 1] = (value >>> 16) & 255;
		bytes[offset + 2] = (value >>> 8) & 255;
		bytes[offset + 3] = value & 255;
	}
	return bytes;
}

export function safeFailure(
	kind: "transient" | "permanent",
	code: SafeImportErrorCode
): ProviderResult {
	return kind === "permanent" ? { kind, code, httpStatus: 400 } : { kind, code };
}
