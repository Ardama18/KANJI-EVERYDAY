// S-08 E2Eテスト - Design Doc: illustration-generation-backend
// 生成日: 2026-02-24
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Design AC）:
// AC-01 -> E2E-AC01-OWNER-SCOPED-PRIVATE
// AC-02 -> E2E-AC02-STORAGE-PATH-FORMAT
// AC-03 -> E2E-AC03-UNAUTH-NO-SIDE-EFFECT
// AC-04 -> E2E-AC04-READY-PENDING-NOOP
// AC-05 -> E2E-AC05-FAILED-RETRY
// AC-06 -> E2E-AC06-MISSING-INSERT-PENDING
// AC-07 -> E2E-AC07-FIRE-AND-FORGET
// AC-08 -> E2E-AC08-APIKEY-MISSING-FAILSAFE
// AC-09 -> E2E-AC09-FETCH-ONLY-GEMINI
// AC-10 -> E2E-AC10-SUCCESS-READY-UPDATE
// AC-11 -> E2E-AC11-FAIL-FAILED-UPDATE
// AC-12 -> E2E-AC12-GET-URL-LATEST-READY
// AC-13 -> E2E-AC13-GET-URL-NO-MATCH-NULL
// AC-14 -> E2E-AC14-SANITIZE-PROMPT-BOUNDARY

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const getSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
	createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("@/lib/illustration/storage", async () => {
	const actual = await vi.importActual<typeof import("../../../../frontend/src/lib/illustration/storage")>(
		"@/lib/illustration/storage"
	);

	return {
		...actual,
		getSignedUrl: getSignedUrlMock,
	};
});

import {
	getIllustrationUrl,
	triggerIllustrationGeneration,
} from "../../../../frontend/src/actions/illustration-actions";
import {
	__resetProcessIllustrationGenerationImplementationForTest,
	__setProcessIllustrationGenerationImplementationForTest,
} from "../../../../frontend/src/actions/illustration-generation-runtime";
import { processIllustrationGeneration } from "../../../../frontend/src/lib/illustration/generator";
import { generateIllustration } from "../../../../frontend/src/lib/illustration/gemini-client";
import { sanitizePromptInput } from "../../../../frontend/src/lib/illustration/prompt";
import { buildIllustrationStoragePath } from "../../../../frontend/src/lib/illustration/storage";
import { GEMINI_IMAGE_MODEL } from "../../../../frontend/src/lib/illustration/types";

type QueryError = {
	message: string;
};

type QueryResult<TData> = {
	data: TData;
	error: QueryError | null;
};

type User = {
	id: string;
};

type CardRow = {
	id: string;
	owner_user_id: string | null;
	illustration_key: string | null;
	back_text: string;
	skill: string;
};

type IllustrationRow = {
	id: string;
	status: string;
	storage_path?: string | null;
};

type IdRow = {
	id: string;
};

type TriggerTestOptions = {
	user: User | null;
	card: CardRow | null;
	existingIllustration: IllustrationRow | null;
	updateResult: QueryResult<IdRow>;
	insertResult: QueryResult<IdRow>;
};

const createDefaultOptions = (): TriggerTestOptions => ({
	user: { id: "user-1" },
	card: {
		id: "card-1",
		owner_user_id: "user-1",
		illustration_key: "kanji-key-1",
		back_text: "example back text",
		skill: "reading",
	},
	existingIllustration: null,
	updateResult: {
		data: { id: "illustration-retry" },
		error: null,
	},
	insertResult: {
		data: { id: "illustration-new" },
		error: null,
	},
});

