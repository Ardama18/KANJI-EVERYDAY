import { NextResponse } from "next/server";

import { createSourceImageCodec } from "@/lib/ai-import/source-image-codec";
import { getEnvConfig } from "@/lib/env";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { NormalizedImage } from "../../../../../../../supabase/functions/_shared/ai-card-import/image-codec";
import { sanitizeSourceImage } from "../../../../../../../supabase/functions/_shared/ai-card-import/image-codec";
import { sha256Hex } from "../../../../../../../supabase/functions/_shared/ai-card-import/storage";

interface UploadRow {
	id: string;
	owner_user_id: string;
	status: string;
	raw_storage_path: string | null;
	mime_type: string;
	byte_size: number;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request): Promise<Response> {
	const authClient = createServerClient();
	const { data: authData } = await authClient.auth.getUser();
	if (authData.user === null) return error("UNAUTHORIZED", 401);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return error("VALIDATION_ERROR", 400);
	}
	if (!isRecord(body) || typeof body.uploadId !== "string" || !UUID_PATTERN.test(body.uploadId))
		return error("VALIDATION_ERROR", 400);
	const uploadId = body.uploadId.toLowerCase();
	const service = createServiceRoleClient();
	const { data: rowData, error: lookupError } = await service
		.from("ai_uploads")
		.select("id,owner_user_id,status,raw_storage_path,mime_type,byte_size")
		.eq("id", uploadId)
		.eq("owner_user_id", authData.user.id)
		.maybeSingle();
	const row = rowData as UploadRow | null;
	if (
		lookupError !== null ||
		row === null ||
		row.status !== "prepared" ||
		row.raw_storage_path === null
	)
		return error("NOT_FOUND", 404);
	const bucket = service.storage.from("ai-card-sources");
	let sourceResponse: Response;
	try {
		sourceResponse = await fetchSourceObject(row.raw_storage_path);
	} catch {
		await markCleanup(service, authData.user.id, uploadId);
		return error("SOURCE_READ_FAILED", 503);
	}
	if (!sourceResponse.ok) {
		try {
			await sourceResponse.body?.cancel();
		} catch {
			// The safe response and durable cleanup marker are authoritative.
		} finally {
			await markCleanup(service, authData.user.id, uploadId);
		}
		return error("SOURCE_READ_FAILED", 503);
	}
	let bytes: Uint8Array;
	try {
		bytes = await readSourceResponseWithLimit(sourceResponse, MAX_SOURCE_BYTES);
	} catch (failure) {
		if (!(failure instanceof SourceReadLimitError)) {
			await markCleanup(service, authData.user.id, uploadId);
			return error("SOURCE_READ_FAILED", 503);
		}
		await bucket.remove([row.raw_storage_path]);
		await markCleanup(service, authData.user.id, uploadId);
		return error("IMAGE_TOO_LARGE", 413);
	}
	let codec: Awaited<ReturnType<typeof createSourceImageCodec>>;
	try {
		codec = await createSourceImageCodec();
	} catch {
		return error("SOURCE_READ_FAILED", 503);
	}
	let sanitized: NormalizedImage;
	try {
		sanitized = await sanitizeSourceImage({ bytes, declaredMime: row.mime_type }, codec);
	} catch (failure) {
		await bucket.remove([row.raw_storage_path]);
		await markCleanup(service, authData.user.id, uploadId);
		const code = safeImageCode(failure);
		return error(code, code === "IMAGE_TOO_LARGE" ? 413 : 422);
	}
	const sourcePath = `${authData.user.id}/${uploadId}/source`;
	const { error: intentError } = await service.rpc("mark_ai_source_write_intent", {
		p_owner_user_id: authData.user.id,
		p_upload_id: uploadId,
		p_source_path: sourcePath,
	});
	if (intentError !== null) {
		await markCleanup(service, authData.user.id, uploadId, sourcePath);
		return error("SOURCE_FINALIZE_FAILED", 503);
	}
	const { error: uploadError } = await bucket.upload(sourcePath, sanitized.bytes, {
		contentType: sanitized.mime,
		upsert: false,
	});
	if (uploadError !== null) {
		// Another completion may own the deterministic object and still be
		// finalizing the row. Never downgrade that winner from this loser.
		return error("SOURCE_WRITE_FAILED", 503);
	}
	const digest = await sha256Hex(sanitized.bytes);
	const readyArguments = {
		p_owner_user_id: authData.user.id,
		p_upload_id: uploadId,
		p_detected_mime: sanitized.mime,
		p_actual_byte_size: sanitized.bytes.byteLength,
		p_width: sanitized.width,
		p_height: sanitized.height,
		p_digest: digest,
	};
	const { data: ready, error: readyError } = await service.rpc(
		"mark_ai_source_ready",
		readyArguments
	);
	let readyResponse = ready;
	if (readyError !== null) {
		const { data: reconciliationData, error: reconciliationError } = await service.rpc(
			"reconcile_ai_source_ready",
			readyArguments
		);
		const reconciliation = parseReadyReconciliation(reconciliationData, uploadId, sourcePath);
		if (reconciliationError !== null || reconciliation === undefined) {
			return error("SOURCE_FINALIZE_FAILED", 503);
		}
		if (reconciliation.outcome === "ready") {
			readyResponse = {
				uploadId,
				status: "ready",
				path: sourcePath,
			};
		} else if (reconciliation.outcome === "uncommitted") {
			await bucket.remove([row.raw_storage_path, sourcePath]);
			await markCleanup(service, authData.user.id, uploadId, sourcePath);
			return error("SOURCE_FINALIZE_FAILED", 503);
		} else {
			return error("SOURCE_FINALIZE_FAILED", 503);
		}
	}
	const { error: rawDeleteError } = await bucket.remove([row.raw_storage_path]);
	if (rawDeleteError === null) {
		await service.rpc("mark_ai_source_raw_deleted", {
			p_owner_user_id: authData.user.id,
			p_upload_id: uploadId,
		});
	}
	return NextResponse.json(readyResponse);
}

