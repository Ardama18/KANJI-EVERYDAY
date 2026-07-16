import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import type { ImageCodec } from "../../../../supabase/functions/_shared/ai-card-import/image-codec";

let initialization: Promise<void> | undefined;
let magickModule: typeof import("@imagemagick/magick-wasm") | undefined;

export async function createSourceImageCodec(): Promise<ImageCodec> {
	initialization ??= initialize();
	await initialization;
	if (magickModule === undefined) throw new Error("IMAGE_CODEC_INITIALIZATION_FAILED");
	const { ImageMagick, MagickFormat } = magickModule;
	return {
		async decode(bytes) {
			return await new Promise((resolve, reject) => {
				try {
					ImageMagick.read(bytes, (image) => {
						resolve({ width: image.width, height: image.height });
					});
				} catch (error) {
					reject(error);
				}
			});
		},
		async encodePng({ bytes, width, height }) {
			return await new Promise((resolve, reject) => {
				try {
					ImageMagick.read(bytes, (image) => {
						image.strip();
						if (image.width !== width || image.height !== height) image.resize(width, height);
						image.write(MagickFormat.Png, (encoded) => resolve(new Uint8Array(encoded)));
					});
				} catch (error) {
					reject(error);
				}
			});
		},
	};
}

async function initialize(): Promise<void> {
	magickModule = await import(/* webpackIgnore: true */ "@imagemagick/magick-wasm");
	const wasmSpecifier = "@imagemagick/magick-wasm/magick.wasm";
	const path = createRequire(import.meta.url).resolve(wasmSpecifier);
	await magickModule.initializeImageMagick(new Uint8Array(await readFile(path)));
}
