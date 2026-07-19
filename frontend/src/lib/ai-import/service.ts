import type { PreviewEnvelope } from "../ai-card-generation/contracts";
import {
	type CommitAsyncResponse,
	type ImportStatusResponse,
	normalizedRequestToJson,
	parseCommitAsyncResponse,
	parseImportStatusResponse,
} from "./async-contract";
import { hashImportRequest } from "./canonical-request";
import {
	AI_IMPORT_ERROR_CODES,
	type AiImportError,
	type AiImportErrorCode,
	mapAiImportError,
} from "./errors";
import {
	PreviewValidationError,
	createImportPreview,
	createRemoteImportPreview,
} from "./preview-service";
import { PreviewTokenError, verifyPreviewToken, verifyRemotePreviewToken } from "./preview-token";
import { type NormalizedImportRequest, validateImportRequest } from "./schema";
import { isCanonicalUuid } from "./uuid";

/**
 * Authentication adapters construct this context from an already verified identity.
 * It is deliberately not derived from route or tool input.
 */
export type AiImportActorContext =
	| Readonly<{ userId: string; kind: "app_ai" }>
	| Readonly<{ userId: string; clientId: string; kind: "remote_mcp" }>;

export interface AiImportRepositoryResult<T> {
	readonly data: T;
	readonly error: unknown | null;
}

/**
 * A repository is actor-bound when an adapter creates it.  In particular, this
 * interface intentionally has no caller-selected owner, source, or quota policy.
 */
export interface AiImportRepository {
	validatePreview(
		input: Readonly<{
			deckId: string;
			reservationKey: string;
			importRequestHash: string;
			uploadIds: readonly string[];
			items: readonly { readonly clientItemId: string; readonly cardKey: string }[];
		}>
	): Promise<AiImportRepositoryResult<void>>;
	commit(
		input: Readonly<{
			idempotencyKey: string;
			importRequestHash: string;
			request: NormalizedImportRequest;
			cardReservationKey: string;
			previewToken: string;
		}>
	): Promise<AiImportRepositoryResult<unknown>>;
	getStatus(
		input: Readonly<{
			batchId: string | null;
			idempotencyKey: string | null;
		}>
	): Promise<AiImportRepositoryResult<unknown>>;
}

export interface AiImportServiceError {
	readonly code: AiImportErrorCode | "CONFIRMATION_REQUIRED" | "NOT_FOUND";
	readonly httpStatus: number;
}

export type AiImportServiceResult<T> =
	| Readonly<{ ok: true; data: T }>
	| Readonly<{ ok: false; error: AiImportServiceError }>;

export interface PreviewCardImportInput {
	readonly actor: AiImportActorContext;
	readonly request: unknown;
	readonly cardReservationKey: unknown;
	readonly repository: AiImportRepository;
	readonly secret: string;
	readonly nowSeconds: number;
}

export interface CommitCardImportInput {
	readonly actor: AiImportActorContext;
	readonly input: unknown;
	readonly repository: AiImportRepository;
	readonly secret: string;
	readonly nowSeconds: number;
	readonly correlationId: string;
}

export interface GetImportStatusInput {
	readonly input: unknown;
	readonly repository: AiImportRepository;
	readonly correlationId: string;
}

export async function previewCardImport(
	input: PreviewCardImportInput
): Promise<AiImportServiceResult<PreviewEnvelope>> {
	const cardReservationKey = boundedString(input.cardReservationKey, 128);
	if (cardReservationKey === undefined) return validationFailure();
	try {
		const dependencies = {
			secret: input.secret,
			nowSeconds: input.nowSeconds,
			validateDatabase: async (value: Parameters<AiImportRepository["validatePreview"]>[0]) => {
				const result = await input.repository.validatePreview(value);
				if (result.error !== null) {
					const mapped = mapAiImportError(result.error, "unavailable");
					throw new PreviewValidationError(mapped.code, mapped.httpStatus);
				}
			},
		};
		const preview =
			input.actor.kind === "app_ai"
				? await createImportPreview(
						input.actor.userId,
						input.request,
						cardReservationKey,
						dependencies
					)
				: await createRemoteImportPreview(
						{ userId: input.actor.userId, clientId: input.actor.clientId },
						input.request,
						cardReservationKey,
						dependencies
					);
		return { ok: true, data: preview };
	} catch (error) {
		if (error instanceof PreviewValidationError) {
			return failure(
				isAiImportErrorCode(error.code) ? error.code : "INTERNAL_ERROR",
				error.httpStatus
			);
		}
		return internalFailure();
	}
}

