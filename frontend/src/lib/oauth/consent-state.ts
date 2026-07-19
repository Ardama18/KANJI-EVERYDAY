export const CONSENT_STATE_COOKIE = "s14_oauth_consent_state";

/**
 * The browser stores only an opaque, HttpOnly nonce. The matching
 * authorization ID is retained in the S-14 private table and consumed once
 * after login; no process-local state or caller supplied return URL is used.
 */
export function createConsentLoginState(): string {
	return crypto.randomUUID();
}

export function isConsentLoginState(value: string | undefined): value is string {
	if (value === undefined) return false;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
