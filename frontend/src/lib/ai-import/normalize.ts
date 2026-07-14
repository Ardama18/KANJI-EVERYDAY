const FIXED_WHITE_SPACE_CODE_POINTS = new Set([
	...range(0x0009, 0x000d),
	0x0020,
	0x0085,
	0x00a0,
	0x1680,
	...range(0x2000, 0x200a),
	0x2028,
	0x2029,
	0x202f,
	0x205f,
	0x3000,
]);

export function normalizeDisplayText(value: string): string {
	if (!isUnicodeScalarText(value)) {
		throw new TypeError("Text must contain only Unicode scalar values");
	}
	return value
		.normalize("NFKC")
		.replaceAll(/./gsu, (character) =>
			FIXED_WHITE_SPACE_CODE_POINTS.has(character.codePointAt(0) ?? -1) ? " " : character
		)
		.replace(/ +/gu, " ")
		.replace(/^ | $/gu, "");
}

export function isUnicodeScalarText(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false;
		}
	}
	return true;
}

export function normalizeForKey(value: string): string {
	return normalizeDisplayText(value).toLowerCase();
}

function range(start: number, end: number): number[] {
	return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
