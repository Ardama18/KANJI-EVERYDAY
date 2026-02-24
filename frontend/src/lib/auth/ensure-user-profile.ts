import { resolveDisplayName } from "./display-name";

type ProfileSelectError = { code?: string; message: string } | null;

export type EnsureUserProfileClient = {
	from: (table: "users_profile") => {
		select: (columns: "user_id") => {
			eq: (
				column: "user_id",
				value: string
			) => {
				maybeSingle: () => PromiseLike<{
					data: { user_id: string } | null;
					error: ProfileSelectError;
				}>;
			};
		};
		upsert: (
			payload: {
				user_id: string;
				display_name: string;
				timezone: "Asia/Tokyo";
			},
			options: {
				onConflict: "user_id";
				ignoreDuplicates: true;
			}
		) => PromiseLike<{
			error: ProfileSelectError;
		}>;
	};
};

export type EnsureUserProfileUser = {
	id: string;
	email: string;
	user_metadata: Record<string, unknown> | null;
};

export type EnsureUserProfileResult = "created" | "already_exists";

const PROFILE_TABLE = "users_profile";
const DEFAULT_TIMEZONE = "Asia/Tokyo";

const isConflictError = (error: { code?: string; message: string }) => {
	const code = (error.code ?? "").toLowerCase();
	const message = error.message.toLowerCase();

	return code === "23505" || message.includes("duplicate key");
};

const getDisplayNameCandidate = (user: EnsureUserProfileUser) => {
	const value = user.user_metadata?.display_name;
	return typeof value === "string" ? value : "";
};

export const ensureUserProfile = async (input: {
	supabase: EnsureUserProfileClient;
	user: EnsureUserProfileUser;
}): Promise<EnsureUserProfileResult> => {
	const { data: existingProfile, error: selectError } = await input.supabase
		.from(PROFILE_TABLE)
		.select("user_id")
		.eq("user_id", input.user.id)
		.maybeSingle();

	if (selectError) {
		throw selectError;
	}

	if (existingProfile) {
		return "already_exists";
	}

	const displayName = resolveDisplayName({
		displayName: getDisplayNameCandidate(input.user),
		email: input.user.email,
	});

	const { error: upsertError } = await input.supabase.from(PROFILE_TABLE).upsert(
		{
			user_id: input.user.id,
			display_name: displayName,
			timezone: DEFAULT_TIMEZONE,
		},
		{
			onConflict: "user_id",
			ignoreDuplicates: true,
		}
	);

	if (!upsertError) {
		return "created";
	}

	if (isConflictError(upsertError)) {
		return "already_exists";
	}

	throw upsertError;
};
