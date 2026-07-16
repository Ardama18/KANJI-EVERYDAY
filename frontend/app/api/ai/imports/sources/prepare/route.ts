import { NextResponse } from "next/server";

import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

const MAX_SOURCE_COUNT = 5;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface SourceMetadata {
	readonly uploadKey: string;
	readonly declaredMime: string;
	readonly byteSize: number;
}

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
	const sources = parseSources(body);
	if (sources === undefined) return error("VALIDATION_ERROR", 400);
	const service = createServiceRoleClient();
	const uploads: { uploadId: string; path: string; token: string }[] = [];
	for (const source of sources) {
		const { data, error: rpcError } = await service.rpc("prepare_ai_source_upload", {
			p_owner_user_id: authData.user.id,
			p_upload_key: source.uploadKey,
			p_declared_mime: source.declaredMime,
			p_byte_size: source.byteSize,
		});
		if (rpcError !== null || !isPrepared(data)) return error("SOURCE_PREPARE_FAILED", 503);
		const { data: signed, error: signedError } = await service.storage
			.from("ai-card-sources")
			.createSignedUploadUrl(data.path);
		if (signedError !== null) return error("SOURCE_PREPARE_FAILED", 503);
		uploads.push({ uploadId: data.uploadId, path: data.path, token: signed.token });
	}
	return NextResponse.json({ uploads }, { status: 201 });
}

function parseSources(value: unknown): readonly SourceMetadata[] | undefined {
	if (
		!isRecord(value) ||
		!Array.isArray(value.sources) ||
		value.sources.length < 1 ||
		value.sources.length > MAX_SOURCE_COUNT
	)
		return undefined;
	const result: SourceMetadata[] = [];
	let total = 0;
	for (const entry of value.sources) {
		if (
			!isRecord(entry) ||
			typeof entry.uploadKey !== "string" ||
			entry.uploadKey.length < 1 ||
			entry.uploadKey.length > 128 ||
			typeof entry.declaredMime !== "string" ||
			!MIME_TYPES.has(entry.declaredMime) ||
			typeof entry.byteSize !== "number" ||
			!Number.isSafeInteger(entry.byteSize) ||
			entry.byteSize < 1 ||
			entry.byteSize > MAX_SOURCE_BYTES
		)
			return undefined;
		total += entry.byteSize;
		result.push({
			uploadKey: entry.uploadKey,
			declaredMime: entry.declaredMime,
			byteSize: entry.byteSize,
		});
	}
	return total <= MAX_TOTAL_BYTES ? result : undefined;
}

function isPrepared(value: unknown): value is { readonly uploadId: string; readonly path: string } {
	return isRecord(value) && typeof value.uploadId === "string" && typeof value.path === "string";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(code: string, status: number): Response {
	return NextResponse.json({ error: { code } }, { status });
}
