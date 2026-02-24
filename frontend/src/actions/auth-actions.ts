"use server";

import { resolveDisplayName } from "@/lib/auth/display-name";
import { type EnsureUserProfileClient, ensureUserProfile } from "@/lib/auth/ensure-user-profile";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

import {
	AUTH_FIELD_MESSAGES,
	type AuthActionState,
	type AuthFieldErrors,
	LOGIN_ERROR_CODES,
	LOGIN_ERROR_MESSAGES,
	LOGIN_ERROR_MESSAGES_BY_CODE,
	type LoginErrorCode,
	SIGN_UP_ERROR_CODES,
	SIGN_UP_ERROR_MESSAGES,
	SIGN_UP_ERROR_MESSAGES_BY_CODE,
	type SignUpErrorCode,
} from "./auth-types";

const SIGN_UP_REDIRECT_PATH = "/decks";
const SIGN_IN_REDIRECT_PATH = "/decks";
const SIGN_OUT_REDIRECT_PATH = "/login";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MappableAuthError = {
	code?: string;
	message?: string;
};

type UsersProfileInsertClient = {
	from: (table: "users_profile") => {
		insert: (values: {
			user_id: string;
			display_name: string;
			timezone: "Asia/Tokyo";
		}) => PromiseLike<{
			error: { message: string } | null;
		}>;
	};
};

const getFormValue = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
};

const asUsersProfileInsertClient = (
	client: ReturnType<typeof createServerClient>
): UsersProfileInsertClient => client as unknown as UsersProfileInsertClient;

const asEnsureUserProfileClient = (
	client: ReturnType<typeof createServerClient>
): EnsureUserProfileClient => client as unknown as EnsureUserProfileClient;

const hasFieldErrors = (fieldErrors: AuthFieldErrors) => Object.keys(fieldErrors).length > 0;

const containsAny = (value: string, candidates: string[]) =>
	candidates.some((candidate) => value.includes(candidate));

const normalizeAuthError = (error: MappableAuthError) => ({
	code: (error.code ?? "").toLowerCase(),
	message: (error.message ?? "").toLowerCase(),
});

const mapSignUpErrorCode = (error: MappableAuthError): SignUpErrorCode => {
	const normalized = normalizeAuthError(error);

	if (
		normalized.code === "user_already_exists" ||
		(containsAny(normalized.message, ["already"]) &&
			containsAny(normalized.message, ["exist", "register"]))
	) {
		return SIGN_UP_ERROR_CODES.duplicateEmail;
	}

	if (
		normalized.code === "weak_password" ||
		(containsAny(normalized.message, ["password"]) &&
			containsAny(normalized.message, ["least", "minimum"]))
	) {
		return SIGN_UP_ERROR_CODES.weakPassword;
	}

	return SIGN_UP_ERROR_CODES.serverError;
};

const mapSignInErrorCode = (error: MappableAuthError): LoginErrorCode => {
	const normalized = normalizeAuthError(error);

	if (
		normalized.code === "invalid_credentials" ||
		(containsAny(normalized.message, ["invalid", "wrong"]) &&
			containsAny(normalized.message, ["credential", "password", "email"]))
	) {
		return LOGIN_ERROR_CODES.invalidCredentials;
	}

	return LOGIN_ERROR_CODES.serverError;
};

const toSignUpErrorState = (error: MappableAuthError): AuthActionState => {
	const errorCode = mapSignUpErrorCode(error);
	return {
		status: "error",
		message: SIGN_UP_ERROR_MESSAGES_BY_CODE[errorCode],
	};
};

const toSignInErrorState = (error: MappableAuthError): AuthActionState => {
	const errorCode = mapSignInErrorCode(error);
	return {
		status: "error",
		message: LOGIN_ERROR_MESSAGES_BY_CODE[errorCode],
	};
};

