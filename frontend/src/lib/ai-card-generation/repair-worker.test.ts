import { describe, expect, it, vi } from "vitest";
import { pngFixture } from "../../../../specs/stories/S-11-ai-card-async-processing/tests/helpers/s11-edge-testkit";
import { processOneRepair } from "../../../../supabase/functions/_shared/ai-card-import/repair-worker.ts";
import { sha256Hex } from "../../../../supabase/functions/_shared/ai-card-import/storage.ts";

const slots = {
	kanji: "危ない",
	isSingleKanji: false,
	shapeHint: { part: "崖", picture: "手すり" },
	meaningHint: "注意する",
	story: "崖の手すりで止まる",
};
function harness(row: Record<string, unknown> = {}) {
	const png = pngFixture(64, 64);
	const claim = vi.fn(async () => ({
		outcome: "claimed",
		repairId: "repair",
		token: "lease",
		path: "new.png",
		slots,
		...row,
	}));
	const database = {
		claim,
		generated: vi.fn(async () => undefined),
		finalize: vi.fn(async () => ({ status: "succeeded" })),
		fail: vi.fn(async () => undefined),
	};
	const generate = vi.fn(async (_input: { prompt: string; signal: AbortSignal }) => ({
		kind: "success" as const,
		bytes: png,
		declaredMime: "image/png",
	}));
	const storage = {
		readSource: vi.fn(async () => png),
		writeIllustration: vi.fn(async () => ({ kind: "success" as const })),
		readIllustration: vi.fn(async () => png),
		deleteObject: vi.fn(async () => ({ kind: "success" as const })),
	};
	const deps = {
		database,
		storage,
		codec: { decode: async () => ({ width: 64, height: 64 }), encodePng: async () => png },
		providerEnvironment: { OPENAI_API_KEY: "fixture", OPENAI_IMAGE_MODEL: "fixture" },
		providers: { openai: { generate }, gemini: { generate } },
		randomUuid: () => "lease",
	};
	return { database, generate, storage, png, deps };
}
describe("Issue #97 repair worker", () => {
	it("uses all multi-character slots and records provenance before the atomic swap", async () => {
		const h = harness();
		expect(await processOneRepair(h.deps)).toBe("succeeded");
		expect(h.generate).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: expect.stringContaining("手すり") })
		);
		expect(h.generate.mock.calls[0]?.[0]?.prompt).toContain("崖の手すりで止まる");
		expect(h.database.generated).toHaveBeenCalledWith(
			expect.objectContaining({
				repairId: "repair",
				digest: await sha256Hex(h.png),
				promptHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
			})
		);
		expect(h.database.generated.mock.invocationCallOrder[0]).toBeLessThan(
			h.database.finalize.mock.invocationCallOrder[0]
		);
		expect(h.storage.deleteObject).not.toHaveBeenCalled();
	});
	it("never generates a generic image when approved slots are invalid", async () => {
		const h = harness({ slots: { ...slots, shapeHint: { part: "", picture: "" } } });
		expect(await processOneRepair(h.deps)).toBe("failed");
		expect(h.generate).not.toHaveBeenCalled();
		expect(h.storage.writeIllustration).not.toHaveBeenCalled();
		expect(h.database.fail).toHaveBeenCalledWith("repair", "lease", "MNEMONIC_VALIDATION_FAILED");
	});
	it("verifies a durable image without regeneration when active study postpones the swap", async () => {
		const digest = await sha256Hex(pngFixture(64, 64));
		const h = harness({ digest });
		h.database.finalize.mockResolvedValue({ status: "generated" });
		expect(await processOneRepair(h.deps)).toBe("blocked");
		expect(h.generate).not.toHaveBeenCalled();
		expect(h.storage.writeIllustration).not.toHaveBeenCalled();
		expect(h.database.generated).not.toHaveBeenCalled();
	});
	it("refuses a mismatched stored image and never overwrites it", async () => {
		const h = harness({ digest: "a".repeat(64) });
		expect(await processOneRepair(h.deps)).toBe("failed");
		expect(h.database.fail).toHaveBeenCalledWith("repair", "lease", "OBJECT_CONFLICT");
		expect(h.generate).not.toHaveBeenCalled();
		expect(h.database.finalize).not.toHaveBeenCalled();
	});
	it("recovers an ambiguous successful upload only if bytes match", async () => {
		const h = harness();
		h.storage.writeIllustration.mockResolvedValue({ kind: "transient" } as never);
		expect(await processOneRepair(h.deps)).toBe("succeeded");
		expect(h.storage.readIllustration).toHaveBeenCalledWith("new.png");
	});
	it("keeps a lost lease fenced without orphaning any object", async () => {
		const h = harness();
		h.database.generated.mockRejectedValue(new Error("private SQL"));
		expect(await processOneRepair(h.deps)).toBe("recoverable");
		expect(h.database.fail).not.toHaveBeenCalled();
		expect(h.database.finalize).not.toHaveBeenCalled();
	});
});
