import type { IllustrationProvider, ProviderName, SafeImportErrorCode } from "./contracts.ts";
import { parseQueueMessage } from "./contracts.ts";
import type { ImageCodec } from "./image-codec.ts";
import { normalizeIllustration } from "./image-codec.ts";
import { inspectImage, MAX_ILLUSTRATION_EDGE } from "./image-validation.ts";
import type { SafeLogEvent } from "./logger.ts";
import type { ProviderEnvironment } from "./provider.ts";
import { ILLUSTRATION_PROVIDER_TIMEOUT_MS, selectProvider } from "./provider.ts";
import { retryDelaySeconds } from "./retry-policy.ts";
import type { IllustrationStorage, StorageResult } from "./storage.ts";
import {
	StorageContractError,
	StorageHttpError,
	StorageNetworkError,
	StorageSizeLimitError,
	sha256Hex,
} from "./storage.ts";

export interface QueueDelivery {
	readonly messageId: number;
	readonly payload: unknown;
}

export interface ClaimedConcept {
	readonly outcome: "claimed";
	readonly jobId: string;
	readonly batchId: string;
	readonly claimToken: string;
	readonly attempt: number;
	readonly imageMode: "none" | "ai" | "upload";
	readonly prompt?: string;
	readonly sourceBucket?: "ai-card-sources" | "illustrations";
	readonly sourcePath?: string;
	readonly sourceMime?: string;
	readonly illustrationId?: string;
	readonly illustrationPath?: string;
}

export type ClaimResult =
	| ClaimedConcept
	| { readonly outcome: "terminal" | "stale" | "active" | "missing" };

export interface PendingWorkerEvent {
	readonly eventId: string;
	readonly event: "worker_failure" | "worker_poison" | "worker_duplicate";
	readonly queueMessageId: number;
	readonly jobId?: string;
	readonly batchId?: string;
	readonly errorCode?: SafeImportErrorCode;
	readonly reason?: SafeLogEvent["reason"];
	readonly attempt?: number;
}

export interface WorkerDatabase {
	readOne(visibilitySeconds: 300): Promise<QueueDelivery | undefined>;
	claim(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
	}): Promise<ClaimResult>;
	ackInert(
		jobId: string,
		messageId: number,
		event?: { readonly event: "worker_poison"; readonly reason: "MALFORMED_PAYLOAD" | "JOB_MISSING" }
	): Promise<boolean>;
	claimWorkerEvent(claimToken: string): Promise<PendingWorkerEvent | undefined>;
	completeWorkerEvent(eventId: string, claimToken: string): Promise<void>;
	updateWorkerEventReason(
		messageId: number,
		event: "worker_duplicate",
		reason: "COMPENSATION_DELETED" | "COMPENSATION_PENDING"
	): Promise<void>;
	scheduleRetry(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
		readonly errorCode: SafeImportErrorCode;
		readonly delaySeconds: number;
	}): Promise<void>;
	reconcileFinalize(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
	}): Promise<
		| "terminal_success"
		| "terminal_duplicate"
		| "claim_owned_uncommitted"
		| "claim_lost"
	>;
	reconcileFailure(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
	}): Promise<"terminal_failed" | "claim_owned_uncommitted" | "claim_lost">;
	finalize(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
		readonly illustrationId?: string;
		readonly digest?: string;
		readonly width?: number;
		readonly height?: number;
	}): Promise<"succeeded" | "failed_duplicate">;
	fail(input: {
		readonly jobId: string;
		readonly messageId: number;
		readonly claimToken: string;
		readonly errorCode: SafeImportErrorCode;
		readonly eventType?: "worker_failure";
	}): Promise<"failed">;
	markObjectUploading(input: {
		readonly jobId: string;
		readonly claimToken: string;
		readonly digest: string;
		readonly width: number;
		readonly height: number;
	}): Promise<void>;
	markObjectOrphan(input: {
		readonly jobId: string;
		readonly claimToken: string;
		readonly errorCode: SafeImportErrorCode;
	}): Promise<void>;
	releaseSource(jobId: string): Promise<
		| { readonly outcome: "retain" }
		| {
				readonly outcome: "delete";
				readonly bucket: "ai-card-sources" | "illustrations";
				readonly path: string;
		  }
	>;
	markSourceCleanup(
		jobId: string,
		bucket: "ai-card-sources" | "illustrations",
		path: string
	): Promise<void>;
	markSourceDeleted(
		jobId: string,
		bucket: "ai-card-sources" | "illustrations",
		path: string
	): Promise<void>;
}

