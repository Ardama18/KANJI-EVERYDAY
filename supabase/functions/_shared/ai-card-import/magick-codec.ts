import {
	FilterType,
	ImageMagick,
	MagickFormat,
	initializeImageMagick,
} from "npm:@imagemagick/magick-wasm@0.0.35";

import type { DecodedImage, ImageCodec } from "./image-codec.ts";

let initialization: Promise<void> | undefined;

export function createLazyMagickCodec(): ImageCodec {
	let codec: Promise<ImageCodec> | undefined;
	const resolveCodec = (): Promise<ImageCodec> => {
		codec ??= createMagickCodec();
		return codec;
	};
	return {
		async decode(bytes) {
			return await (await resolveCodec()).decode(bytes);
		},
		async encodePng(input) {
			return await (await resolveCodec()).encodePng(input);
		},
		async transcodePng(input) {
			const transcode = (await resolveCodec()).transcodePng;
			if (transcode === undefined) throw new Error("IMAGE_DECODE_FAILED");
			return await transcode(input);
		},
	};
}

export async function createMagickCodec(
	input: {
		readonly wasmBytes?: Uint8Array;
		readonly observeResource?: () => void;
	} = {}
): Promise<ImageCodec> {
	initialization ??= initialize(input.wasmBytes);
	await initialization;
	const transcodePng: NonNullable<ImageCodec["transcodePng"]> = async ({
		bytes,
		width,
		height,
	}) => {
		return await new Promise((resolve, reject) => {
			try {
				ImageMagick.read(bytes, (image) => {
					input.observeResource?.();
					const sourceWidth = image.width;
					const sourceHeight = image.height;
					image.strip();
					image.filterType = FilterType.Box;
					if (image.width !== width || image.height !== height) image.resize(width, height);
					input.observeResource?.();
					image.write(MagickFormat.Png, (encoded) => {
						input.observeResource?.();
						resolve({ bytes: new Uint8Array(encoded), sourceWidth, sourceHeight });
					});
				});
			} catch (error) {
				reject(error);
			}
		});
	};
	return {
		async decode(bytes): Promise<DecodedImage> {
			return await new Promise((resolve, reject) => {
				try {
					ImageMagick.read(bytes, (image) => {
						input.observeResource?.();
						resolve({ width: image.width, height: image.height });
					});
				} catch (error) {
					reject(error);
				}
			});
		},
		async encodePng(input) {
			return (await transcodePng(input)).bytes;
		},
		transcodePng,
	};
}

async function initialize(wasmBytes: Uint8Array | undefined): Promise<void> {
	const bytes =
		wasmBytes ??
		(await Deno.readFile(
			new URL("magick.wasm", import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.35"))
		));
	await initializeImageMagick(bytes);
}
