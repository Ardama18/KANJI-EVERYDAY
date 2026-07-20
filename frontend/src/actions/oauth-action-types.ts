export type OAuthActionState = Readonly<{ status: "idle" | "error"; message?: string }>;

export const OAUTH_ACTION_INITIAL_STATE: OAuthActionState = Object.freeze({ status: "idle" });
