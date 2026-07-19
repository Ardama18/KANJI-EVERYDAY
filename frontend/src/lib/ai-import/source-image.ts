export type SourceImageMime = "image/png" | "image/jpeg" | "image/webp";
export type SourceImageErrorCode =
	| "IMAGE_FORMAT_INVALID"
	| "IMAGE_TOO_LARGE"
	| "IMAGE_DIMENSIONS_INVALID"
	| "IMAGE_DECODE_FAILED";

export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 1_024 * 1_024;

export interface DecodedImage {
	readonly width: number;
	readonly height: number;
}

export interface ImageCodec {
	decode(bytes: Uint8Array): Promise<DecodedImage>;
	encodePng(input: {
		readonly bytes: Uint8Array;
		readonly width: number;
		readonly height: number;
	}): Promise<Uint8Array>;
	transcodePng?(input: {
		readonly bytes: Uint8Array;
		readonly width: number;
		readonly height: number;
	}): Promise<{
		readonly bytes: Uint8Array;
		readonly sourceWidth: number;
		readonly sourceHeight: number;
	}>;
}

export interface NormalizedImage {
	readonly bytes: Uint8Array;
	readonly mime: "image/png";
	readonly width: number;
	readonly height: number;
}

type ImageInspectionResult =
	| {
			readonly ok: true;
			readonly mime: SourceImageMime;
			readonly width: number;
			readonly height: number;
	  }
	| { readonly ok: false; readonly code: SourceImageErrorCode };

export async function sanitizeSourceImage(
	input: { readonly bytes: Uint8Array; readonly declaredMime: string },
	codec: ImageCodec
): Promise<NormalizedImage> {
	const inspected = inspectImage(input.bytes, input.declaredMime);
	if (!inspected.ok) throw new Error(inspected.code);
	let bytes: Uint8Array;
	try {
		bytes = await encodeVerifiedPng(
			codec,
			{ bytes: input.bytes, width: inspected.width, height: inspected.height },
			inspected
		);
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	assertNormalizedPng(bytes, inspected.width, inspected.height);
	return { bytes, mime: "image/png", width: inspected.width, height: inspected.height };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inspectImage(bytes: Uint8Array, declaredMime: string): ImageInspectionResult {
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
		return { ok: false, code: "IMAGE_TOO_LARGE" };
	}
	const detectedMime = detectImageMime(bytes);
	if (detectedMime === undefined || detectedMime !== declaredMime) {
		return { ok: false, code: "IMAGE_FORMAT_INVALID" };
	}
	if (detectedMime === "image/png" && !isSupportedPngHeader(bytes)) {
		return { ok: false, code: "IMAGE_FORMAT_INVALID" };
	}
	if (detectedMime === "image/webp" && hasWebpAlpha(bytes)) {
		return { ok: false, code: "IMAGE_FORMAT_INVALID" };
	}
	const dimensions = readImageDimensions(bytes, detectedMime);
	if (dimensions === undefined) return { ok: false, code: "IMAGE_DECODE_FAILED" };
	const { width, height } = dimensions;
	if (width < 1 || height < 1 || width * height > MAX_SOURCE_IMAGE_PIXELS) {
		return { ok: false, code: "IMAGE_DIMENSIONS_INVALID" };
	}
	return { ok: true, mime: detectedMime, width, height };
}

async function encodeVerifiedPng(
	codec: ImageCodec,
	input: { readonly bytes: Uint8Array; readonly width: number; readonly height: number },
	expectedSource: DecodedImage
): Promise<Uint8Array> {
	if (codec.transcodePng !== undefined) {
		const encoded = await codec.transcodePng(input);
		if (
			encoded.sourceWidth !== expectedSource.width ||
			encoded.sourceHeight !== expectedSource.height
		) {
			throw new Error("IMAGE_DECODE_FAILED");
		}
		return encoded.bytes;
	}
	const decoded = await codec.decode(input.bytes);
	if (decoded.width !== expectedSource.width || decoded.height !== expectedSource.height) {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	return await codec.encodePng(input);
}

function assertNormalizedPng(
	bytes: Uint8Array,
	expectedWidth: number,
	expectedHeight: number
): void {
	const normalized = inspectImage(bytes, "image/png");
	if (!normalized.ok) throw new Error(normalized.code);
	if (normalized.width !== expectedWidth || normalized.height !== expectedHeight) {
		throw new Error("IMAGE_DECODE_FAILED");
	}
}

function hasWebpAlpha(bytes: Uint8Array): boolean {
	const chunk = ascii(bytes, 12, 16);
	if (chunk === "VP8X") return ((bytes[20] ?? 0) & 0x10) !== 0;
	if (chunk === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
		return ((bytes[24] ?? 0) & 0x10) !== 0;
	}
	return false;
}

function isSupportedPngHeader(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 26) return true;
	const bitDepth = bytes[24] ?? 0;
	const colorType = bytes[25] ?? 255;
	if (bitDepth < 1 || bitDepth > 8) return false;
	if (colorType === 0) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
	if (colorType === 2) return bitDepth === 8;
	return colorType === 3 && (bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8);
}

function detectImageMime(bytes: Uint8Array): SourceImageMime | undefined {
	if (
		bytes.byteLength >= 24 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}
	if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (bytes.byteLength >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
		return "image/webp";
	}
	return undefined;
}

function readImageDimensions(bytes: Uint8Array, mime: SourceImageMime): DecodedImage | undefined {
	if (mime === "image/png") {
		if (bytes.byteLength < 24 || ascii(bytes, 12, 16) !== "IHDR") return undefined;
		return { width: readU32Be(bytes, 16), height: readU32Be(bytes, 20) };
	}
	if (mime === "image/jpeg") return readJpegDimensions(bytes);
	return readWebpDimensions(bytes);
}

function readJpegDimensions(bytes: Uint8Array): DecodedImage | undefined {
	let offset = 2;
	while (offset + 8 < bytes.byteLength) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1] ?? 0;
		offset += 2;
		if (marker === 0xd8 || marker === 0xd9) continue;
		const length = readU16Be(bytes, offset);
		if (length < 2 || offset + length > bytes.byteLength) return undefined;
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
			return { height: readU16Be(bytes, offset + 3), width: readU16Be(bytes, offset + 5) };
		}
		offset += length;
	}
	return undefined;
}

function readWebpDimensions(bytes: Uint8Array): DecodedImage | undefined {
	const chunk = ascii(bytes, 12, 16);
	if (chunk === "VP8X" && bytes.byteLength >= 30) {
		return { width: readU24Le(bytes, 24) + 1, height: readU24Le(bytes, 27) + 1 };
	}
	if (chunk === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
		const b1 = bytes[21] ?? 0;
		const b2 = bytes[22] ?? 0;
		const b3 = bytes[23] ?? 0;
		const b4 = bytes[24] ?? 0;
		return {
			width: 1 + b1 + ((b2 & 0x3f) << 8),
			height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
		};
	}
	if (chunk === "VP8 " && bytes.byteLength >= 30) {
		return { width: readU16Le(bytes, 26) & 0x3fff, height: readU16Le(bytes, 28) & 0x3fff };
	}
	return undefined;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function readU16Be(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU16Le(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24Le(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readU32Be(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] ?? 0) * 0x1000000 +
		((bytes[offset + 1] ?? 0) << 16) +
		((bytes[offset + 2] ?? 0) << 8) +
		(bytes[offset + 3] ?? 0)
	);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}
