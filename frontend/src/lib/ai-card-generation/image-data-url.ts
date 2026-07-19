import { Buffer } from "node:buffer";

import type { SanitizedSourceImage } from "./contracts";

export function toImageDataUrl(image: SanitizedSourceImage): string {
	return `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
}
