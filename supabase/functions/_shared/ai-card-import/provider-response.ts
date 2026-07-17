export const MAX_PROVIDER_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_BYTES = Math.ceil(MAX_PROVIDER_IMAGE_BYTES / 3) * 4;
export const MAX_PROVIDER_RESPONSE_BYTES = MAX_BASE64_BYTES + 64 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

export class ProviderResponseLimitError extends Error {
	constructor() {
		super("IMAGE_TOO_LARGE");
		this.name = "ProviderResponseLimitError";
	}
}

export class ProviderResponseNetworkError extends Error {
	constructor() {
		super("PROVIDER_TRANSIENT_ERROR");
		this.name = "ProviderResponseNetworkError";
	}
}

export function isProviderResponseLimitError(error: unknown): boolean {
	return error instanceof ProviderResponseLimitError ||
		(error instanceof Error && error.name === "ProviderResponseLimitError" && error.message === "IMAGE_TOO_LARGE");
}

export function isProviderResponseNetworkError(error: unknown): boolean {
	return error instanceof ProviderResponseNetworkError ||
		(error instanceof Error &&
			error.name === "ProviderResponseNetworkError" &&
			error.message === "PROVIDER_TRANSIENT_ERROR");
}

interface CancellableBody {
	readonly cancel?: () => PromiseLike<void> | void;
}

export async function cancelProviderResponseBody(body: CancellableBody | null | undefined): Promise<void> {
	try {
		const cancel = body?.cancel;
		if (typeof cancel === "function") await cancel.call(body);
	} catch {
		// A bounded-response classification is authoritative; transport details are unsafe to log.
	}
}

export async function readBoundedJsonResponse(
	response: Response,
	maxBytes = MAX_PROVIDER_RESPONSE_BYTES
): Promise<unknown> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		if (!/^\d+$/u.test(declared)) {
			await cancelProviderResponseBody(response.body);
			throw new Error("PROVIDER_RESPONSE_INVALID");
		}
		const declaredBytes = Number(declared);
		if (!Number.isSafeInteger(declaredBytes)) {
			await cancelProviderResponseBody(response.body);
			throw new Error("PROVIDER_RESPONSE_INVALID");
		}
		if (declaredBytes > maxBytes) {
			await cancelProviderResponseBody(response.body);
			throw new ProviderResponseLimitError();
		}
	}
	if (response.body === null) throw new Error("PROVIDER_RESPONSE_INVALID");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch {
				// A successful HTTP exchange can still fail while consuming the transport.
				// Do not expose the raw stream error, which may contain provider details.
				throw new ProviderResponseNetworkError();
			}
			const { done, value } = result;
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await cancelProviderResponseBody(reader);
				throw new ProviderResponseLimitError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	return JSON.parse(text) as unknown;
}

export function decodeBase64WithinLimit(
	encoded: string,
	maxDecodedBytes = MAX_PROVIDER_IMAGE_BYTES
): Uint8Array {
	if (encoded.length === 0 || encoded.length % 4 !== 0) {
		throw new Error("PROVIDER_RESPONSE_INVALID");
	}
	const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
	const decodedBytes = (encoded.length / 4) * 3 - padding;
	if (decodedBytes > maxDecodedBytes) throw new ProviderResponseLimitError();
	if (!BASE64_PATTERN.test(encoded) || encoded.slice(0, -padding || undefined).includes("=")) {
		throw new Error("PROVIDER_RESPONSE_INVALID");
	}
	const binary = atob(encoded);
	if (binary.length !== decodedBytes) throw new Error("PROVIDER_RESPONSE_INVALID");
	const decoded = new Uint8Array(decodedBytes);
	for (let index = 0; index < decodedBytes; index += 1) {
		decoded[index] = binary.charCodeAt(index);
	}
	return decoded;
}