export interface WorkerDependencies {
	readonly database: WorkerDatabase;
	readonly storage: IllustrationStorage;
	readonly codec: ImageCodec;
	readonly providerEnvironment: ProviderEnvironment;
	readonly providers: Readonly<Record<ProviderName, IllustrationProvider>>;
	readonly now: () => Date;
	readonly randomUuid: () => string;
	readonly log: (event: SafeLogEvent) => void;
}

export type WorkerOutcome =
	| "idle"
	| "acked"
	| "busy"
	| "retried"
	| "succeeded"
	| "failed"
	| "recoverable";

export async function processOneConcept(dependencies: WorkerDependencies): Promise<WorkerOutcome> {
	const startedAt = dependencies.now().getTime();
	await dispatchPendingWorkerEvent(dependencies);
	const delivery = await dependencies.database.readOne(300);
	if (delivery === undefined) return "idle";
	const payload = parseQueueMessage(delivery.payload);
	if (payload === undefined) {
		return await finalizePoison(
			dependencies,
			"00000000-0000-4000-8000-000000000000",
			delivery.messageId,
			"MALFORMED_PAYLOAD"
		);
	}
	const claim = await dependencies.database.claim({
		jobId: payload.jobId,
		messageId: delivery.messageId,
		claimToken: dependencies.randomUuid(),
	});
	if (claim.outcome === "missing") {
		return await finalizePoison(
			dependencies,
			payload.jobId,
			delivery.messageId,
			"JOB_MISSING"
		);
	}
	if (claim.outcome === "terminal" || claim.outcome === "stale") {
		if (!(await dependencies.database.ackInert(payload.jobId, delivery.messageId))) {
			throw new Error("ACK_UNCONFIRMED");
		}
		return "acked";
	}
	if (claim.outcome === "active") return "busy";
	if (claim.outcome !== "claimed") return "busy";

	let outcome: WorkerOutcome = "recoverable";
	try {
		if (claim.imageMode === "none") {
			const finalizeOutcome = await dependencies.database.finalize(
				claimIdentity(claim, delivery.messageId)
			);
			outcome = await handleConfirmedFinalize(
				dependencies,
				claim,
				startedAt,
				finalizeOutcome,
				undefined,
				delivery.messageId
			);
			return outcome;
		}
		const source = await obtainImage(dependencies, claim);
		if (source.kind !== "success") {
			outcome = await handleProviderFailure(
				dependencies,
				claim,
				delivery.messageId,
				source,
				startedAt
			);
			return outcome;
		}
		if (claim.imageMode === "ai") {
			const inspected = inspectImage(source.bytes, source.declaredMime, { illustration: true });
			if (!inspected.ok) throw new Error(inspected.code);
			if (
				inspected.width > MAX_ILLUSTRATION_EDGE ||
				inspected.height > MAX_ILLUSTRATION_EDGE
			) throw new Error("IMAGE_DIMENSIONS_INVALID");
		}
		const normalized = await normalizeIllustration(
			{ bytes: source.bytes, declaredMime: source.declaredMime },
			dependencies.codec
		);
		if (claim.illustrationId === undefined || claim.illustrationPath === undefined) {
			outcome = await failWithReconciliation(
				dependencies,
				claim,
				delivery.messageId,
				"INTERNAL_ERROR"
			);
			return outcome;
		}
		const digest = await sha256Hex(normalized.bytes);
		await dependencies.database.markObjectUploading({
			jobId: claim.jobId,
			claimToken: claim.claimToken,
			digest,
			width: normalized.width,
			height: normalized.height,
		});
		const write = await dependencies.storage.writeIllustration(
			claim.illustrationPath,
			normalized.bytes
		);
		const storageOutcome = await resolveStorageWrite(
			dependencies,
			claim,
			normalized.bytes,
			digest,
			write
		);
		if (storageOutcome.kind !== "success") {
			outcome = await handleStorageFailure(
				dependencies,
				claim,
				delivery.messageId,
				storageOutcome,
				startedAt
			);
			return outcome;
		}
		let finalizeOutcome: "succeeded" | "failed_duplicate";
		try {
			finalizeOutcome = await dependencies.database.finalize({
				...claimIdentity(claim, delivery.messageId),
				illustrationId: claim.illustrationId,
				digest,
				width: normalized.width,
				height: normalized.height,
			});
		} catch {
			outcome = await reconcileAmbiguousFinalize(
				dependencies,
				claim,
				delivery.messageId,
				claim.illustrationPath,
				startedAt
			);
			return outcome;
		}
		outcome = await handleConfirmedFinalize(
			dependencies,
			claim,
			startedAt,
			finalizeOutcome,
			claim.illustrationPath,
			delivery.messageId
		);
		return outcome;
	} catch (error) {
		const code =
			error instanceof Error && isSafeImageCode(error.message) ? error.message : "INTERNAL_ERROR";
		if (code === "INTERNAL_ERROR") {
			outcome = "recoverable";
			logOutcome(dependencies, claim, startedAt, "worker_recoverable", code);
			return outcome;
		}
		outcome = await failWithReconciliation(dependencies, claim, delivery.messageId, code);
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", code);
		return outcome;
	} finally {
		if (claim.imageMode === "upload" && (outcome === "succeeded" || outcome === "failed")) {
			let release:
				| { readonly outcome: "retain" }
				| {
						readonly outcome: "delete";
						readonly bucket: "ai-card-sources" | "illustrations";
						readonly path: string;
				  }
				| undefined;
			try {
				release = await dependencies.database.releaseSource(claim.jobId);
				if (release.outcome === "delete") {
					const deleted = await dependencies.storage.deleteObject(release.bucket, release.path);
					if (deleted.kind === "success" || deleted.kind === "not_found") {
						await dependencies.database.markSourceDeleted(
							claim.jobId,
							release.bucket,
							release.path
						);
					} else {
						await dependencies.database.markSourceCleanup(
							claim.jobId,
							release.bucket,
							release.path
						);
					}
				}
			} catch {
				if (release?.outcome === "delete") {
					try {
						await dependencies.database.markSourceCleanup(
							claim.jobId,
							release.bucket,
							release.path
						);
					} catch {
						// The durable association and due timestamp remain the cleanup fallback.
					}
				}
			}
		}
	}
}

