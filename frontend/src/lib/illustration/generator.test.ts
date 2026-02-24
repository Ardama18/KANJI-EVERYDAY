import { describe, expect, it, vi } from "vitest";

import { processIllustrationGeneration } from "./generator";
import { GEMINI_IMAGE_MODEL, type GeminiModelInfo } from "./types";

type QueryError = {
	message: string;
};

type UpdatePayload = {
	status?: string;
	storage_path?: string | null;
	prompt?: string | null;
	model_info?: string | null;
};

type UpdateResult = {
	error: QueryError | null;
};

const FIXED_TIMESTAMP = new Date("2026-02-24T12:34:56.000Z");

const createSupabaseDouble = () => {
	const ownerEqMock = vi
		.fn<(column: "owner_user_id", value: string) => Promise<UpdateResult>>()
		.mockResolvedValue({ error: null });
	const idEqMock = vi
		.fn<(column: "id", value: string) => { eq: typeof ownerEqMock }>()
		.mockReturnValue({ eq: ownerEqMock });
	const updateMock = vi
		.fn<(values: UpdatePayload) => { eq: typeof idEqMock }>()
		.mockReturnValue({ eq: idEqMock });
	const fromMock = vi
		.fn<(table: "illustrations") => { update: typeof updateMock }>()
		.mockReturnValue({ update: updateMock });

	return {
		client: {
			from: fromMock,
		},
		fromMock,
		updateMock,
		idEqMock,
		ownerEqMock,
	};
};

const readLatestUpdatePayload = (updateMock: ReturnType<typeof vi.fn>) => {
	const call = updateMock.mock.calls.at(-1);
	if (!call) {
		throw new Error("update has not been called");
	}

	return call[0] as UpdatePayload;
};

const parseModelInfo = (payload: UpdatePayload): GeminiModelInfo => {
	if (!payload.model_info) {
		throw new Error("model_info is missing");
	}

	return JSON.parse(payload.model_info) as GeminiModelInfo;
};

describe("processIllustrationGeneration", () => {
	it("UT-AC10-SUCCESS-READY-UPDATE: 生成成功時に ready と storage_path/prompt/model_info を更新する", async () => {
		const supabase = createSupabaseDouble();
		const imageBuffer = Buffer.from("fake-png");
		const generateIllustrationFn = vi.fn().mockResolvedValue({
			ok: true,
			imageBuffer,
			modelInfo: {
				provider: "gemini",
				model: GEMINI_IMAGE_MODEL,
				outcome: "ready",
				reason: "success",
				httpStatus: 200,
				requestId: "request-success",
				timestamp: FIXED_TIMESTAMP.toISOString(),
			},
		});
		const uploadIllustrationFn = vi.fn().mockResolvedValue(true);

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-1",
				illustrationKey: "kanji-key",
				backText: "漢字の意味",
				skill: "reading",
				ownerUserId: "user-1",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "test-key" }),
				generatePromptFn: () => "sanitized prompt",
				generateIllustrationFn,
				uploadIllustrationFn,
				now: () => FIXED_TIMESTAMP,
			}
		);

		expect(generateIllustrationFn).toHaveBeenCalledWith({
			prompt: "sanitized prompt",
			apiKey: "test-key",
		});
		expect(uploadIllustrationFn).toHaveBeenCalledWith(imageBuffer, "user-1/illustration-1.png");
		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload).toMatchObject({
			status: "ready",
			storage_path: "user-1/illustration-1.png",
			prompt: "sanitized prompt",
		});
		expect(parseModelInfo(payload)).toMatchObject({
			outcome: "ready",
			reason: "success",
			requestId: "request-success",
		});
	});

	it("UT-AC08-APIKEY-MISSING: APIキー未設定時は Gemini を呼び出さず failed に収束する", async () => {
		const supabase = createSupabaseDouble();
		const generateIllustrationFn = vi.fn();
		const uploadIllustrationFn = vi.fn();

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-2",
				illustrationKey: "kanji-key",
				backText: "漢字の意味",
				skill: "reading",
				ownerUserId: "user-2",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: undefined }),
				generatePromptFn: () => "sanitized prompt",
				generateIllustrationFn,
				uploadIllustrationFn,
				now: () => FIXED_TIMESTAMP,
			}
		);

		expect(generateIllustrationFn).not.toHaveBeenCalled();
		expect(uploadIllustrationFn).not.toHaveBeenCalled();
		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload).toMatchObject({
			status: "failed",
			prompt: "sanitized prompt",
		});
		expect(parseModelInfo(payload)).toMatchObject({
			outcome: "failed",
			reason: "api_key_missing",
		});
	});

	it("UT-AC11-GEMINI-FAIL: Gemini 失敗時に failed と失敗理由を記録する", async () => {
		const supabase = createSupabaseDouble();
		const uploadIllustrationFn = vi.fn();

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-3",
				illustrationKey: "kanji-key",
				backText: "漢字の意味",
				skill: "writing",
				ownerUserId: "user-3",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "test-key" }),
				generatePromptFn: () => "sanitized prompt",
				generateIllustrationFn: async () => ({
					ok: false,
					imageBuffer: null,
					modelInfo: {
						provider: "gemini",
						model: GEMINI_IMAGE_MODEL,
						outcome: "failed",
						reason: "rate_limit",
						httpStatus: 429,
						timestamp: FIXED_TIMESTAMP.toISOString(),
					},
				}),
				uploadIllustrationFn,
				now: () => FIXED_TIMESTAMP,
			}
		);

		expect(uploadIllustrationFn).not.toHaveBeenCalled();
		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload.status).toBe("failed");
		expect(parseModelInfo(payload)).toMatchObject({
			outcome: "failed",
			reason: "rate_limit",
		});
	});

	it("UT-AC11-STORAGE-FAIL: Storage 失敗時に failed と storage_upload_failed を記録する", async () => {
		const supabase = createSupabaseDouble();

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-4",
				illustrationKey: "kanji-key",
				backText: "漢字の意味",
				skill: "reading",
				ownerUserId: "user-4",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "test-key" }),
				generatePromptFn: () => "sanitized prompt",
				generateIllustrationFn: async () => ({
					ok: true,
					imageBuffer: Buffer.from("fake-png"),
					modelInfo: {
						provider: "gemini",
						model: GEMINI_IMAGE_MODEL,
						outcome: "ready",
						reason: "success",
						httpStatus: 200,
						requestId: "request-storage-fail",
						timestamp: FIXED_TIMESTAMP.toISOString(),
					},
				}),
				uploadIllustrationFn: async () => false,
				now: () => FIXED_TIMESTAMP,
			}
		);

		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload.status).toBe("failed");
		expect(parseModelInfo(payload)).toMatchObject({
			outcome: "failed",
			reason: "storage_upload_failed",
			requestId: "request-storage-fail",
		});
	});
});