export async function readSourceResponseWithLimit(
	response: Pick<Response, "body" | "headers">,
	maxBytes = MAX_SOURCE_BYTES
): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		const declaredBytes = Number(declared);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
			await cancelBody(response.body);
			throw new SourceReadContractError();
		}
		if (declaredBytes > maxBytes) {
			await cancelBody(response.body);
			throw new SourceReadLimitError();
		}
	}
	if (response.body === null) throw new SourceReadContractError();
	return await readByteStreamWithLimit(response.body, maxBytes);
}

async function readByteStreamWithLimit(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// The measured byte limit remains authoritative if cancellation races.
				}
				throw new SourceReadLimitError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
	try {
		await body?.cancel();
	} catch {
		// The validation result remains authoritative if cancellation races the transport.
	}
}

async function fetchSourceObject(path: string): Promise<Response> {
	const { supabaseUrl, supabaseServiceRoleKey } = getEnvConfig();
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	return await fetch(
		`${supabaseUrl.replace(/\/$/u, "")}/storage/v1/object/ai-card-sources/${encodedPath}`,
		{
			headers: {
				Authorization: `Bearer ${supabaseServiceRoleKey}`,
				apikey: supabaseServiceRoleKey,
			},
		}
	);
}

export class SourceReadLimitError extends Error {
	constructor() {
		super("IMAGE_TOO_LARGE");
		this.name = "SourceReadLimitError";
	}
}

export class SourceReadContractError extends Error {
	constructor() {
		super("SOURCE_READ_FAILED");
		this.name = "SourceReadContractError";
	}
}

async function markCleanup(
	service: ReturnType<typeof createServiceRoleClient>,
	ownerUserId: string,
	uploadId: string,
	sourcePath?: string
): Promise<void> {
	await service.rpc("mark_ai_upload_cleanup", {
		p_owner_user_id: ownerUserId,
		p_upload_id: uploadId,
		p_source_path: sourcePath ?? null,
	});
}

function safeImageCode(failure: unknown): string {
	if (
		failure instanceof Error &&
		[
			"IMAGE_FORMAT_INVALID",
			"IMAGE_TOO_LARGE",
			"IMAGE_DIMENSIONS_INVALID",
			"IMAGE_DECODE_FAILED",
		].includes(failure.message)
	) {
		return failure.message;
	}
	return "IMAGE_DECODE_FAILED";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReadyReconciliation(
	value: unknown,
	uploadId: string,
	sourcePath: string
): { outcome: "ready" | "uncommitted" | "ambiguous" } | undefined {
	if (!isRecord(value) || !["ready", "uncommitted", "ambiguous"].includes(String(value.outcome)))
		return undefined;
	if (value.outcome === "ready") {
		if (value.uploadId !== uploadId || value.status !== "ready" || value.path !== sourcePath)
			return undefined;
		return { outcome: "ready" };
	}
	if (value.outcome === "uncommitted") return { outcome: "uncommitted" };
	return { outcome: "ambiguous" };
}

function error(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}
