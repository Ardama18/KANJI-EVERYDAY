import { describe, expect, it, vi } from "vitest";

import { ensureUserProfile } from "./ensure-user-profile";

type ProfileSelectResult = {
	data: { user_id: string } | null;
	error: { code?: string; message: string } | null;
};

type ProfileUpsertPayload = {
	user_id: string;
	display_name: string;
	timezone: "Asia/Tokyo";
};

type ProfileUpsertOptions = {
	onConflict: "user_id";
	ignoreDuplicates: true;
};

type ProfileUpsertResult = {
	error: { code?: string; message: string } | null;
};

const setupSupabaseClient = (options?: {
	profileSelectResult?: ProfileSelectResult;
	profileUpsertResult?: ProfileUpsertResult;
}) => {
	const maybeSingleMock = vi
		.fn<() => Promise<ProfileSelectResult>>()
		.mockResolvedValue(options?.profileSelectResult ?? { data: null, error: null });

	const eqMock = vi
		.fn<(column: "user_id", value: string) => { maybeSingle: typeof maybeSingleMock }>()
		.mockReturnValue({ maybeSingle: maybeSingleMock });

	const selectMock = vi
		.fn<(columns: "user_id") => { eq: typeof eqMock }>()
		.mockReturnValue({ eq: eqMock });

	const upsertMock = vi
		.fn<
			(payload: ProfileUpsertPayload, options: ProfileUpsertOptions) => Promise<ProfileUpsertResult>
		>()
		.mockResolvedValue(options?.profileUpsertResult ?? { error: null });

	const fromMock = vi
		.fn<(table: "users_profile") => { select: typeof selectMock; upsert: typeof upsertMock }>()
		.mockImplementation(() => ({ select: selectMock, upsert: upsertMock }));

	const supabase = {
		from: fromMock,
	};

	return { supabase, fromMock, selectMock, eqMock, maybeSingleMock, upsertMock };
};

describe("frontend/src/lib/auth/ensure-user-profile.ts", () => {
	it("欠損時に users_profile を作成する", async () => {
		const { fromMock, eqMock, upsertMock, supabase } = setupSupabaseClient();

		const result = await ensureUserProfile({
			supabase,
			user: {
				id: "user-1",
				email: "learner@example.com",
				user_metadata: {
					display_name: "  学習者  ",
				},
			},
		});

		expect(result).toBe("created");
		expect(fromMock).toHaveBeenCalledWith("users_profile");
		expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
		expect(upsertMock).toHaveBeenCalledWith(
			{
				user_id: "user-1",
				display_name: "学習者",
				timezone: "Asia/Tokyo",
			},
			{
				onConflict: "user_id",
				ignoreDuplicates: true,
			}
		);
	});

	it("既存の users_profile がある場合は作成をスキップする", async () => {
		const { supabase, upsertMock } = setupSupabaseClient({
			profileSelectResult: {
				data: { user_id: "user-1" },
				error: null,
			},
		});

		const result = await ensureUserProfile({
			supabase,
			user: {
				id: "user-1",
				email: "learner@example.com",
				user_metadata: null,
			},
		});

		expect(result).toBe("already_exists");
		expect(upsertMock).not.toHaveBeenCalled();
	});

	it("競合エラー時は成功扱いで冪等性を維持する", async () => {
		const { supabase } = setupSupabaseClient({
			profileUpsertResult: {
				error: {
					code: "23505",
					message: "duplicate key value violates unique constraint",
				},
			},
		});

		const result = await ensureUserProfile({
			supabase,
			user: {
				id: "user-1",
				email: "learner@example.com",
				user_metadata: null,
			},
		});

		expect(result).toBe("already_exists");
	});
});
