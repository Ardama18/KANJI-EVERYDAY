import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as magickModule from "@imagemagick/magick-wasm";

import type { ImageCodec } from "../../../../supabase/functions/_shared/ai-card-import/image-codec";

type MagickModule = typeof magickModule;

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

function createCodec({ FilterType, ImageMagick, MagickFormat }: MagickModule): ImageCodec {
	const transcodePng: NonNullable<ImageCodec["transcodePng"]> = async ({
		bytes,
		width,
		height,
	}) => {
		return await new Promise((resolve, reject) => {
			try {
				ImageMagick.read(bytes, (image) => {
					const sourceWidth = image.width;
					const sourceHeight = image.height;
					image.strip();
					image.filterType = FilterType.Box;
					if (image.width !== width || image.height !== height) image.resize(width, height);
					image.write(MagickFormat.Png, (encoded) =>
						resolve({
							bytes: new Uint8Array(encoded),
							sourceWidth,
							sourceHeight,
						})
					);
				});
			} catch (error) {
				reject(error);
			}
		});
	};
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
		async encodePng(input) {
			return (await transcodePng(input)).bytes;
		},
		transcodePng,
	};
}

async function initialize(): Promise<MagickModule> {
	const path = join(
		process.cwd(),
		"node_modules",
		"@imagemagick",
		"magick-wasm",
		"dist",
		"magick.wasm"
	);
	await magickModule.initializeImageMagick(new Uint8Array(await readFile(path)));
	return magickModule;
}
