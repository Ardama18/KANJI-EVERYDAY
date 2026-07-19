import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
	userId: "22222222-2222-4222-8222-222222222222",
	rpc: vi.fn(),
	from: vi.fn(),
	providerConfigured: false,
}));

vi.mock("@/lib/env", () => ({
	isAiCardImportEnabled: () => true,
	getOpenAiCardGenerationConfig: () =>
		boundary.providerConfigured
			? {
					apiKey: "test-key",
					model: "test-model",
					moderationModel: "omni-moderation-latest",
					imageDetail: "high",
					generationTimeoutMs: 60_000,
					moderationTimeoutMs: 10_000,
				}
			: undefined,
	getAiPreviewHmacSecret: () => "test-preview-secret",
}));

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: () => ({
		auth: { getUser: async () => ({ data: { user: { id: boundary.userId } } }) },
	}),
	createServiceRoleClient: () => ({
		rpc: boundary.rpc,
		from: boundary.from,
		storage: { from: vi.fn() },
	}),
}));

const uploadId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
	boundary.rpc.mockReset();
	boundary.from.mockReset();
	boundary.providerConfigured = false;
	boundary.rpc.mockResolvedValue({ data: { outcome: "deleted" }, error: null });
});

describe("regression: generation source release covers pre-provider failures", () => {
	it.each([
		["invalid generation input", 400, { requestedCardCount: 0 }],
		["missing provider configuration", 503, {}],
	] as const)("releases valid owned source IDs after %s", async (_case, status, overrides) => {
		const { POST } = await import("../../../app/api/ai/card-drafts/generate/route");
		const response = await POST(
			new Request("http://local/api/ai/card-drafts/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					deckId: "11111111-1111-4111-8111-111111111111",
					instruction: "一年生の漢字",
					pattern: "R1",
					requestedCardCount: 1,
					tags: [],
					illustration: "none",
					generationReservationKey: "reservation-1",
					sourceUploadIds: [uploadId],
					...overrides,
				}),
			})
		);

		expect(response.status).toBe(status);
		expect(boundary.rpc).toHaveBeenCalledWith("release_ai_generation_source", {
			p_owner_user_id: boundary.userId,
			p_upload_id: uploadId,
		});
	});
});
