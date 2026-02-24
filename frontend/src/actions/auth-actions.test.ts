import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());
const ensureUserProfileMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createServerClient: createServerClientMock,
}));

vi.mock("@/lib/auth/ensure-user-profile", () => ({
	ensureUserProfile: ensureUserProfileMock,
}));

vi.mock("next/navigation", () => ({
	redirect: redirectMock,
}));

import { signIn, signOut, signUp } from "./auth-actions";
import {
	AUTH_ACTION_INITIAL_STATE,
	AUTH_FIELD_MESSAGES,
	LOGIN_ERROR_MESSAGES,
	SIGN_UP_ERROR_MESSAGES,
} from "./auth-types";

type AuthUser = {
	id: string;
	email: string | null;
	user_metadata: {
		display_name?: string;
	} | null;
};

type SignUpPayload = {
	email: string;
	password: string;
	options: {
		data: {
			display_name: string;
		};
	};
};

type SignUpResult = {
	data: {
		user: { id: string } | null;
		session: { access_token: string } | null;
	};
	error: { code?: string; message: string } | null;
};

type SignInPayload = {
	email: string;
	password: string;
};

type SignInResult = {
	data: {
		user: AuthUser | null;
		session: { access_token: string } | null;
	};
	error: { code?: string; message: string } | null;
};

type GetUserResult = {
	data: {
		user: AuthUser | null;
	};
	error: { message: string } | null;
};

type SignOutResult = {
	error: { message: string } | null;
};

type ProfileInsertPayload = {
	user_id: string;
	display_name: string;
	timezone: "Asia/Tokyo";
};

type ProfileInsertResult = {
	error: { message: string } | null;
};

class RedirectSignal extends Error {
	constructor(public readonly location: string) {
		super("NEXT_REDIRECT");
	}
}

const createSignUpFormData = (input: {
	displayName: string;
	email: string;
	password: string;
}) => {
	const formData = new FormData();
	formData.set("display_name", input.displayName);
	formData.set("email", input.email);
	formData.set("password", input.password);
	return formData;
};

const createSignInFormData = (input: { email: string; password: string }) => {
	const formData = new FormData();
	formData.set("email", input.email);
	formData.set("password", input.password);
	return formData;
};

const successSignUpResult = (userId = "user-1"): SignUpResult => ({
	data: {
		user: { id: userId },
		session: { access_token: "session-token" },
	},
	error: null,
});

const successSignInResult = (userId = "user-1"): SignInResult => ({
	data: {
		user: {
			id: userId,
			email: "learner@example.com",
			user_metadata: {
				display_name: "学習者",
			},
		},
		session: { access_token: "session-token" },
	},
	error: null,
});

const successGetUserResult = (userId = "user-1"): GetUserResult => ({
	data: {
		user: {
			id: userId,
			email: "learner@example.com",
			user_metadata: {
				display_name: "学習者",
			},
		},
	},
	error: null,
});

const setupClient = (options?: {
	signUpResult?: SignUpResult;
	profileInsertResult?: ProfileInsertResult;
	signInResult?: SignInResult;
	getUserResult?: GetUserResult;
	signOutResult?: SignOutResult;
}) => {
	const signUpMock = vi
		.fn<(payload: SignUpPayload) => Promise<SignUpResult>>()
		.mockResolvedValue(options?.signUpResult ?? successSignUpResult());

	const signInWithPasswordMock = vi
		.fn<(payload: SignInPayload) => Promise<SignInResult>>()
		.mockResolvedValue(options?.signInResult ?? successSignInResult());

	const getUserMock = vi
		.fn<() => Promise<GetUserResult>>()
		.mockResolvedValue(options?.getUserResult ?? successGetUserResult());

	const signOutMock = vi
		.fn<() => Promise<SignOutResult>>()
		.mockResolvedValue(options?.signOutResult ?? { error: null });

	const insertMock = vi
		.fn<(payload: ProfileInsertPayload) => Promise<ProfileInsertResult>>()
		.mockResolvedValue(options?.profileInsertResult ?? { error: null });

	const fromMock = vi
		.fn<(table: string) => { insert: typeof insertMock }>()
		.mockImplementation(() => ({ insert: insertMock }));

	createServerClientMock.mockReturnValue({
		auth: {
			signUp: signUpMock,
			signInWithPassword: signInWithPasswordMock,
			getUser: getUserMock,
			signOut: signOutMock,
		},
		from: fromMock,
	});

	return { signUpMock, signInWithPasswordMock, getUserMock, signOutMock, insertMock, fromMock };
};