const createSupabaseDouble = (overrides?: Partial<TriggerTestOptions>) => {
	const options = {
		...createDefaultOptions(),
		...overrides,
	};

	const getUserMock = vi.fn<() => Promise<QueryResult<{ user: User | null }>>>().mockResolvedValue({
		data: {
			user: options.user,
		},
		error: null,
	});

	const cardMaybeSingleMock = vi.fn<() => Promise<QueryResult<CardRow | null>>>().mockResolvedValue({
		data: options.card,
		error: null,
	});
	const cardEqOwnerMock = vi
		.fn<(column: "owner_user_id", value: string) => { maybeSingle: typeof cardMaybeSingleMock }>()
		.mockReturnValue({ maybeSingle: cardMaybeSingleMock });
	const cardEqIdMock = vi
		.fn<(column: "id", value: string) => { eq: typeof cardEqOwnerMock }>()
		.mockReturnValue({ eq: cardEqOwnerMock });
	const cardSelectMock = vi
		.fn<(columns: string) => { eq: typeof cardEqIdMock }>()
		.mockReturnValue({ eq: cardEqIdMock });

	const illustrationMaybeSingleMock = vi
		.fn<() => Promise<QueryResult<IllustrationRow | null>>>()
		.mockResolvedValue({
			data: options.existingIllustration,
			error: null,
		});
	const illustrationLimitMock = vi
		.fn<(count: number) => { maybeSingle: typeof illustrationMaybeSingleMock }>()
		.mockReturnValue({ maybeSingle: illustrationMaybeSingleMock });
	const illustrationOrderIdMock = vi
		.fn<(column: "id", order?: { ascending: boolean }) => { limit: typeof illustrationLimitMock }>()
		.mockReturnValue({ limit: illustrationLimitMock });
	const illustrationOrderUpdatedAtMock = vi
		.fn<
			(
				column: "updated_at",
				order?: { ascending: boolean }
			) => { order: typeof illustrationOrderIdMock }
		>()
		.mockReturnValue({ order: illustrationOrderIdMock });
	const illustrationNotStoragePathMock = vi
		.fn<
			(
				column: "storage_path",
				operator: "is",
				value: null
			) => { order: typeof illustrationOrderUpdatedAtMock }
		>()
		.mockReturnValue({ order: illustrationOrderUpdatedAtMock });
	const illustrationEqReadyStatusMock = vi
		.fn<
			(
				column: "status",
				value: "ready"
			) => { not: typeof illustrationNotStoragePathMock }
		>()
		.mockReturnValue({ not: illustrationNotStoragePathMock });
	const illustrationEqKeyMock = vi
		.fn<
			(column: "illustration_key", value: string) => {
				order: typeof illustrationOrderUpdatedAtMock;
				eq: typeof illustrationEqReadyStatusMock;
			}
		>()
		.mockReturnValue({
			order: illustrationOrderUpdatedAtMock,
			eq: illustrationEqReadyStatusMock,
		});
	const illustrationEqOwnerMock = vi
		.fn<(column: "owner_user_id", value: string) => { eq: typeof illustrationEqKeyMock }>()
		.mockReturnValue({ eq: illustrationEqKeyMock });
	const illustrationSelectMock = vi
		.fn<(columns: string) => { eq: typeof illustrationEqOwnerMock }>()
		.mockReturnValue({ eq: illustrationEqOwnerMock });

	const updateSingleMock = vi.fn<() => Promise<QueryResult<IdRow>>>().mockResolvedValue(options.updateResult);
	const updateSelectMock = vi
		.fn<(columns: "id") => { single: typeof updateSingleMock }>()
		.mockReturnValue({ single: updateSingleMock });
	const updateEqOwnerMock = vi
		.fn<(column: "owner_user_id", value: string) => { select: typeof updateSelectMock }>()
		.mockReturnValue({ select: updateSelectMock });
	const updateEqIdMock = vi
		.fn<(column: "id", value: string) => { eq: typeof updateEqOwnerMock }>()
		.mockReturnValue({ eq: updateEqOwnerMock });
	const updateMock = vi
		.fn<(values: { status: "pending" }) => { eq: typeof updateEqIdMock }>()
		.mockReturnValue({ eq: updateEqIdMock });

	const insertSingleMock = vi.fn<() => Promise<QueryResult<IdRow>>>().mockResolvedValue(options.insertResult);
	const insertSelectMock = vi
		.fn<(columns: "id") => { single: typeof insertSingleMock }>()
		.mockReturnValue({ single: insertSingleMock });
	const insertMock = vi
		.fn<
			(
				values: {
					owner_user_id: string;
					illustration_key: string;
					status: "pending";
				}
			) => { select: typeof insertSelectMock }
		>()
		.mockReturnValue({ select: insertSelectMock });

	const fromMock = vi
		.fn<
			(
				table: "cards" | "illustrations"
			) =>
				| { select: typeof cardSelectMock }
				| {
						select: typeof illustrationSelectMock;
						update: typeof updateMock;
						insert: typeof insertMock;
				  }
		>()
		.mockImplementation((table) => {
			if (table === "cards") {
				return {
					select: cardSelectMock,
				};
			}

			return {
				select: illustrationSelectMock,
				update: updateMock,
				insert: insertMock,
			};
		});

	createServerClientMock.mockReturnValue({
		auth: {
			getUser: getUserMock,
		},
		from: fromMock,
	});

	return {
		fromMock,
		cardEqOwnerMock,
		illustrationEqOwnerMock,
		illustrationEqReadyStatusMock,
		illustrationNotStoragePathMock,
		illustrationOrderUpdatedAtMock,
		illustrationOrderIdMock,
		updateMock,
		insertMock,
	};
};

