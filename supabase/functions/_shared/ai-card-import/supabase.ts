import { SAFE_IMPORT_ERROR_CODES, type SafeImportErrorCode } from "./contracts.ts";
import { generateIllustrationPrompt } from "../illustration-prompt-policy.ts";
import type {
	ClaimResult,
	PendingWorkerEvent,
	QueueDelivery,
	WorkerDatabase,
} from "./worker.ts";

export interface CleanupClaim {
	readonly trackingId: string;
	readonly bucket: "ai-card-sources" | "illustrations";
	readonly path: string;
	readonly claimToken: string;
}

export interface CleanupDatabase {
	claimCleanup(limit: number): Promise<readonly CleanupClaim[]>;
	verifyCleanup(claim: CleanupClaim): Promise<"delete" | "skip">;
	completeCleanup(claim: CleanupClaim, outcome: "deleted" | "retry"): Promise<void>;
}

export interface SupabaseDatabase extends WorkerDatabase, CleanupDatabase {}

export function createSupabaseDatabase(input: {
	readonly supabaseUrl: string;
	readonly serviceRoleKey: string;
	readonly fetchImplementation?: typeof fetch;
}): SupabaseDatabase {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	async function rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
		const response = await fetchImplementation(
			`${input.supabaseUrl.replace(/\/$/u, "")}/rest/v1/rpc/${name}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${input.serviceRoleKey}`,
					apikey: input.serviceRoleKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(args),
			}
		);
		if (!response.ok) throw new Error(`RPC_${response.status}`);
		if (response.status === 204) return undefined;
		return await response.json();
	}
	return {
		async readOne(visibilitySeconds): Promise<QueueDelivery | undefined> {
			const value = await rpc("read_ai_import_queue", {
				p_visibility_seconds: visibilitySeconds,
				p_quantity: 1,
			});
			if (!Array.isArray(value)) throw new Error("RPC_CONTRACT_ERROR");
			if (value.length === 0) return undefined;
			const row = value[0];
			if (!isRecord(row)) throw new Error("RPC_CONTRACT_ERROR");
			const messageId = numberValue(row.message_id);
			if (messageId === undefined) throw new Error("RPC_CONTRACT_ERROR");
			return { messageId, payload: row.message };
		},
		async claim(args): Promise<ClaimResult> {
			const value = await rpc("claim_ai_import_concept", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
			});
			return parseClaim(value);
		},
		async ackInert(jobId, messageId, event): Promise<boolean> {
			const value = await rpc("ack_inert_delivery", {
				p_job_id: jobId,
				p_message_id: messageId,
				p_event_type: event?.event ?? null,
				p_reason: event?.reason ?? null,
			});
			if (value !== true) throw new Error("RPC_CONTRACT_ERROR");
			return true;
		},
		async claimWorkerEvent(claimToken) {
			const value = await rpc("claim_ai_worker_log_outbox", {
				p_claim_token: claimToken,
			});
			if (!isRecord(value)) throw new Error("RPC_CONTRACT_ERROR");
			if (value.outcome === "empty") return undefined;
			if (value.outcome !== "claimed") throw new Error("RPC_CONTRACT_ERROR");
			return parseWorkerEvent(value);
		},
		async completeWorkerEvent(eventId, claimToken): Promise<void> {
			await rpc("complete_ai_worker_log_outbox", {
				p_event_id: eventId,
				p_claim_token: claimToken,
			});
		},
		async updateWorkerEventReason(messageId, event, reason): Promise<void> {
			await rpc("update_ai_worker_log_reason", {
				p_message_id: messageId,
				p_event_type: event,
				p_reason: reason,
			});
		},
		async scheduleRetry(args): Promise<void> {
			await rpc("schedule_ai_import_retry", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
				p_error_code: args.errorCode,
				p_delay_seconds: args.delaySeconds,
			});
		},
		async finalize(args): Promise<"succeeded" | "failed_duplicate"> {
			const value = await rpc("finalize_ai_import_concept", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
				p_illustration_id: args.illustrationId,
				p_digest: args.digest,
				p_width: args.width,
				p_height: args.height,
			});
			if (!isRecord(value)) throw new Error("RPC_CONTRACT_ERROR");
			if (value.status === "succeeded") return "succeeded";
			if (value.status === "failed" && value.errorCode === "DUPLICATE_EXISTING") {
				return "failed_duplicate";
			}
			throw new Error("RPC_CONTRACT_ERROR");
		},
		async reconcileFinalize(args) {
			const value = await rpc("get_ai_import_finalize_state", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
			});
			if (
				!isRecord(value) ||
				(value.outcome !== "terminal_success" &&
					value.outcome !== "terminal_duplicate" &&
					value.outcome !== "claim_owned_uncommitted" &&
					value.outcome !== "claim_lost")
			) {
				throw new Error("RPC_CONTRACT_ERROR");
			}
			return value.outcome;
		},
		async reconcileFailure(args) {
			const value = await rpc("get_ai_import_failure_state", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
			});
			if (
				!isRecord(value) ||
				(value.outcome !== "terminal_failed" &&
					value.outcome !== "claim_owned_uncommitted" &&
					value.outcome !== "claim_lost")
			) throw new Error("RPC_CONTRACT_ERROR");
			return value.outcome;
		},
		async fail(args): Promise<"failed"> {
			const value = await rpc("fail_ai_import_concept", {
				p_job_id: args.jobId,
				p_message_id: args.messageId,
				p_claim_token: args.claimToken,
				p_error_code: args.errorCode,
				p_event_type: args.eventType ?? null,
			});
			if (!isRecord(value) || value.status !== "failed") throw new Error("RPC_CONTRACT_ERROR");
			return "failed";
		},
		async markObjectUploading(args): Promise<void> {
			await rpc("mark_ai_illustration_uploading", {
				p_job_id: args.jobId,
				p_claim_token: args.claimToken,
				p_digest: args.digest,
				p_width: args.width,
				p_height: args.height,
			});
		},
		async markObjectOrphan(args): Promise<void> {
			await rpc("mark_ai_illustration_orphan", {
				p_job_id: args.jobId,
				p_claim_token: args.claimToken,
				p_error_code: args.errorCode,
			});
		},
		async releaseSource(jobId) {
			const value = await rpc("release_ai_source_after_terminal", { p_job_id: jobId });
			if (!isRecord(value) || (value.outcome !== "retain" && value.outcome !== "delete")) {
				throw new Error("RPC_CONTRACT_ERROR");
			}
			if (value.outcome === "retain") return { outcome: "retain" };
			const bucket = stringValue(value.bucket);
			const path = stringValue(value.path);
			if ((bucket !== "ai-card-sources" && bucket !== "illustrations") || path === undefined) {
				throw new Error("RPC_CONTRACT_ERROR");
			}
			return { outcome: "delete", bucket, path };
		},
		async markSourceCleanup(jobId, bucket, path): Promise<void> {
			await rpc("mark_ai_source_cleanup", {
				p_job_id: jobId,
				p_bucket: bucket,
				p_path: path,
			});
		},
		async markSourceDeleted(jobId, bucket, path): Promise<void> {
			await rpc("mark_ai_source_deleted", {
				p_job_id: jobId,
				p_bucket: bucket,
				p_path: path,
			});
		},
		async claimCleanup(limit): Promise<readonly CleanupClaim[]> {
			const value = await rpc("claim_ai_import_cleanup", { p_limit: limit });
			if (!Array.isArray(value)) throw new Error("RPC_CONTRACT_ERROR");
			return value.map(parseCleanupClaim);
		},
		async verifyCleanup(claim): Promise<"delete" | "skip"> {
			const value = await rpc("verify_ai_import_cleanup", {
				p_tracking_id: claim.trackingId,
				p_bucket: claim.bucket,
				p_path: claim.path,
				p_claim_token: claim.claimToken,
			});
			if (!isRecord(value) || (value.outcome !== "delete" && value.outcome !== "skip")) {
				throw new Error("RPC_CONTRACT_ERROR");
			}
			return value.outcome;
		},
		async completeCleanup(claim, outcome): Promise<void> {
			await rpc("complete_ai_import_cleanup", {
				p_tracking_id: claim.trackingId,
				p_bucket: claim.bucket,
				p_path: claim.path,
				p_claim_token: claim.claimToken,
				p_outcome: outcome,
			});
		},
	};
}