describe("frontend/src/actions/auth-actions.ts", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		ensureUserProfileMock.mockReset();
		ensureUserProfileMock.mockResolvedValue("created");
		redirectMock.mockReset();
		redirectMock.mockImplementation((location: string) => {
			throw new RedirectSignal(location);
		});
	});

	it("UT-AC01-SIGNUP-VALIDATION: display_name/email/password の入力検証エラーを返す", async () => {
		const formData = createSignUpFormData({
			displayName: " ",
			email: "invalid-email",
			password: "short",
		});

		const state = await signUp(AUTH_ACTION_INITIAL_STATE, formData);

		expect(state).toEqual({
			status: "error",
			fieldErrors: {
				displayName: AUTH_FIELD_MESSAGES.displayName,
				email: AUTH_FIELD_MESSAGES.email,
				password: AUTH_FIELD_MESSAGES.password,
			},
		});
		expect(createServerClientMock).not.toHaveBeenCalled();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC02-CONFIG-MISMATCH-HANDLING: session が無い signup 成功を構成不一致として扱う", async () => {
		const { fromMock } = setupClient({
			signUpResult: {
				data: {
					user: { id: "user-1" },
					session: null,
				},
				error: null,
			},
		});

		const state = await signUp(
			AUTH_ACTION_INITIAL_STATE,
			createSignUpFormData({
				displayName: "太郎",
				email: "taro@example.com",
				password: "password-123",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.configMismatch,
		});
		expect(fromMock).not.toHaveBeenCalled();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC03-SIGNUP-SESSION-REDIRECT: signup 成功時に /decks へ遷移する", async () => {
		setupClient();

		await expect(
			signUp(
				AUTH_ACTION_INITIAL_STATE,
				createSignUpFormData({
					displayName: "学習者",
					email: "learner@example.com",
					password: "password-123",
				})
			)
		).rejects.toMatchObject({
			location: "/decks",
		});

		expect(redirectMock).toHaveBeenCalledWith("/decks");
	});

	it("UT-AC04-PROFILE-CREATE-VALUES: signup 成功時に users_profile を display_name + timezone で作成する", async () => {
		const { signUpMock, fromMock, insertMock } = setupClient({
			signUpResult: successSignUpResult("user-42"),
		});

		await expect(
			signUp(
				AUTH_ACTION_INITIAL_STATE,
				createSignUpFormData({
					displayName: "  まいにち漢字の学習者です  ",
					email: "learner@example.com",
					password: "password-123",
				})
			)
		).rejects.toBeInstanceOf(RedirectSignal);

		expect(signUpMock).toHaveBeenCalledWith({
			email: "learner@example.com",
			password: "password-123",
			options: {
				data: {
					display_name: "まいにち漢字の学習者です",
				},
			},
		});
		expect(fromMock).toHaveBeenCalledWith("users_profile");
		expect(insertMock).toHaveBeenCalledWith({
			user_id: "user-42",
			display_name: "まいにち漢字の学習者です",
			timezone: "Asia/Tokyo",
		});
	});

	it("UT-AC05-PROFILE-FAIL-NO-REDIRECT: profile 作成失敗時は遷移せず専用文言を返す", async () => {
		const { insertMock } = setupClient({
			profileInsertResult: {
				error: { message: "insert failed" },
			},
		});

		const state = await signUp(
			AUTH_ACTION_INITIAL_STATE,
			createSignUpFormData({
				displayName: "学習者",
				email: "learner@example.com",
				password: "password-123",
			})
		);

		expect(insertMock).toHaveBeenCalledTimes(1);
		expect(state).toEqual({
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.profileCreateFailed,
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC06-DUPLICATE-EMAIL-MESSAGE: 重複メール時の既定文言を返す", async () => {
		setupClient({
			signUpResult: {
				data: { user: null, session: null },
				error: {
					code: "user_already_exists",
					message: "User already registered",
				},
			},
		});

		const state = await signUp(
			AUTH_ACTION_INITIAL_STATE,
			createSignUpFormData({
				displayName: "学習者",
				email: "duplicated@example.com",
				password: "password-123",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.duplicateEmail,
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC07-WEAK-PASSWORD-MESSAGE: パスワード要件不足時の既定文言を返す", async () => {
		setupClient({
			signUpResult: {
				data: { user: null, session: null },
				error: {
					code: "weak_password",
					message: "Password should be at least 8 characters.",
				},
			},
		});

		const state = await signUp(
			AUTH_ACTION_INITIAL_STATE,
			createSignUpFormData({
				displayName: "学習者",
				email: "learner@example.com",
				password: "12345678",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.weakPassword,
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC08-SIGNUP-SERVER-ERROR-MESSAGE: signup サーバーエラー時の既定文言を返す", async () => {
		setupClient({
			signUpResult: {
				data: { user: null, session: null },
				error: {
					code: "unexpected_error",
					message: "database timeout",
				},
			},
		});

		const state = await signUp(
			AUTH_ACTION_INITIAL_STATE,
			createSignUpFormData({
				displayName: "学習者",
				email: "learner@example.com",
				password: "password-123",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: SIGN_UP_ERROR_MESSAGES.serverError,
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC09-LOGIN-SUCCESS-REDIRECT: login 成功時に /decks へ遷移する", async () => {
		const { signInWithPasswordMock } = setupClient();

		await expect(
			signIn(
				AUTH_ACTION_INITIAL_STATE,
				createSignInFormData({
					email: "learner@example.com",
					password: "password-123",
				})
			)
		).rejects.toMatchObject({
			location: "/decks",
		});

		expect(signInWithPasswordMock).toHaveBeenCalledWith({
			email: "learner@example.com",
			password: "password-123",
		});
		expect(ensureUserProfileMock).toHaveBeenCalledTimes(1);
	});

	it("UT-AC10-INVALID-CREDENTIALS-MESSAGE: 認証失敗時は credentials 不一致文言を返す", async () => {
		setupClient({
			signInResult: {
				data: { user: null, session: null },
				error: {
					code: "invalid_credentials",
					message: "Invalid login credentials",
				},
			},
		});

		const state = await signIn(
			AUTH_ACTION_INITIAL_STATE,
			createSignInFormData({
				email: "learner@example.com",
				password: "wrong-password",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: LOGIN_ERROR_MESSAGES.invalidCredentials,
		});
		expect(ensureUserProfileMock).not.toHaveBeenCalled();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC11-LOGIN-SERVER-ERROR-MESSAGE: login サーバーエラー時は再試行文言を返す", async () => {
		setupClient({
			signInResult: {
				data: { user: null, session: null },
				error: {
					code: "unexpected_error",
					message: "database timeout",
				},
			},
		});

		const state = await signIn(
			AUTH_ACTION_INITIAL_STATE,
			createSignInFormData({
				email: "learner@example.com",
				password: "password-123",
			})
		);

		expect(state).toEqual({
			status: "error",
			message: LOGIN_ERROR_MESSAGES.serverError,
		});
		expect(ensureUserProfileMock).not.toHaveBeenCalled();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("UT-AC13-PROFILE-RESCUE-ON-LOGIN: login 成功時に rescue を呼び出してから遷移する", async () => {
		setupClient({
			signInResult: successSignInResult("user-42"),
		});

		await expect(
			signIn(
				AUTH_ACTION_INITIAL_STATE,
				createSignInFormData({
					email: "learner@example.com",
					password: "password-123",
				})
			)
		).rejects.toBeInstanceOf(RedirectSignal);

		expect(ensureUserProfileMock).toHaveBeenCalledWith({
			supabase: expect.any(Object),
			user: {
				id: "user-42",
				email: "learner@example.com",
				user_metadata: {
					display_name: "学習者",
				},
			},
		});
		expect(redirectMock).toHaveBeenCalledWith("/decks");
	});

	it("UT-AC14-RESCUE-IDEMPOTENCY: rescue が already_exists を返しても成功遷移する", async () => {
		setupClient();
		ensureUserProfileMock.mockResolvedValue("already_exists");

		await expect(
			signIn(
				AUTH_ACTION_INITIAL_STATE,
				createSignInFormData({
					email: "learner@example.com",
					password: "password-123",
				})
			)
		).rejects.toBeInstanceOf(RedirectSignal);

		expect(ensureUserProfileMock).toHaveBeenCalledTimes(1);
		expect(redirectMock).toHaveBeenCalledWith("/decks");
	});

	it("UT-AC19-SIGNOUT-REDIRECT: signOut 実行後に /login へ遷移する", async () => {
		const { signOutMock } = setupClient();

		await expect(signOut()).rejects.toMatchObject({
			location: "/login",
		});

		expect(signOutMock).toHaveBeenCalledTimes(1);
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("UT-AC20-SERVER-ACTIONS-FORM-BINDING: signUp/signIn/signOut が Server Action として宣言されている", () => {
		const source = readFileSync(new URL("./auth-actions.ts", import.meta.url), "utf8");

		expect(source).toContain('"use server"');
		expect(source).toContain("export async function signUp");
		expect(source).toContain("export async function signIn");
		expect(source).toContain("export async function signOut");
		expect(source).toContain("formData: FormData");
	});
});
