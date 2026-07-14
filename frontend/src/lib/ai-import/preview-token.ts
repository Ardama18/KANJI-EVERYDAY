export const PREVIEW_TOKEN_TTL_SECONDS = 1800;

export interface PreviewTokenInput {
	userId: string;
	reservationKey: string;
	importRequestHash: string;
}

export interface PreviewPayload extends PreviewTokenInput {
	v: 1;
	expiresAt: number;
}

export class PreviewTokenError extends Error {
	constructor() {
		super("Preview token validation failed");
		this.name = "PreviewTokenError";
	}
}

const HMAC_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export async function signPreviewToken(
	input: PreviewTokenInput,
	secret: string,
	now: number
): Promise<string> {
	assertSigningInput(input, secret, now);
	const payload: PreviewPayload = {
		v: 1,
		userId: input.userId,
		reservationKey: input.reservationKey,
		importRequestHash: input.importRequestHash,
		expiresAt: now + PREVIEW_TOKEN_TTL_SECONDS,
	};
	const payloadPart = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
	const signature = await signHmac(payloadPart, secret);
	return `${payloadPart}.${encodeBase64Url(signature)}`;
}

export async function verifyPreviewToken(
	token: string,
	expected: PreviewTokenInput,
	secret: string,
	now: number
): Promise<PreviewPayload> {
	try {
		const { payloadPart, signature, payload } = parseToken(token);
		if (payload.v !== 1) {
			throw new PreviewTokenError();
		}
		if (!(await verifyHmac(payloadPart, signature, secret))) {
			throw new PreviewTokenError();
		}
		if (payload.userId !== expected.userId) {
			throw new PreviewTokenError();
		}
		if (payload.reservationKey !== expected.reservationKey) {
			throw new PreviewTokenError();
		}
		if (!Number.isSafeInteger(now) || now > payload.expiresAt) {
			throw new PreviewTokenError();
		}
		if (payload.importRequestHash !== expected.importRequestHash) {
			throw new PreviewTokenError();
		}
		return {
			v: 1,
			userId: payload.userId,
			reservationKey: payload.reservationKey,
			importRequestHash: payload.importRequestHash,
			expiresAt: payload.expiresAt,
		};
	} catch (error) {
		if (error instanceof PreviewTokenError) {
			throw error;
		}
		throw new PreviewTokenError();
	}
}

function parseToken(token: string): {
	payloadPart: string;
	signature: ArrayBuffer;
	payload: PreviewPayload | (Omit<PreviewPayload, "v"> & { v: number });
} {
	const parts = token.split(".");
	if (parts.length !== 2) {
		throw new PreviewTokenError();
	}
	const [payloadPart = "", signaturePart = ""] = parts;
	const payloadBytes = decodeBase64Url(payloadPart);
	const signature = decodeBase64Url(signaturePart);
	const payloadText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
	const parsed: unknown = JSON.parse(payloadText);
	if (!isPreviewPayloadShape(parsed) || JSON.stringify(parsed) !== payloadText) {
		throw new PreviewTokenError();
	}
	return { payloadPart, signature, payload: parsed };
}

function isPreviewPayloadShape(value: unknown): value is Omit<PreviewPayload, "v"> & { v: number } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	return (
		keys.length === 5 &&
		keys[0] === "v" &&
		keys[1] === "userId" &&
		keys[2] === "reservationKey" &&
		keys[3] === "importRequestHash" &&
		keys[4] === "expiresAt" &&
		typeof record.v === "number" &&
		typeof record.userId === "string" &&
		record.userId.length > 0 &&
		typeof record.reservationKey === "string" &&
		record.reservationKey.length > 0 &&
		typeof record.importRequestHash === "string" &&
		SHA256_HEX_PATTERN.test(record.importRequestHash) &&
		typeof record.expiresAt === "number" &&
		Number.isSafeInteger(record.expiresAt)
	);
}

async function signHmac(payloadPart: string, secret: string): Promise<Uint8Array> {
	const key = await importHmacKey(secret, ["sign"]);
	const signature = await globalThis.crypto.subtle.sign(
		HMAC_ALGORITHM.name,
		key,
		new TextEncoder().encode(payloadPart)
	);
	return new Uint8Array(signature);
}

async function verifyHmac(
	payloadPart: string,
	signature: ArrayBuffer,
	secret: string
): Promise<boolean> {
	const key = await importHmacKey(secret, ["verify"]);
	return await globalThis.crypto.subtle.verify(
		HMAC_ALGORITHM.name,
		key,
		signature,
		new TextEncoder().encode(payloadPart)
	);
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
	if (secret.length === 0) {
		throw new PreviewTokenError();
	}
	return await globalThis.crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		HMAC_ALGORITHM,
		false,
		usages
	);
}

function encodeBase64Url(bytes: Uint8Array): string {
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): ArrayBuffer {
	if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
		throw new PreviewTokenError();
	}
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (encodeBase64Url(bytes) !== value) {
		throw new PreviewTokenError();
	}
	return bytes.buffer;
}

function assertSigningInput(input: PreviewTokenInput, secret: string, now: number): void {
	if (
		input.userId.length === 0 ||
		input.reservationKey.length === 0 ||
		!SHA256_HEX_PATTERN.test(input.importRequestHash) ||
		secret.length === 0 ||
		!Number.isSafeInteger(now) ||
		now > Number.MAX_SAFE_INTEGER - PREVIEW_TOKEN_TTL_SECONDS
	) {
		throw new PreviewTokenError();
	}
}
