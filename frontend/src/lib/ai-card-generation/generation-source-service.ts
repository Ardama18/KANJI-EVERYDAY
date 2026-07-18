import { isCanonicalUuid } from "@/lib/ai-import/uuid";
import type { createServiceRoleClient } from "@/lib/supabase/server";

import type { GenerationSource } from "./generation-service";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

interface SourceDescriptor {
	readonly uploadId: string;
	readonly bucket: "ai-card-sources";
	readonly path: string;
	readonly mime: "image/png";
	readonly byteSize: number;
	readonly digest: string;
}

interface ReleaseObject {
	readonly kind: "raw" | "source" | "intent";
	readonly bucket: "ai-card-sources";
	readonly path: string;
}

export async function loadGenerationSources(
	service: ServiceClient,
	ownerId: string,
	uploadIds: readonly string[]
): Promise<readonly GenerationSource[]> {
	if (uploadIds.length === 0) return [];
	const { data, error } = await service.rpc("get_ai_generation_sources", {
		p_owner_user_id: ownerId,
		p_upload_ids: [...uploadIds],
	});
	if (error !== null) throw new GenerationSourceError("DECK_NOT_FOUND");
	const descriptors = parseDescriptors(data, ownerId, uploadIds);
	if (descriptors === undefined) throw new GenerationSourceError("DECK_NOT_FOUND");
	const sources: GenerationSource[] = [];
	for (const descriptor of descriptors) {
		const { data: blob, error: downloadError } = await service.storage
			.from(descriptor.bucket)
			.download(descriptor.path);
		if (downloadError !== null || blob === null)
			throw new GenerationSourceError("SOURCE_READ_FAILED");
		const bytes = new Uint8Array(await blob.arrayBuffer());
		if (
			bytes.byteLength !== descriptor.byteSize ||
			bytes.byteLength > 10 * 1024 * 1024 ||
			(await sha256Bytes(bytes)) !== descriptor.digest
		)
			throw new GenerationSourceError("SOURCE_READ_FAILED");
		sources.push({ mime: "image/png", bytes, digest: descriptor.digest });
	}
	return sources;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function releaseGenerationSources(
	service: ServiceClient,
	ownerId: string,
	uploadIds: readonly string[]
): Promise<{
	readonly released: number;
	readonly cleanupPending: number;
	readonly notFound: boolean;
}> {
	let released = 0;
	let cleanupPending = 0;
	for (const uploadId of [...uploadIds].sort()) {
		const { data, error } = await service.rpc("release_ai_generation_source", {
			p_owner_user_id: ownerId,
			p_upload_id: uploadId,
		});
		if (error !== null) {
			cleanupPending += 1;
			continue;
		}
		const release = parseRelease(data, ownerId, uploadId);
		if (release === undefined || release.outcome === "retain")
			return { released, cleanupPending, notFound: true };
		if (release.outcome === "deleted") {
			released += 1;
			continue;
		}
		let complete = true;
		for (const object of release.objects) {
			const { error: removeError } = await service.storage
				.from(object.bucket)
				.remove([object.path]);
			const deleted = removeError === null || isStorageNotFound(removeError);
			const { error: completionError } = await service.rpc(
				"complete_ai_generation_source_release",
				{
					p_owner_user_id: ownerId,
					p_upload_id: uploadId,
					p_kind: object.kind,
					p_bucket: object.bucket,
					p_path: object.path,
					p_deleted: deleted,
				}
			);
			if (!deleted || completionError !== null) complete = false;
		}
		if (complete) released += 1;
		else cleanupPending += 1;
	}
	return { released, cleanupPending, notFound: false };
}

export class GenerationSourceError extends Error {
	constructor(readonly code: "DECK_NOT_FOUND" | "SOURCE_READ_FAILED") {
		super(code);
		this.name = "GenerationSourceError";
	}
}

function parseDescriptors(
	value: unknown,
	ownerId: string,
	expectedIds: readonly string[]
): readonly SourceDescriptor[] | undefined {
	if (!Array.isArray(value) || value.length !== expectedIds.length) return undefined;
	const expected = new Set(expectedIds);
	const descriptors: SourceDescriptor[] = [];
	for (const item of value) {
		if (
			!isRecord(item) ||
			typeof item.uploadId !== "string" ||
			!expected.has(item.uploadId) ||
			item.bucket !== "ai-card-sources" ||
			typeof item.path !== "string" ||
			item.path !== `${ownerId}/${item.uploadId}/source` ||
			item.mime !== "image/png" ||
			typeof item.byteSize !== "number" ||
			!Number.isSafeInteger(item.byteSize) ||
			item.byteSize < 1 ||
			item.byteSize > 10 * 1024 * 1024 ||
			typeof item.digest !== "string" ||
			!/^[0-9a-f]{64}$/u.test(item.digest)
		)
			return undefined;
		descriptors.push({
			uploadId: item.uploadId,
			bucket: item.bucket,
			path: item.path,
			mime: item.mime,
			byteSize: item.byteSize,
			digest: item.digest,
		});
	}
	return new Set(descriptors.map((descriptor) => descriptor.uploadId)).size === expectedIds.length
		? descriptors
		: undefined;
}

function parseRelease(
	value: unknown,
	ownerId: string,
	uploadId: string
):
	| { readonly outcome: "retain" }
	| { readonly outcome: "deleted" }
	| { readonly outcome: "delete"; readonly objects: readonly ReleaseObject[] }
	| undefined {
	if (
		!isRecord(value) ||
		(value.outcome !== "retain" && value.outcome !== "deleted" && value.outcome !== "delete")
	)
		return undefined;
	if (value.outcome !== "delete") return { outcome: value.outcome };
	if (!Array.isArray(value.objects)) return undefined;
	const objects: ReleaseObject[] = [];
	const allowedPaths = new Set([`${ownerId}/${uploadId}/raw`, `${ownerId}/${uploadId}/source`]);
	for (const object of value.objects) {
		if (
			!isRecord(object) ||
			(object.kind !== "raw" && object.kind !== "source" && object.kind !== "intent") ||
			object.bucket !== "ai-card-sources" ||
			typeof object.path !== "string" ||
			!allowedPaths.has(object.path)
		)
			return undefined;
		objects.push({ kind: object.kind, bucket: object.bucket, path: object.path });
	}
	return { outcome: "delete", objects };
}

function isStorageNotFound(error: unknown): boolean {
	return isRecord(error) && (error.status === 404 || error.statusCode === "404");
}

export function parseGenerationSourceUploadIds(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value) || value.length > 5) return undefined;
	const ids: string[] = [];
	for (const id of value) {
		if (typeof id !== "string" || !isCanonicalUuid(id)) return undefined;
		ids.push(id.toLowerCase());
	}
	return new Set(ids).size === ids.length ? ids : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
