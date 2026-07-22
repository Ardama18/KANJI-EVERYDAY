import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const getSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));
vi.mock("@/lib/illustration/storage", () => ({
	getSignedUrl: getSignedUrlMock,
}));

import { getIllustrationUrl, triggerIllustrationGeneration } from "./illustration-actions";
import {
	__resetProcessIllustrationGenerationImplementationForTest,
	__setProcessIllustrationGenerationImplementationForTest,
} from "./illustration-generation-runtime";

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
};

type MnemonicSlotsShape = {
	kanji: string;
	isSingleKanji: boolean;
	shapeHint: { part: string; picture: string };
	meaningHint: string;
	story: string;
};

type MnemonicRow = {
	slots: unknown;
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
	mnemonic: MnemonicRow | null;
	existingIllustration: IllustrationRow | null;
	updateResult: QueryResult<IdRow>;
	insertResult: QueryResult<IdRow>;
};

const APPROVED_SLOTS: MnemonicSlotsShape = {
	kanji: "見",
	isSingleKanji: true,
	shapeHint: { part: "下の部分", picture: "人の足" },
	meaningHint: "みる",
	story: "目を大きく開いて見る",
};

const createDefaultOptions = (): TriggerTestOptions => ({
	user: { id: "user-1" },
	card: {
		id: "card-1",
		owner_user_id: "user-1",
		illustration_key: "kanji-key-1",
	},
	mnemonic: { slots: APPROVED_SLOTS },
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

	const cardMaybeSingleMock = vi
		.fn<() => Promise<QueryResult<CardRow | null>>>()
		.mockResolvedValue({
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

	const mnemonicMaybeSingleMock = vi
		.fn<() => Promise<QueryResult<MnemonicRow | null>>>()
		.mockResolvedValue({
			data: options.mnemonic,
			error: null,
		});
	const mnemonicEqStatusMock = vi
		.fn<(column: "status", value: "approved") => { maybeSingle: typeof mnemonicMaybeSingleMock }>()
		.mockReturnValue({ maybeSingle: mnemonicMaybeSingleMock });
	const mnemonicEqKeyMock = vi
		.fn<(column: "illustration_key", value: string) => { eq: typeof mnemonicEqStatusMock }>()
		.mockReturnValue({ eq: mnemonicEqStatusMock });
	const mnemonicEqOwnerMock = vi
		.fn<(column: "owner_user_id", value: string) => { eq: typeof mnemonicEqKeyMock }>()
		.mockReturnValue({ eq: mnemonicEqKeyMock });
	const mnemonicSelectMock = vi
		.fn<(columns: "slots") => { eq: typeof mnemonicEqOwnerMock }>()
		.mockReturnValue({ eq: mnemonicEqOwnerMock });

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
		.fn<
			(column: "id", options?: { ascending: boolean }) => { limit: typeof illustrationLimitMock }
		>()
		.mockReturnValue({ limit: illustrationLimitMock });
	const illustrationOrderUpdatedAtMock = vi
		.fn<
			(
				column: "updated_at",
				options?: { ascending: boolean }
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
		.fn<(column: "status", value: "ready") => { not: typeof illustrationNotStoragePathMock }>()
		.mockReturnValue({ not: illustrationNotStoragePathMock });
	const illustrationEqKeyMock = vi
		.fn<
			(
				column: "illustration_key",
				value: string
			) => {
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

	const updateSingleMock = vi
		.fn<() => Promise<QueryResult<IdRow>>>()
		.mockResolvedValue(options.updateResult);
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

	const insertSingleMock = vi
		.fn<() => Promise<QueryResult<IdRow>>>()
		.mockResolvedValue(options.insertResult);
	const insertSelectMock = vi
		.fn<(columns: "id") => { single: typeof insertSingleMock }>()
		.mockReturnValue({ single: insertSingleMock });
	const insertMock = vi
		.fn<
			(values: {
				owner_user_id: string;
				illustration_key: string;
				status: "pending";
			}) => { select: typeof insertSelectMock }
		>()
		.mockReturnValue({ select: insertSelectMock });

	const fromMock = vi
		.fn<
			(table: "cards" | "card_mnemonics" | "illustrations") =>
				| { select: typeof cardSelectMock }
				| { select: typeof mnemonicSelectMock }
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

			if (table === "card_mnemonics") {
				return {
					select: mnemonicSelectMock,
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
		getUserMock,
		fromMock,
		cardEqOwnerMock,
		mnemonicEqOwnerMock,
		mnemonicEqKeyMock,
		mnemonicEqStatusMock,
		illustrationEqOwnerMock,
		illustrationEqReadyStatusMock,
		illustrationNotStoragePathMock,
		illustrationOrderUpdatedAtMock,
		illustrationOrderIdMock,
		updateMock,
		updateEqIdMock,
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

describe("frontend/src/actions/illustration-actions.ts", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		getSignedUrlMock.mockReset();
		__resetProcessIllustrationGenerationImplementationForTest();
	});

	it("UT-AC-03-UNAUTH-NO-SIDE-EFFECT: 未認証では認証エラーを返し DB副作用0件で終了する", async () => {
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

	it.each(["ready", "pending"])(
		"UT-AC-04-READY-PENDING-NOOP: status=%s の既存レコードでは再生成を開始しない",
		async (status) => {
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
	);

	it("UT-AC-05-FAILED-RETRY-PENDING: failed レコードを pending に戻して再生成を開始する", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: {
				id: "illustration-failed",
				status: "failed",
			},
			updateResult: {
				data: { id: "illustration-retried" },
				error: null,
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(spies.updateMock).toHaveBeenCalledWith({ status: "pending" });
		expect(spies.updateEqIdMock).toHaveBeenCalledWith("id", "illustration-failed");
		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-retried",
		});
		expect(processMock).toHaveBeenCalledWith({
			illustrationId: "illustration-retried",
			illustrationKey: "kanji-key-1",
			slots: APPROVED_SLOTS,
			ownerUserId: "user-1",
		});
	});

	it("UT-AC-06-MISSING-INSERT-PENDING: レコード未存在では pending をINSERTして生成開始する", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: null,
			insertResult: {
				data: { id: "illustration-inserted" },
				error: null,
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(spies.insertMock).toHaveBeenCalledWith({
			owner_user_id: "user-1",
			illustration_key: "kanji-key-1",
		});
		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-inserted",
		});
		expect(processMock).toHaveBeenCalledWith({
			illustrationId: "illustration-inserted",
			illustrationKey: "kanji-key-1",
			slots: APPROVED_SLOTS,
			ownerUserId: "user-1",
		});
	});

	it("UT-AC-02-NO-APPROVED-MNEMONIC-SKIP: 承認済み card_mnemonics が無ければ生成を起動せず started=false を返す", async () => {
		const spies = createSupabaseDouble({
			mnemonic: null,
			existingIllustration: null,
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(result).toEqual({
			ok: true,
			started: false,
			illustrationId: null,
		});
		expect(spies.mnemonicEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
		expect(spies.mnemonicEqKeyMock).toHaveBeenCalledWith("illustration_key", "kanji-key-1");
		expect(spies.mnemonicEqStatusMock).toHaveBeenCalledWith("status", "approved");
		expect(spies.updateMock).not.toHaveBeenCalled();
		expect(spies.insertMock).not.toHaveBeenCalled();
		expect(processMock).not.toHaveBeenCalled();
	});

	it("UT-AC-02-INVALID-SLOTS-SKIP: 承認レコードの slots が不正形なら生成を起動しない", async () => {
		const spies = createSupabaseDouble({
			mnemonic: { slots: { kanji: "見" } },
			existingIllustration: null,
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(result).toEqual({
			ok: true,
			started: false,
			illustrationId: null,
		});
		expect(spies.insertMock).not.toHaveBeenCalled();
		expect(processMock).not.toHaveBeenCalled();
	});

	it("IT-AC-01-APPROVED-DRIVES-GENERATION: 承認 slots で pending を確保し検証済み slots を process へ渡す", async () => {
		const spies = createSupabaseDouble({
			mnemonic: { slots: APPROVED_SLOTS },
			existingIllustration: null,
			insertResult: {
				data: { id: "illustration-approved" },
				error: null,
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(spies.insertMock).toHaveBeenCalledWith({
			owner_user_id: "user-1",
			illustration_key: "kanji-key-1",
		});
		expect(result).toEqual({
			ok: true,
			started: true,
			illustrationId: "illustration-approved",
		});
		expect(processMock).toHaveBeenCalledWith({
			illustrationId: "illustration-approved",
			illustrationKey: "kanji-key-1",
			slots: APPROVED_SLOTS,
			ownerUserId: "user-1",
		});
	});

	it("IT-AC-02-UNAPPROVED-NO-PENDING: 未承認では pending 行を作らず生成を起動しない", async () => {
		const spies = createSupabaseDouble({
			mnemonic: null,
			existingIllustration: null,
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		const result = await triggerIllustrationGeneration("card-1");

		expect(result).toEqual({
			ok: true,
			started: false,
			illustrationId: null,
		});
		expect(spies.insertMock).not.toHaveBeenCalled();
		expect(spies.updateMock).not.toHaveBeenCalled();
		expect(processMock).not.toHaveBeenCalled();
	});

	it("UT-AC-07-FIRE-AND-FORGET: trigger は process 完了を待たずに応答する", async () => {
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

	it("UT-AC-01-OWNER-SCOPED-QUERY: cards/illustrations の検索条件に owner_user_id を必ず含める", async () => {
		const spies = createSupabaseDouble({
			existingIllustration: {
				id: "illustration-ready",
				status: "ready",
			},
		});
		const processMock = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined);
		__setProcessIllustrationGenerationImplementationForTest(processMock);

		await triggerIllustrationGeneration("card-1");

		expect(spies.cardEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
		expect(spies.illustrationEqOwnerMock).toHaveBeenCalledWith("owner_user_id", "user-1");
	});

	it("UT-AC-12-LATEST-READY-TIEBREAK: owner+key+ready+storage_path 条件で updated_at DESC, id DESC の最新1件のみを選び expiresIn=3600 で Signed URL を返す", async () => {
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

	it("UT-AC-13-NO-MATCH-RETURNS-NULL: AC-12 条件一致0件のとき getIllustrationUrl は null を返す", async () => {
		createSupabaseDouble({ existingIllustration: null });

		const result = await getIllustrationUrl("kanji-key-1");

		expect(result).toBeNull();
		expect(getSignedUrlMock).not.toHaveBeenCalled();
	});
});