const validateSignUpInput = (input: {
	displayName: string;
	email: string;
	password: string;
}): AuthFieldErrors => {
	const fieldErrors: AuthFieldErrors = {};

	const trimmedDisplayName = input.displayName.trim();
	if (trimmedDisplayName.length < 1 || trimmedDisplayName.length > 20) {
		fieldErrors.displayName = AUTH_FIELD_MESSAGES.displayName;
	}

	if (!EMAIL_PATTERN.test(input.email)) {
		fieldErrors.email = AUTH_FIELD_MESSAGES.email;
	}

	if (input.password.length < 8) {
		fieldErrors.password = AUTH_FIELD_MESSAGES.password;
	}

	return fieldErrors;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const toRescueUser = (input: {
	id: string;
	email: string | null;
	userMetadata: unknown;
}) => {
	if (typeof input.email !== "string" || input.email.trim().length === 0) {
		return null;
	}

	return {
		id: input.id,
		email: input.email,
		user_metadata: isRecord(input.userMetadata) ? input.userMetadata : null,
	};
};

export async function signUp(
	_prevState: AuthActionState,
	formData: FormData
): Promise<AuthActionState> {
	const displayName = getFormValue(formData, "display_name");
	const email = getFormValue(formData, "email").trim();
	const password = getFormValue(formData, "password");

	const fieldErrors = validateSignUpInput({ displayName, email, password });
	if (hasFieldErrors(fieldErrors)) {
		return {
			status: "error",
			fieldErrors,
		};
	}

	const normalizedDisplayName = resolveDisplayName({ displayName, email });
	const supabase = createServerClient();

	let signUpResponse: Awaited<ReturnType<typeof supabase.auth.signUp>>;
	try {
		signUpResponse = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					display_name: normalizedDisplayName,
				},
			},
		});
	} catch {
		return {
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.serverError,
		};
	}

	if (signUpResponse.error) {
		return toSignUpErrorState({
			code: signUpResponse.error.code,
			message: signUpResponse.error.message,
		});
	}

	if (!signUpResponse.data.user || !signUpResponse.data.session) {
		return {
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.configMismatch,
		};
	}

	try {
		const { error: profileCreateError } = await asUsersProfileInsertClient(supabase)
			.from("users_profile")
			.insert({
				user_id: signUpResponse.data.user.id,
				display_name: normalizedDisplayName,
				timezone: "Asia/Tokyo",
			});

		if (profileCreateError) {
			return {
				status: "error",
				message: SIGN_UP_ERROR_MESSAGES.profileCreateFailed,
			};
		}
	} catch {
		return {
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.profileCreateFailed,
		};
	}

	redirect(SIGN_UP_REDIRECT_PATH);
}

export async function signIn(
	_prevState: AuthActionState,
	formData: FormData
): Promise<AuthActionState> {
	const email = getFormValue(formData, "email").trim();
	const password = getFormValue(formData, "password");
	const supabase = createServerClient();

	let signInResponse: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
	try {
		signInResponse = await supabase.auth.signInWithPassword({
			email,
			password,
		});
	} catch {
		return {
			status: "error",
			message: LOGIN_ERROR_MESSAGES.serverError,
		};
	}

	if (signInResponse.error) {
		return toSignInErrorState({
			code: signInResponse.error.code,
			message: signInResponse.error.message,
		});
	}

	let authenticatedUser = signInResponse.data.user;
	if (!authenticatedUser) {
		try {
			const getUserResponse = await supabase.auth.getUser();
			if (getUserResponse.error || !getUserResponse.data.user) {
				return {
					status: "error",
					message: LOGIN_ERROR_MESSAGES.serverError,
				};
			}

			authenticatedUser = getUserResponse.data.user;
		} catch {
			return {
				status: "error",
				message: LOGIN_ERROR_MESSAGES.serverError,
			};
		}
	}

	const rescueUser = toRescueUser({
		id: authenticatedUser.id,
		email: authenticatedUser.email ?? null,
		userMetadata: authenticatedUser.user_metadata ?? null,
	});

	if (!rescueUser) {
		return {
			status: "error",
			message: LOGIN_ERROR_MESSAGES.serverError,
		};
	}

	try {
		await ensureUserProfile({
			supabase: asEnsureUserProfileClient(supabase),
			user: rescueUser,
		});
	} catch {
		return {
			status: "error",
			message: LOGIN_ERROR_MESSAGES.serverError,
		};
	}

	redirect(SIGN_IN_REDIRECT_PATH);
}

export async function signOut(): Promise<void> {
	const supabase = createServerClient();
	const { error } = await supabase.auth.signOut();

	if (error) {
		throw error;
	}

	redirect(SIGN_OUT_REDIRECT_PATH);
}
