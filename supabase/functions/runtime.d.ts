declare const Deno: {
	readonly env: { get(name: string): string | undefined };
	readFile(path: string | URL): Promise<Uint8Array>;
	memoryUsage(): { readonly rss: number; readonly heapTotal: number; readonly heapUsed: number; readonly external: number };
	serve(handler: (request: Request) => Response | Promise<Response>): void;
};

declare module "npm:@imagemagick/magick-wasm@0.0.35" {
	export const MagickFormat: { readonly Png: unknown };
	export function initializeImageMagick(
		wasmLocationDataOrAssembly: URL | Uint8Array | WebAssembly.Module
	): Promise<void>;
	export const ImageMagick: {
		read(
			bytes: Uint8Array,
			callback: (image: {
				readonly width: number;
				readonly height: number;
				strip(): void;
				resize(width: number, height: number): void;
				write(format: unknown, callback: (bytes: Uint8Array) => void): void;
			}) => void
		): void;
	};
}
