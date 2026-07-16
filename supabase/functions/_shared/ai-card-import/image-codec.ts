import { MAX_ILLUSTRATION_EDGE, inspectImage } from "./image-validation.ts";

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
}

export interface NormalizedImage {
	readonly bytes: Uint8Array;
	readonly mime: "image/png";
	readonly width: number;
	readonly height: number;
}

export async function sanitizeSourceImage(
	input: { readonly bytes: Uint8Array; readonly declaredMime: string },
	codec: ImageCodec
): Promise<NormalizedImage> {
	const inspected = inspectImage(input.bytes, input.declaredMime);
	if (!inspected.ok) throw new Error(inspected.code);
	let decoded: DecodedImage;
	try {
		decoded = await codec.decode(input.bytes);
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	if (decoded.width !== inspected.width || decoded.height !== inspected.height) {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	let bytes: Uint8Array;
	try {
		bytes = await codec.encodePng({
			bytes: input.bytes,
			width: decoded.width,
			height: decoded.height,
		});
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	return { bytes, mime: "image/png", width: decoded.width, height: decoded.height };
}

export async function normalizeIllustration(
	input: { readonly bytes: Uint8Array; readonly declaredMime: string },
	codec: ImageCodec
): Promise<NormalizedImage> {
	const inspected = inspectImage(input.bytes, input.declaredMime, { illustration: true });
	if (!inspected.ok) throw new Error(inspected.code);
	let decoded: DecodedImage;
	try {
		decoded = await codec.decode(input.bytes);
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	if (decoded.width !== inspected.width || decoded.height !== inspected.height) {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	const scale = Math.min(1, MAX_ILLUSTRATION_EDGE / Math.max(decoded.width, decoded.height));
	const width = Math.max(1, Math.round(decoded.width * scale));
	const height = Math.max(1, Math.round(decoded.height * scale));
	if (width < 1 || height < 1 || width > MAX_ILLUSTRATION_EDGE || height > MAX_ILLUSTRATION_EDGE) {
		throw new Error("IMAGE_DIMENSIONS_INVALID");
	}
	let bytes: Uint8Array;
	try {
		bytes = await codec.encodePng({ bytes: input.bytes, width, height });
	} catch {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	// The 64px minimum is an input-quality constraint. Aspect-preserving downscaling
	// may legitimately make the normalized short edge smaller than 64px.
	const normalized = inspectImage(bytes, "image/png");
	if (!normalized.ok) throw new Error(normalized.code);
	if (
		normalized.width !== width ||
		normalized.height !== height ||
		normalized.width > MAX_ILLUSTRATION_EDGE ||
		normalized.height > MAX_ILLUSTRATION_EDGE
	) {
		throw new Error("IMAGE_DECODE_FAILED");
	}
	return { bytes, mime: "image/png", width, height };
}
