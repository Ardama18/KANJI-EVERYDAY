// S-08 統合テスト - Design Doc: illustration-generation-backend
// 生成日: 2026-02-24
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Design AC）:
// AC-01 -> IT-AC01-OWNER-SCOPED-PRIVATE
// AC-02 -> IT-AC02-STORAGE-PATH-FORMAT
// AC-03 -> IT-AC03-UNAUTH-NO-SIDE-EFFECT
// AC-04 -> IT-AC04-READY-PENDING-NOOP
// AC-05 -> IT-AC05-FAILED-RETRY
// AC-06 -> IT-AC06-MISSING-INSERT-PENDING
// AC-07 -> IT-AC07-FIRE-AND-FORGET
// AC-08 -> IT-AC08-APIKEY-MISSING-FAILSAFE
// AC-09 -> IT-AC09-FETCH-ONLY-GEMINI
// AC-10 -> IT-AC10-SUCCESS-READY-UPDATE
// AC-11 -> IT-AC11-FAIL-FAILED-UPDATE
// AC-12 -> IT-AC12-GET-URL-LATEST-READY
// AC-13 -> IT-AC13-GET-URL-NO-MATCH-NULL
// AC-14 -> IT-AC14-SANITIZE-PROMPT-BOUNDARY

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

import {
	__resetProcessIllustrationGenerationImplementationForTest,
	__setProcessIllustrationGenerationImplementationForTest,
	triggerIllustrationGeneration,
} from "../../../../frontend/src/actions/illustration-actions";

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
	const illustrationEqKeyMock = vi
		.fn<(column: "illustration_key", value: string) => { order: typeof illustrationOrderUpdatedAtMock }>()
		.mockReturnValue({ order: illustrationOrderUpdatedAtMock });
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
		updateMock,
		insertMock,
	};
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

describe("illustration-generation-backend 統合テスト", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		__resetProcessIllustrationGenerationImplementationForTest();
	});

	it("IT-AC01: illustrations が owner scoped private（owner_user_id 必須）で運用されることを検証する", async () => {
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

	it("IT-AC03: 未認証 trigger 呼び出しで認証エラーを返し DB副作用0件・外部API呼び出し0回で終了する", async () => {
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

	it("IT-AC04: 既存レコードが ready/pending の場合は新規生成を開始しない", async () => {
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

	it("IT-AC05: 既存レコードが failed の場合は pending に戻して再生成を開始する", async () => {
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

	it("IT-AC06: 対象レコードなしの場合は pending INSERT 後に生成を開始する", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: null,
			insertResult: {
				data: {
					id: "illustration-inserted",
				},
				error: null,
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(spies.insertMock).toHaveBeenCalledWith({
			owner_user_id: "user-1",
			illustration_key: "kanji-key-1",
			status: "pending",
		});
		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-inserted",
		});
		expect(processMock).toHaveBeenCalledTimes(1);
	});

	it("IT-AC07: trigger が void processIllustrationGeneration(...) で fire-and-forget 起動し完了待ちしない", async () => {
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

	// Phase 2: 生成パイプライン
	it.todo("IT-AC02: Storage オブジェクト名が常に {user_id}/{illustration_id}.png 形式で生成される")
	it.todo("IT-AC08: GEMINI_API_KEY 未設定時は Gemini API未呼び出しで status=failed と model_info.reason を記録する")
	it.todo("IT-AC09: Gemini 連携が fetch ベースで実装され SDK 依存が追加されていないことを検証する")
	it.todo("IT-AC10: 生成とアップロード成功時に status=ready, storage_path, prompt, model_info を更新する")
	it.todo("IT-AC11: Gemini または Storage 失敗時に status=failed と model_info の失敗理由を記録する")
	it.todo("IT-AC14: sanitizePromptInput が制御文字除去と100文字上限を適用した入力のみを Gemini に渡す")

	// Phase 3: URL 取得
	it.todo("IT-AC12: getIllustrationUrl が owner_user_id + illustration_key で ready最新1件を選び expiresIn=3600 の Signed URL を返す")
	it.todo("IT-AC13: AC-12 条件一致が0件のとき getIllustrationUrl が null を返す")
});