type ImageResult =
	| { readonly kind: "success"; readonly bytes: Uint8Array; readonly declaredMime: string }
	| {
			readonly kind: "transient" | "permanent";
			readonly code: SafeImportErrorCode;
			readonly httpStatus?: number;
	  };

async function finalizePoison(
	dependencies: WorkerDependencies,
	jobId: string,
	messageId: number,
	reason: "MALFORMED_PAYLOAD" | "JOB_MISSING"
): Promise<"acked" | "recoverable"> {
	const confirmed = await dependencies.database.ackInert(jobId, messageId, {
		event: "worker_poison",
		reason,
	});
	if (!confirmed) {
		dependencies.log({
			event: "worker_recoverable",
			errorCode: "INVALID_QUEUE_MESSAGE",
			queueMessageId: messageId,
		});
		return "recoverable";
	}
	await dispatchPendingWorkerEvent(dependencies);
	return "acked";
}

async function dispatchPendingWorkerEvent(dependencies: WorkerDependencies): Promise<void> {
	const dispatchToken = dependencies.randomUuid();
	const pending = await dependencies.database.claimWorkerEvent(dispatchToken);
	if (pending === undefined) return;
	dependencies.log({
		eventId: pending.eventId,
		event: pending.event,
		queueMessageId: pending.queueMessageId,
		jobId: pending.jobId,
		batchId: pending.batchId,
		errorCode: pending.errorCode,
		reason: pending.reason,
		attempt: pending.attempt,
	});
	await dependencies.database.completeWorkerEvent(pending.eventId, dispatchToken);
}

