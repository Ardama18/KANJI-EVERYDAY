import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import type { ImageCodec } from "../../../../supabase/functions/_shared/ai-card-import/image-codec";

type MagickModule = typeof import("@imagemagick/magick-wasm");

export function createSourceImageCodecFactory(
	loadModule: () => Promise<MagickModule>
): () => Promise<ImageCodec> {
	let initialization: Promise<MagickModule> | undefined;
	return async () => {
		if (initialization === undefined) initialization = loadModule();
		const attempt = initialization;
		let module: MagickModule;
		try {
			module = await attempt;
		} catch {
			if (initialization === attempt) initialization = undefined;
			throw new Error("IMAGE_CODEC_INITIALIZATION_FAILED");
		}
		return createCodec(module);
	};
}

export const createSourceImageCodec = createSourceImageCodecFactory(initialize);

function createCodec({ ImageMagick, MagickFormat }: MagickModule): ImageCodec {
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

async function initialize(): Promise<MagickModule> {
	const magickModule = await import(/* webpackIgnore: true */ "@imagemagick/magick-wasm");
	const wasmSpecifier = "@imagemagick/magick-wasm/magick.wasm";
	const path = createRequire(import.meta.url).resolve(wasmSpecifier);
	await magickModule.initializeImageMagick(new Uint8Array(await readFile(path)));
	return magickModule;
}