export async function commitCardImport(
	input: CommitCardImportInput
): Promise<AiImportServiceResult<CommitAsyncResponse>> {
	const parsed = parseCommitInput(input.input);
	if (parsed === undefined) return validationFailure();
	if (!parsed.confirmedWarnings) return failure("CONFIRMATION_REQUIRED", 400);

	try {
		const validated = await validateImportRequest(parsed.request);
		if (!validated.success) {
			return failure(validated.code, validated.code === "DUPLICATE_IN_REQUEST" ? 409 : 400);
		}
		const computedHash = await hashImportRequest(validated.data);
		if (computedHash !== parsed.importRequestHash) return validationFailure();
		try {
			if (input.actor.kind === "app_ai") {
				await verifyPreviewToken(
					parsed.previewToken,
					{
						userId: input.actor.userId,
						reservationKey: parsed.cardReservationKey,
						importRequestHash: parsed.importRequestHash,
					},
					input.secret,
					input.nowSeconds
				);
			} else {
				await verifyRemotePreviewToken(
					parsed.previewToken,
					{
						userId: input.actor.userId,
						clientId: input.actor.clientId,
						reservationKey: parsed.cardReservationKey,
						importRequestHash: parsed.importRequestHash,
					},
					input.secret,
					input.nowSeconds
				);
			}
		} catch (error) {
			if (error instanceof PreviewTokenError) return failure("UNAUTHORIZED", 401);
			throw error;
		}
		let result: AiImportRepositoryResult<unknown>;
		try {
			result = await input.repository.commit({
				idempotencyKey: parsed.idempotencyKey,
				importRequestHash: parsed.importRequestHash,
				request: validated.data,
				cardReservationKey: parsed.cardReservationKey,
				previewToken: parsed.previewToken,
			});
		} catch {
			return failure("SERVICE_UNAVAILABLE", 503);
		}
		if (result.error !== null) {
			const mapped = mapAiImportError(result.error, input.correlationId);
			return mapped.code === "INTERNAL_ERROR"
				? failure("SERVICE_UNAVAILABLE", 503)
				: failure(mapped.code, mapped.httpStatus);
		}
		const response = parseCommitAsyncResponse(result.data);
		return response === undefined ? internalFailure() : { ok: true, data: response };
	} catch (error) {
		return mappedFailure(error, input.correlationId);
	}
}

export async function getImportStatus(
	input: GetImportStatusInput
): Promise<AiImportServiceResult<ImportStatusResponse>> {
	const parsed = parseStatusInput(input.input);
	if (parsed === undefined) return validationFailure();
	let result: AiImportRepositoryResult<unknown>;
	try {
		result = await input.repository.getStatus(parsed);
	} catch {
		return failure("SERVICE_UNAVAILABLE", 503);
	}
	if (result.error !== null) {
		const mapped = mapAiImportError(result.error, input.correlationId);
		return mapped.httpStatus === 404
			? failure("NOT_FOUND", 404)
			: failure(mapped.code, Math.max(500, mapped.httpStatus));
	}
	const response = parseImportStatusResponse(result.data);
	return response === undefined ? failure("INTERNAL_ERROR", 502) : { ok: true, data: response };
}

export function normalizedCommitRequest(request: NormalizedImportRequest) {
	return normalizedRequestToJson(request);
}

function parseCommitInput(value: unknown):
	| Readonly<{
			confirmedWarnings: boolean;
			idempotencyKey: string;
			importRequestHash: string;
			cardReservationKey: string;
			previewToken: string;
			request: unknown;
	  }>
	| undefined {
	if (!isRecord(value)) return undefined;
	const idempotencyKey = boundedString(value.idempotencyKey, 128);
	const cardReservationKey = boundedString(value.cardReservationKey, 128);
	const previewToken = boundedString(value.previewToken, 4096);
	const importRequestHash = hexHash(value.importRequestHash);
	if (
		idempotencyKey === undefined ||
		cardReservationKey === undefined ||
		previewToken === undefined ||
		importRequestHash === undefined
	) {
		return undefined;
	}
	return {
		confirmedWarnings: value.confirmedWarnings === true,
		idempotencyKey,
		importRequestHash,
		cardReservationKey,
		previewToken,
		request: value.request,
	};
}

function parseStatusInput(
	value: unknown
): Readonly<{ batchId: string | null; idempotencyKey: string | null }> | undefined {
	if (!isRecord(value)) return undefined;
	const batchId = value.batchId;
	const idempotencyKey = value.idempotencyKey;
	if (
		(batchId === undefined) === (idempotencyKey === undefined) ||
		(batchId !== undefined && (typeof batchId !== "string" || !isCanonicalUuid(batchId))) ||
		(idempotencyKey !== undefined && boundedString(idempotencyKey, 128) === undefined)
	) {
		return undefined;
	}
	return {
		batchId: typeof batchId === "string" ? batchId.toLowerCase() : null,
		idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : null,
	};
}

function boundedString(value: unknown, maximum: number): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= maximum
		? value
		: undefined;
}

function hexHash(value: unknown): string | undefined {
	return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFailure<T>(): AiImportServiceResult<T> {
	return failure("VALIDATION_ERROR", 400);
}

function internalFailure<T>(): AiImportServiceResult<T> {
	return failure("INTERNAL_ERROR", 500);
}

function mappedFailure<T>(error: unknown, correlationId: string): AiImportServiceResult<T> {
	const mapped: AiImportError = mapAiImportError(error, correlationId);
	return failure(mapped.code, mapped.httpStatus);
}

function failure<T>(
	code: AiImportServiceError["code"],
	httpStatus: number
): AiImportServiceResult<T> {
	return { ok: false, error: { code, httpStatus } };
}

function isAiImportErrorCode(value: string): value is AiImportErrorCode {
	return (AI_IMPORT_ERROR_CODES as readonly string[]).includes(value);
}
