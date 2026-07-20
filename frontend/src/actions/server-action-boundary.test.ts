import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Server Action module boundaries", () => {
	it("do not export non-async runtime values from use server files", () => {
		const actionsDir = fileURLToPath(new URL(".", import.meta.url));
		const violations: string[] = [];

		for (const fileName of readdirSync(actionsDir)) {
			if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts")) continue;
			const source = readFileSync(join(actionsDir, fileName), "utf8");
			if (!source.startsWith('"use server";')) continue;

			for (const match of source.matchAll(/^export const\s+([A-Za-z0-9_]+)\s*=/gmu)) {
				const exportStart = match.index + match[0].length;
				const exportInitializer = source.slice(exportStart).trimStart();
				if (!exportInitializer.startsWith("async ")) {
					violations.push(`${fileName}: ${match[1]}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
