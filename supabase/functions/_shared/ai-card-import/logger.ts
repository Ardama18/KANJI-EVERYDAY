import type { ProviderName, SafeImportErrorCode } from "./contracts.ts";

export interface SafeLogEvent {
	readonly event:
		| "worker_success"
		| "worker_retry"
		| "worker_failure"
		| "worker_recoverable"
		| "worker_poison"
		| "worker_duplicate"
		| "cleanup";
	readonly eventId?: string;
	readonly invocationId?: string;
	readonly batchId?: string;
	readonly itemId?: string;
	readonly jobId?: string;
	readonly conceptJobId?: string;
	readonly provider?: ProviderName;
	readonly httpStatus?: number;
	readonly errorCode?: SafeImportErrorCode;
	readonly attempt?: number;
	readonly durationMs?: number;
	readonly queueMessageId?: number;
	readonly reason?:
		| "MALFORMED_PAYLOAD"
		| "JOB_MISSING"
		| "COMPENSATION_DELETED"
		| "COMPENSATION_PENDING";
}

export type SafeLogSink = (serialized: string) => void;

export function createSafeLogger(sink: SafeLogSink): (event: SafeLogEvent) => void {
	const emittedEventIds = new Set<string>();
	return (event) => {
		if (event.eventId !== undefined && emittedEventIds.has(event.eventId)) return;
		const record: Record<string, string | number> = { event: event.event };
		for (const key of [
			"eventId",
			"invocationId",
			"batchId",
			"itemId",
			"jobId",
			"conceptJobId",
		] as const) {
			const value = event[key];
			if (value !== undefined) record[key] = value;
		}
		if (event.provider !== undefined) record.provider = event.provider;
		if (event.httpStatus !== undefined) record.httpStatus = event.httpStatus;
		if (event.errorCode !== undefined) record.errorCode = event.errorCode;
		if (event.attempt !== undefined) record.attempt = event.attempt;
		if (event.durationMs !== undefined) record.durationMs = event.durationMs;
		if (event.queueMessageId !== undefined) record.queueMessageId = event.queueMessageId;
		if (event.reason !== undefined) record.reason = event.reason;
		sink(JSON.stringify(record));
		if (event.eventId !== undefined) emittedEventIds.add(event.eventId);
	};
}