function parseClaim(value: unknown): ClaimResult {
	const row = isRecord(value) ? value : firstRecord(value);
	if (row === undefined || typeof row.outcome !== "string") throw new Error("RPC_CONTRACT_ERROR");
	if (["terminal", "stale", "active", "missing"].includes(row.outcome)) {
		return { outcome: row.outcome as "terminal" | "stale" | "active" | "missing" };
	}
	if (row.outcome !== "claimed") throw new Error("RPC_CONTRACT_ERROR");
	const jobId = stringValue(row.jobId ?? row.job_id);
	const batchId = stringValue(row.batchId ?? row.batch_id);
	const claimToken = stringValue(row.claimToken ?? row.claim_token);
	const attempt = numberValue(row.attempt);
	const imageMode = stringValue(row.imageMode ?? row.image_mode);
	if (
		jobId === undefined ||
		batchId === undefined ||
		claimToken === undefined ||
		attempt === undefined ||
		!isImageMode(imageMode)
	) {
		throw new Error("RPC_CONTRACT_ERROR");
	}
	return {
		outcome: "claimed",
		jobId,
		batchId,
		claimToken,
		attempt,
		imageMode,
		prompt: parseClaimPrompt(row, imageMode),
		sourcePath: stringValue(row.sourcePath ?? row.source_path),
		sourceBucket: sourceBucketValue(row.sourceBucket ?? row.source_bucket),
		sourceMime: stringValue(row.sourceMime ?? row.source_mime),
		illustrationId: stringValue(row.illustrationId ?? row.illustration_id),
		illustrationPath: stringValue(row.illustrationPath ?? row.illustration_path),
	};
}

