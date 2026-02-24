export type AuthActionStatus = "idle" | "error";

export type AuthFieldErrors = {
	displayName?: string;
	email?: string;
	password?: string;
};

export type AuthActionState = {
	status: AuthActionStatus;
	message?: string;
	fieldErrors?: AuthFieldErrors;
};

export const AUTH_ACTION_INITIAL_STATE: AuthActionState = {
	status: "idle",
};

export const AUTH_FIELD_MESSAGES = {
	displayName: "表示名は1文字以上20文字以下で入力してください",
	email: "メールアドレスの形式が正しくありません",
	password: "パスワードは8文字以上で入力してください",
} as const;

export const SIGN_UP_ERROR_CODES = {
	duplicateEmail: "duplicate_email",
	weakPassword: "weak_password",
	serverError: "server_error",
	profileCreateFailed: "profile_create_failed",
	configMismatch: "config_mismatch",
} as const;

export type SignUpErrorCode = (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];

export const SIGN_UP_ERROR_MESSAGES = {
	duplicateEmail: "このメールアドレスは既に登録されています",
	weakPassword: "パスワードは8文字以上で入力してください",
	serverError: "アカウントの作成に失敗しました。もう一度お試しください",
	profileCreateFailed:
		"アカウントは作成されましたが初期設定に失敗しました。ログインして再試行してください",
	configMismatch: "環境設定を確認してください。時間をおいて再試行してください",
} as const;

export const SIGN_UP_ERROR_MESSAGES_BY_CODE: Record<SignUpErrorCode, string> = {
	[SIGN_UP_ERROR_CODES.duplicateEmail]: SIGN_UP_ERROR_MESSAGES.duplicateEmail,
	[SIGN_UP_ERROR_CODES.weakPassword]: SIGN_UP_ERROR_MESSAGES.weakPassword,
	[SIGN_UP_ERROR_CODES.serverError]: SIGN_UP_ERROR_MESSAGES.serverError,
	[SIGN_UP_ERROR_CODES.profileCreateFailed]: SIGN_UP_ERROR_MESSAGES.profileCreateFailed,
	[SIGN_UP_ERROR_CODES.configMismatch]: SIGN_UP_ERROR_MESSAGES.configMismatch,
};

export const LOGIN_ERROR_CODES = {
	invalidCredentials: "invalid_credentials",
	serverError: "server_error",
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[keyof typeof LOGIN_ERROR_CODES];

export const LOGIN_ERROR_MESSAGES = {
	invalidCredentials: "メールアドレスまたはパスワードが正しくありません",
	serverError: "ログインに失敗しました。もう一度お試しください",
} as const;

export const LOGIN_ERROR_MESSAGES_BY_CODE: Record<LoginErrorCode, string> = {
	[LOGIN_ERROR_CODES.invalidCredentials]: LOGIN_ERROR_MESSAGES.invalidCredentials,
	[LOGIN_ERROR_CODES.serverError]: LOGIN_ERROR_MESSAGES.serverError,
};