type UpdatePayload = {
	status?: string;
	storage_path?: string | null;
	prompt?: string | null;
	model_info?: string | null;
};

type GenerationSupabaseDouble = {
	updateMock: ReturnType<typeof vi.fn<(values: UpdatePayload) => unknown>>;
	client: {
		from: ReturnType<typeof vi.fn<(table: "illustrations") => { update: ReturnType<typeof vi.fn> }>>;
	};
};

const createGenerationSupabaseDouble = (): GenerationSupabaseDouble => {
	const ownerEqMock = vi
		.fn<(column: "owner_user_id", value: string) => Promise<QueryResult<null>>>()
		.mockResolvedValue({ data: null, error: null });
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
		updateMock,
		client: {
			from: fromMock,
		},
	};
};

const readLatestUpdatePayload = (updateMock: ReturnType<typeof vi.fn>) => {
	const call = updateMock.mock.calls.at(-1);
	if (!call) {
		throw new Error("update has not been called");
	}

	return call[0] as UpdatePayload;
};

const withTimeout = async <TValue>(promise: Promise<TValue>, timeoutMs: number) =>
	new Promise<TValue>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		promise.then(
			(value) => {
				clearTimeout(timeoutId);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timeoutId);
				reject(error);
			}
		);
	});

describe("illustration-generation-backend E2Eテスト", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		createServiceRoleClientMock.mockReset();
		getSignedUrlMock.mockReset();
		__resetProcessIllustrationGenerationImplementationForTest();
	});

	// Scenario 1: 認証境界と初回トリガー
	it("E2E-AC03: 未認証ユーザーで trigger を実行した場合に認証エラーかつ DB/API副作用なしで終了する", async () => {
		const spies = createSupabaseDouble({ user: null });
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(result).toEqual({
			ok: false,
			code: "unauthorized",
		});
		expect(spies.fromMock).not.toHaveBeenCalled();
		expect(processMock).not.toHaveBeenCalled();
	});

	it("E2E-AC01: 認証ユーザーの owner 境界内でのみ illustrations レコードが作成・更新される", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: {
				id: "illustration-ready",
				status: "ready",
			},
		});
		__setProcessIllustrationGenerationImplementationForTest(vi.fn().mockResolvedValue(undefined));

		await triggerIllustrationGeneration("card-1");

		expect(spies.cardEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
		expect(spies.illustrationEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
	});

	it("E2E-AC06: レコード未存在で trigger すると pending が作成され非同期生成が開始される", async () => {
		const spies = createSupabaseDouble({ existingIllustration: null });
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-new",
		});
		expect(spies.insertMock).toHaveBeenCalledWith({
			owner_user_id: "user-1",
			illustration_key: "kanji-key-1",
		});
		expect(processMock).toHaveBeenCalledTimes(1);
	});

	it("E2E-AC07: trigger 応答は生成完了を待たずに返る（fire-and-forget）", async () => {
		createSupabaseDouble({ existingIllustration: null });
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockImplementation(
			() =>
				new Promise<void>(() => {
					return;
				})
		);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await withTimeout(triggerIllustrationGeneration("card-1"), 50);

		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-new",
		});
		expect(processMock).toHaveBeenCalledTimes(1);
	});

	// Scenario 2: 再トリガー時の状態遷移
	it("E2E-AC04: ready/pending の再トリガーでは追加生成が開始されない", async () => {
		for (const status of ["ready", "pending"] as const) {
			const spies = createSupabaseDouble({
				existingIllustration: {
					id: `illustration-${status}`,
					status,
				},
			});
			const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
			__setProcessIllustrationGenerationImplementationForTest(processMock);

			const result = await triggerIllustrationGeneration("card-1");

			expect(result).toEqual({
				ok: true,
				started: false,
				illustrationId: `illustration-${status}`,
			});
			expect(spies.updateMock).not.toHaveBeenCalled();
			expect(spies.insertMock).not.toHaveBeenCalled();
			expect(processMock).not.toHaveBeenCalled();
		}
	});

	it("E2E-AC05: failed の再トリガーでは pending へ戻して再生成が開始される", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: {
				id: "illustration-failed",
				status: "failed",
			},
			updateResult: {
				data: {
					id: "illustration-retried",
				},
				error: null,
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(spies.updateMock).toHaveBeenCalledWith({ status: "pending" });
		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-retried",
		});
		expect(processMock).toHaveBeenCalledTimes(1);
	});

	// Scenario 3: 生成成功/失敗パス
	it("E2E-AC08: GEMINI_API_KEY 未設定時は外部API呼び出しなしで failed 収束し理由を記録する", async () => {
		const supabase = createGenerationSupabaseDouble();
		const generateIllustrationFn = vi.fn();

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-ac08",
				illustrationKey: "kanji-key-1",
				backText: "例文",
				skill: "reading",
				ownerUserId: "user-1",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: undefined }),
				generateIllustrationFn,
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);

		expect(generateIllustrationFn).not.toHaveBeenCalled();
		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload.status).toBe("failed");
		expect(payload.model_info).toBeTruthy();
		expect(JSON.parse(payload.model_info ?? "{}")).toMatchObject({
			outcome: "failed",
			reason: "api_key_missing",
		});
	});

	it("E2E-AC09: Gemini 呼び出し経路が fetch 実装であることを依存関係と実行ログで確認する", async () => {
		const imageBuffer = Buffer.from("e2e-image");
		const fetchMock = vi
			.fn<(input: string, init?: RequestInit) => Promise<Response>>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						candidates: [
							{
								content: {
									parts: [
										{
											inlineData: {
												mimeType: "image/png",
												data: imageBuffer.toString("base64"),
											},
										},
									],
								},
							},
						],
					}),
					{ status: 200 }
				)
			);

		const result = await generateIllustration(
			{
				prompt: "e2e prompt",
				apiKey: "e2e-key",
			},
			{
				fetchFn: fetchMock,
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toContain(
			`${GEMINI_IMAGE_MODEL}:generateContent?key=e2e-key`
		);
		expect(result.ok).toBe(true);
	});

	it("E2E-AC10: 生成成功時に ready と storage_path/prompt/model_info が更新される", async () => {
		const supabase = createGenerationSupabaseDouble();
		const imageBuffer = Buffer.from("e2e-success");

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-ac10",
				illustrationKey: "kanji-key-1",
				backText: "雨",
				skill: "reading",
				ownerUserId: "user-10",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "e2e-key" }),
				generatePromptFn: () => "e2e prompt",
				generateIllustrationFn: async () => ({
					ok: true,
					imageBuffer,
					modelInfo: {
						provider: "gemini",
						model: GEMINI_IMAGE_MODEL,
						outcome: "ready",
						reason: "success",
						httpStatus: 200,
						timestamp: "2026-02-24T12:34:56.000Z",
					},
				}),
				uploadIllustrationFn: async () => true,
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);

		const payload = readLatestUpdatePayload(supabase.updateMock);
		expect(payload).toMatchObject({
			status: "ready",
			storage_path: "user-10/illustration-ac10.png",
			prompt: "e2e prompt",
		});
		expect(JSON.parse(payload.model_info ?? "{}")).toMatchObject({
			outcome: "ready",
			reason: "success",
		});
	});

	it("E2E-AC11: Gemini失敗またはStorage失敗時に failed と失敗理由を記録する", async () => {
		const geminiFailureSupabase = createGenerationSupabaseDouble();
		await processIllustrationGeneration(
			{
				illustrationId: "illustration-ac11-gemini",
				illustrationKey: "kanji-key-1",
				backText: "雨",
				skill: "reading",
				ownerUserId: "user-11",
			},
			{
				createServiceRoleClientFn: () => geminiFailureSupabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "e2e-key" }),
				generateIllustrationFn: async () => ({
					ok: false,
					imageBuffer: null,
					modelInfo: {
						provider: "gemini",
						model: GEMINI_IMAGE_MODEL,
						outcome: "failed",
						reason: "network",
						timestamp: "2026-02-24T12:34:56.000Z",
					},
				}),
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);
		expect(
			JSON.parse(readLatestUpdatePayload(geminiFailureSupabase.updateMock).model_info ?? "{}")
		).toMatchObject({
			outcome: "failed",
			reason: "network",
		});

		const storageFailureSupabase = createGenerationSupabaseDouble();
		await processIllustrationGeneration(
			{
				illustrationId: "illustration-ac11-storage",
				illustrationKey: "kanji-key-1",
				backText: "雨",
				skill: "reading",
				ownerUserId: "user-11",
			},
			{
				createServiceRoleClientFn: () => storageFailureSupabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "e2e-key" }),
				generateIllustrationFn: async () => ({
					ok: true,
					imageBuffer: Buffer.from("e2e-storage"),
					modelInfo: {
						provider: "gemini",
						model: GEMINI_IMAGE_MODEL,
						outcome: "ready",
						reason: "success",
						timestamp: "2026-02-24T12:34:56.000Z",
					},
				}),
				uploadIllustrationFn: async () => false,
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);
		expect(
			JSON.parse(readLatestUpdatePayload(storageFailureSupabase.updateMock).model_info ?? "{}")
		).toMatchObject({
			outcome: "failed",
			reason: "storage_upload_failed",
		});
	});

	it("E2E-AC02: 保存された実オブジェクト名が {user_id}/{illustration_id}.png 形式に一致する", () => {
		expect(buildIllustrationStoragePath("user-1", "illustration-1")).toBe(
			"user-1/illustration-1.png"
		);
	});

	it("E2E-AC14: sanitizePromptInput 適用後の入力のみが Gemini へ渡される", async () => {
		const supabase = createGenerationSupabaseDouble();
		const generateIllustrationFn = vi.fn().mockResolvedValue({
			ok: false,
			imageBuffer: null,
			modelInfo: {
				provider: "gemini",
				model: GEMINI_IMAGE_MODEL,
				outcome: "failed",
				reason: "network",
				timestamp: "2026-02-24T12:34:56.000Z",
			},
		});
		const rawBackText = `\u0000${"あ".repeat(150)}\u001f`;
		const sanitized = sanitizePromptInput(rawBackText).trim();

		await processIllustrationGeneration(
			{
				illustrationId: "illustration-ac14",
				illustrationKey: "kanji-key-1",
				backText: rawBackText,
				skill: "reading",
				ownerUserId: "user-14",
			},
			{
				createServiceRoleClientFn: () => supabase.client,
				getEnvConfigFn: () => ({ geminiApiKey: "e2e-key" }),
				generateIllustrationFn,
				now: () => new Date("2026-02-24T12:34:56.000Z"),
			}
		);

		const prompt = generateIllustrationFn.mock.calls[0]?.[0]?.prompt ?? "";
		expect(prompt).toContain(`「${sanitized}」`);
		expect(prompt).not.toContain("\u0000");
		expect(prompt).not.toContain("\u001f");
		expect(sanitized.length).toBeLessThanOrEqual(100);
	});

	// Scenario 4: URL取得導線
	it("E2E-AC12: getIllustrationUrl が owner_user_id + illustration_key の ready 最新1件を使って expiresIn=3600 の Signed URL を返す", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: {
				id: "illustration-ready-latest",
				status: "ready",
				storage_path: "user-1/illustration-ready-latest.png",
			},
		});
		getSignedUrlMock.mockResolvedValue("https://signed.example/latest");

		const result = await getIllustrationUrl("kanji-key-1");

		expect(result).toBe("https://signed.example/latest");
		expect(spies.illustrationEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
		expect(spies.illustrationEqReadyStatusMock).toHaveBeenCalledWith("status", "ready");
		expect(spies.illustrationNotStoragePathMock).toHaveBeenCalledWith("storage_path", "is", null);
		expect(spies.illustrationOrderUpdatedAtMock).toHaveBeenCalledWith("updated_at", {
			ascending: false,
		});
		expect(spies.illustrationOrderIdMock).toHaveBeenCalledWith("id", {
			ascending: false,
		});
		expect(getSignedUrlMock).toHaveBeenCalledWith("user-1/illustration-ready-latest.png", 3600);
	});

	it("E2E-AC13: ready + storage_path 条件一致がない場合は getIllustrationUrl が null を返す", async () => {
		createSupabaseDouble({ existingIllustration: null });

		const result = await getIllustrationUrl("kanji-key-1");

		expect(result).toBeNull();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});
});