function parseClaimPrompt(
	row: Readonly<Record<string, unknown>>,
	imageMode: "none" | "ai" | "upload"
): string | undefined {
	if (imageMode !== "ai") return undefined;
	const backText = stringValue(row.backText ?? row.back_text);
	const skill = stringValue(row.skill);
	if (backText === undefined || (skill !== "reading" && skill !== "writing")) {
		throw new Error("RPC_CONTRACT_ERROR");
	}
	return generateIllustrationPrompt(backText, skill);
}

function parseCleanupClaim(value: unknown): CleanupClaim {
	if (!isRecord(value)) throw new Error("RPC_CONTRACT_ERROR");
	const trackingId = stringValue(value.trackingId ?? value.tracking_id);
	const bucket = stringValue(value.bucket);
	const path = stringValue(value.path);
	const claimToken = stringValue(value.claimToken ?? value.claim_token);
	if (
		trackingId === undefined ||
		(bucket !== "ai-card-sources" && bucket !== "illustrations") ||
		path === undefined ||
		claimToken === undefined
	) {
		throw new Error("RPC_CONTRACT_ERROR");
	}
	return { trackingId, bucket, path, claimToken };
}

function parseWorkerEvent(value: Readonly<Record<string, unknown>>): PendingWorkerEvent {
	const eventId = stringValue(value.eventId ?? value.event_id);
	const event = stringValue(value.event);
	const queueMessageId = numberValue(value.queueMessageId ?? value.queue_message_id);
	const reason = stringValue(value.reason);
	if (
		eventId === undefined ||
		queueMessageId === undefined ||
		(event !== "worker_failure" && event !== "worker_poison" && event !== "worker_duplicate") ||
		(reason !== undefined &&
			reason !== "MALFORMED_PAYLOAD" &&
			reason !== "JOB_MISSING" &&
			reason !== "COMPENSATION_DELETED" &&
			reason !== "COMPENSATION_PENDING")
	) throw new Error("RPC_CONTRACT_ERROR");
	return {
		eventId,
		event: event as PendingWorkerEvent["event"],
		queueMessageId,
		jobId: stringValue(value.jobId ?? value.job_id),
		batchId: stringValue(value.batchId ?? value.batch_id),
		errorCode:
			value.errorCode === null || value.error_code === null
				? undefined
				: optionalSafeCode(value.errorCode ?? value.error_code),
		reason: reason as PendingWorkerEvent["reason"],
		attempt: numberValue(value.attempt),
	};
}

function firstRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function isImageMode(value: string | undefined): value is "none" | "ai" | "upload" {
	return value === "none" || value === "ai" || value === "upload";
}

function sourceBucketValue(value: unknown): "ai-card-sources" | "illustrations" | undefined {
	return value === "ai-card-sources" || value === "illustrations" ? value : undefined;
}

export function safeCode(value: unknown): SafeImportErrorCode {
	if (!isSafeImportErrorCode(value)) throw new Error("RPC_CONTRACT_ERROR");
	return value;
}

function optionalSafeCode(value: unknown): SafeImportErrorCode | undefined {
	return value === undefined ? undefined : safeCode(value);
}

function isSafeImportErrorCode(value: unknown): value is SafeImportErrorCode {
	return (
		typeof value === "string" && SAFE_IMPORT_ERROR_CODES.some((candidate) => candidate === value)
	);
}
