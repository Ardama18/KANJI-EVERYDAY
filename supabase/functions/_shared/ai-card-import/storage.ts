import { classifyFailure } from "./retry-policy.ts";

export type StorageResult =
	| { readonly kind: "success" }
	| { readonly kind: "not_found" }
	| { readonly kind: "conflict" }
	| { readonly kind: "transient"; readonly httpStatus?: number }
	| { readonly kind: "permanent"; readonly httpStatus?: number };

export interface IllustrationStorage {
	readSource(bucket: "ai-card-sources" | "illustrations", path: string): Promise<Uint8Array>;
	writeIllustration(path: string, bytes: Uint8Array): Promise<StorageResult>;
	readIllustration(path: string): Promise<Uint8Array | undefined>;
	deleteObject(bucket: "ai-card-sources" | "illustrations", path: string): Promise<StorageResult>;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function createStorageClient(input: {
	readonly supabaseUrl: string;
	readonly serviceRoleKey: string;
	readonly fetchImplementation?: typeof fetch;
}): IllustrationStorage {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const headers = { Authorization: `Bearer ${input.serviceRoleKey}`, apikey: input.serviceRoleKey };
	return {
		async readSource(bucket, path): Promise<Uint8Array> {
			const response = await fetchStorage(
				fetchImplementation,
				objectUrl(input.supabaseUrl, bucket, path),
				{ headers }
			);
			if (!response.ok) throw new StorageHttpError(response.status);
			return await readResponseBytesWithLimit(response, MAX_SOURCE_BYTES);
		},
		async writeIllustration(path, bytes): Promise<StorageResult> {
			let response: Response;
			try {
				response = await fetchImplementation(objectUrl(input.supabaseUrl, "illustrations", path), {
					method: "POST",
					headers: { ...headers, "Content-Type": "image/png", "x-upsert": "false" },
					body: ownedArrayBuffer(bytes),
				});
			} catch {
				return { kind: "transient" };
			}
			return classifyStorageResponse(response.status, response.ok);
		},
		async readIllustration(path): Promise<Uint8Array | undefined> {
			const response = await fetchStorage(
				fetchImplementation,
				objectUrl(input.supabaseUrl, "illustrations", path),
				{ headers }
			);
			if (response.status === 404) return undefined;
			if (!response.ok) throw new StorageHttpError(response.status);
			return await readResponseBytesWithLimit(response, MAX_SOURCE_BYTES);
		},
		async deleteObject(bucket, path): Promise<StorageResult> {
			let response: Response;
			try {
				response = await fetchImplementation(objectUrl(input.supabaseUrl, bucket, path), {
					method: "DELETE",
					headers,
				});
			} catch {
				return { kind: "transient" };
			}
			if (response.status === 404) return { kind: "not_found" };
			return classifyStorageResponse(response.status, response.ok);
		},
	};
}

export class StorageHttpError extends Error {
	readonly status: number;

	constructor(status: number) {
		super("Storage request failed");
		this.name = "StorageHttpError";
		this.status = status;
	}
}

export class StorageNetworkError extends Error {
	constructor() {
		super("Storage network request failed");
		this.name = "StorageNetworkError";
	}
}

export class StorageContractError extends Error {
	constructor() {
		super("Storage response contract failed");
		this.name = "StorageContractError";
	}
}

export class StorageSizeLimitError extends Error {
	constructor() {
		super("Storage response exceeded the source byte limit");
		this.name = "StorageSizeLimitError";
	}
}

export function classifyStorageResponse(status: number, ok: boolean): StorageResult {
	if (ok) return { kind: "success" };
	if (status === 404) return { kind: "not_found" };
	if (status === 409) return { kind: "conflict" };
	const classification = classifyFailure({ category: "http", httpStatus: status });
	return { kind: classification.kind, httpStatus: status };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function objectUrl(base: string, bucket: string, path: string): string {
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	return `${base.replace(/\/$/u, "")}/storage/v1/object/${bucket}/${encodedPath}`;
}

async function fetchStorage(
	fetchImplementation: typeof fetch,
	url: string,
	init: RequestInit
): Promise<Response> {
	try {
		return await fetchImplementation(url, init);
	} catch {
		throw new StorageNetworkError();
	}
}

async function readResponseBytesWithLimit(
	response: Response,
	maxBytes: number
): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		const value = Number(declared);
		if (!Number.isSafeInteger(value) || value < 0) throw new StorageContractError();
		if (value > maxBytes) {
			try {
				await response.body?.cancel();
			} catch {
				// The declared size is authoritative even if cancellation races.
			}
			throw new StorageSizeLimitError();
		}
	}
	if (response.body === null) throw new StorageContractError();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch {
				// The HTTP response was accepted, but its body transport failed mid-stream.
				// Preserve a typed retryable boundary without leaking the raw failure.
				throw new StorageNetworkError();
			}
			const { done, value } = result;
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// The size classification remains authoritative even if cancellation races.
				}
				throw new StorageSizeLimitError();
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
