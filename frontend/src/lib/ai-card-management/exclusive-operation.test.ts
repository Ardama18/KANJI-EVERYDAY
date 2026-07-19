import { describe, expect, it, vi } from "vitest";

import { createExclusiveOperationRunner } from "./exclusive-operation";

describe("S-13 exclusive UI operations", () => {
	it("ignores a second interaction while the first is pending", async () => {
		let release: (() => void) | undefined;
		const pending: boolean[] = [];
		const operation = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		const runner = createExclusiveOperationRunner((value) => pending.push(value));
		const first = runner(operation, vi.fn());
		expect(await runner(operation, vi.fn())).toBe(false);
		expect(operation).toHaveBeenCalledTimes(1);
		release?.();
		expect(await first).toBe(true);
		expect(pending).toEqual([true, false]);
	});

	it("clears pending and permits retry after a rejected action", async () => {
		const pending: boolean[] = [];
		const rejected = vi.fn();
		const runner = createExclusiveOperationRunner((value) => pending.push(value));
		expect(await runner(() => Promise.reject(new Error("network")), rejected)).toBe(true);
		expect(rejected).toHaveBeenCalledTimes(1);
		expect(await runner(() => Promise.resolve(), rejected)).toBe(true);
		expect(pending).toEqual([true, false, true, false]);
	});
});