async function dispatchPendingWorkerEventAfterTerminal(
	dependencies: WorkerDependencies
): Promise<void> {
	try {
		await dispatchPendingWorkerEvent(dependencies);
	} catch {
		// Terminal state, queue archival, and the stable outbox event are already durable.
		// Leave the event reclaimable; transport details may contain unsafe data and are not logged.
	}
}

async function obtainImage(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept
): Promise<ImageResult> {
	if (claim.imageMode === "upload") {
		if (
			claim.sourceBucket === undefined ||
			claim.sourcePath === undefined ||
			claim.sourceMime === undefined
		) {
			return { kind: "permanent", code: "IMAGE_FORMAT_INVALID" };
		}
		try {
			return {
				kind: "success",
				bytes: await dependencies.storage.readSource(claim.sourceBucket, claim.sourcePath),
				declaredMime: claim.sourceMime,
			};
		} catch (error) {
			if (error instanceof StorageNetworkError) {
				return { kind: "transient", code: "STORAGE_TRANSIENT_ERROR" };
			}
			if (error instanceof StorageHttpError) {
				return isTransientStatus(error.status)
					? { kind: "transient", code: "STORAGE_TRANSIENT_ERROR", httpStatus: error.status }
					: { kind: "permanent", code: "STORAGE_PERMANENT_ERROR", httpStatus: error.status };
			}
			if (error instanceof StorageSizeLimitError) {
				return { kind: "permanent", code: "IMAGE_TOO_LARGE" };
			}
			if (error instanceof StorageContractError) {
				return { kind: "permanent", code: "STORAGE_PERMANENT_ERROR" };
			}
			return { kind: "permanent", code: "STORAGE_PERMANENT_ERROR" };
		}
	}
	if (claim.prompt === undefined) return { kind: "permanent", code: "PROVIDER_CONFIG_ERROR" };
	let selected: ReturnType<typeof selectProvider>;
	try {
		selected = selectProvider(dependencies.providerEnvironment, dependencies.providers);
	} catch {
		return { kind: "permanent", code: "PROVIDER_CONFIG_ERROR" };
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ILLUSTRATION_PROVIDER_TIMEOUT_MS);
	try {
		return await selected.provider.generate({ prompt: claim.prompt, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

async function reconcileAmbiguousFinalize(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	messageId: number,
	illustrationPath: string,
	startedAt: number
): Promise<WorkerOutcome> {
	let state:
		| "terminal_success"
		| "terminal_duplicate"
		| "claim_owned_uncommitted"
		| "claim_lost";
	try {
		state = await dependencies.database.reconcileFinalize(claimIdentity(claim, messageId));
	} catch {
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", "INTERNAL_ERROR");
		return "recoverable";
	}
	if (state === "terminal_success") {
		logOutcome(dependencies, claim, startedAt, "worker_success");
		return "succeeded";
	}
	if (state === "terminal_duplicate") {
		return await handleConfirmedFinalize(
			dependencies,
			claim,
			startedAt,
			"failed_duplicate",
			illustrationPath,
			messageId
		);
	}
	if (state !== "claim_owned_uncommitted") {
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", "CLAIM_LOST");
		return "recoverable";
	}
	try {
		await dependencies.database.markObjectOrphan({
			jobId: claim.jobId,
			claimToken: claim.claimToken,
			errorCode: "INTERNAL_ERROR",
		});
	} catch {
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", "INTERNAL_ERROR");
		return "recoverable";
	}
	const compensated = await dependencies.storage.deleteObject("illustrations", illustrationPath);
	if (compensated.kind !== "success" && compensated.kind !== "not_found") {
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", "INTERNAL_ERROR");
		return "recoverable";
	}
	logOutcome(dependencies, claim, startedAt, "worker_recoverable", "INTERNAL_ERROR");
	return "recoverable";
}

async function handleConfirmedFinalize(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	startedAt: number,
	finalizeOutcome: "succeeded" | "failed_duplicate",
	illustrationPath?: string,
	messageId?: number
): Promise<"succeeded" | "failed"> {
	if (finalizeOutcome === "succeeded") {
		logOutcome(dependencies, claim, startedAt, "worker_success");
		return "succeeded";
	}
	let reason: "COMPENSATION_DELETED" | "COMPENSATION_PENDING" | undefined;
	if (illustrationPath !== undefined) {
		reason = await deleteConfirmedOrphan(dependencies, illustrationPath);
	}
	if (messageId !== undefined && reason !== undefined) {
		try {
			await dependencies.database.updateWorkerEventReason(messageId, "worker_duplicate", reason);
		} catch {
			// The transactionally recorded event remains dispatchable with COMPENSATION_PENDING.
		}
	}
	await dispatchPendingWorkerEventAfterTerminal(dependencies);
	return "failed";
}

async function handleProviderFailure(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	messageId: number,
	failure: Exclude<ImageResult, { readonly kind: "success" }>,
	startedAt: number
): Promise<WorkerOutcome> {
	if (failure.kind === "transient") {
		const delaySeconds = retryDelaySeconds(claim.attempt);
		if (delaySeconds !== undefined) {
			try {
				await dependencies.database.scheduleRetry({
					...claimIdentity(claim, messageId),
					errorCode: failure.code,
					delaySeconds,
				});
			} catch {
				logOutcome(dependencies, claim, startedAt, "worker_recoverable", failure.code);
				return "recoverable";
			}
			dependencies.log({
				event: "worker_retry",
				batchId: claim.batchId,
				jobId: claim.jobId,
				errorCode: failure.code,
				httpStatus: failure.httpStatus,
				attempt: claim.attempt,
			});
			return "retried";
		}
	}
	const durableFailure = isNormalTerminalFailure(failure);
	const outcome = await failWithReconciliation(
		dependencies,
		claim,
		messageId,
		failure.code,
		durableFailure ? "worker_failure" : undefined
	);
	if (outcome === "failed") {
		if (durableFailure) await dispatchPendingWorkerEventAfterTerminal(dependencies);
		else logOutcome(dependencies, claim, startedAt, "worker_recoverable", failure.code);
	} else {
		logOutcome(dependencies, claim, startedAt, "worker_recoverable", failure.code);
	}
	return outcome;
}

async function failWithReconciliation(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	messageId: number,
	errorCode: SafeImportErrorCode,
	eventType?: "worker_failure"
): Promise<WorkerOutcome> {
	try {
		await dependencies.database.fail({
			...claimIdentity(claim, messageId),
			errorCode,
			eventType,
		});
		return "failed";
	} catch {
		try {
			const state = await dependencies.database.reconcileFailure(claimIdentity(claim, messageId));
			return state === "terminal_failed" ? "failed" : "recoverable";
		} catch {
			return "recoverable";
		}
	}
}

async function handleStorageFailure(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	messageId: number,
	failure: Exclude<StorageWriteOutcome, { readonly kind: "success" }>,
	startedAt: number
): Promise<WorkerOutcome> {
	const code =
		failure.kind === "transient"
			? "STORAGE_TRANSIENT_ERROR"
			: failure.kind === "conflict"
				? "OBJECT_CONFLICT"
				: "STORAGE_PERMANENT_ERROR";
	const outcome = await handleProviderFailure(dependencies, claim, messageId, {
		kind: failure.kind === "transient" ? "transient" : "permanent",
		code,
		httpStatus: failure.kind === "conflict" ? undefined : failure.httpStatus,
	}, startedAt);
	if (outcome === "failed" && claim.illustrationPath !== undefined) {
		await deleteConfirmedOrphan(dependencies, claim.illustrationPath);
	}
	return outcome;
}

async function deleteConfirmedOrphan(
	dependencies: WorkerDependencies,
	illustrationPath: string
): Promise<"COMPENSATION_DELETED" | "COMPENSATION_PENDING"> {
	try {
		const result = await dependencies.storage.deleteObject("illustrations", illustrationPath);
		return result.kind === "success" || result.kind === "not_found"
			? "COMPENSATION_DELETED"
			: "COMPENSATION_PENDING";
	} catch {
		// The DB-confirmed orphan row remains due and fenced for cleanup retry.
		return "COMPENSATION_PENDING";
	}
}

async function resolveStorageWrite(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	bytes: Uint8Array,
	digest: string,
	result: StorageResult
): Promise<StorageWriteOutcome> {
	if (result.kind === "success") return { kind: "success" };
	if (result.kind === "not_found") return { kind: "permanent", httpStatus: 404 };
	if (result.kind === "transient") return { kind: "transient", httpStatus: result.httpStatus };
	if (result.kind === "permanent") return { kind: "permanent", httpStatus: result.httpStatus };
	if (claim.illustrationPath === undefined) return { kind: "conflict" };
	let existing: Uint8Array | undefined;
	try {
		existing = await dependencies.storage.readIllustration(claim.illustrationPath);
	} catch (error) {
		if (error instanceof StorageNetworkError) return { kind: "transient" };
		if (error instanceof StorageHttpError) {
			return isTransientStatus(error.status)
				? { kind: "transient", httpStatus: error.status }
				: { kind: "permanent", httpStatus: error.status };
		}
		return { kind: "permanent" };
	}
	if (
		existing === undefined ||
		(await sha256Hex(existing)) !== digest ||
		existing.byteLength !== bytes.byteLength
	)
		return { kind: "conflict" };
	return { kind: "success" };
}

type StorageWriteOutcome =
	| { readonly kind: "success" }
	| { readonly kind: "transient" | "permanent"; readonly httpStatus?: number }
	| { readonly kind: "conflict"; readonly httpStatus?: undefined };

function isNormalTerminalFailure(
	failure: Exclude<ImageResult, { readonly kind: "success" }>
): boolean {
	if (failure.kind === "transient") {
		return (
			failure.code === "PROVIDER_TRANSIENT_ERROR" ||
			failure.code === "STORAGE_TRANSIENT_ERROR"
		);
	}
	return (
		failure.httpStatus !== undefined &&
		(failure.code === "PROVIDER_PERMANENT_ERROR" ||
			failure.code === "STORAGE_PERMANENT_ERROR")
	);
}

function claimIdentity(claim: ClaimedConcept, messageId: number) {
	return { jobId: claim.jobId, messageId, claimToken: claim.claimToken };
}

function logOutcome(
	dependencies: WorkerDependencies,
	claim: ClaimedConcept,
	startedAt: number,
	event: SafeLogEvent["event"],
	errorCode?: SafeImportErrorCode
): void {
	dependencies.log({
		event,
		batchId: claim.batchId,
		jobId: claim.jobId,
		errorCode,
		attempt: claim.attempt,
		durationMs: Math.max(0, dependencies.now().getTime() - startedAt),
	});
}

function isSafeImageCode(value: string): value is SafeImportErrorCode {
	return [
		"IMAGE_FORMAT_INVALID",
		"IMAGE_TOO_LARGE",
		"IMAGE_DIMENSIONS_INVALID",
		"IMAGE_DECODE_FAILED",
	].includes(value);
}

function isTransientStatus(status: number): boolean {
	return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
