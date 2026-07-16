import {
	ImageMagick,
	MagickFormat,
	initializeImageMagick,
} from "npm:@imagemagick/magick-wasm@0.0.35";

import type { DecodedImage, ImageCodec } from "./image-codec.ts";

let initialization: Promise<void> | undefined;

export async function createMagickCodec(
	input: {
		readonly wasmBytes?: Uint8Array;
		readonly observeResource?: () => void;
	} = {}
): Promise<ImageCodec> {
	initialization ??= initialize(input.wasmBytes);
	await initialization;
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
		async encodePng({ bytes, width, height }): Promise<Uint8Array> {
			return await new Promise((resolve, reject) => {
				try {
					ImageMagick.read(bytes, (image) => {
						input.observeResource?.();
						image.strip();
						if (image.width !== width || image.height !== height) image.resize(width, height);
						input.observeResource?.();
						image.write(MagickFormat.Png, (encoded) => {
							input.observeResource?.();
							resolve(new Uint8Array(encoded));
						});
					});
				} catch (error) {
					reject(error);
				}
			});
		},
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
