import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { CONSENT_STATE_COOKIE, isConsentLoginState } from "@/lib/oauth/consent-state";
import { isAuthorizationId } from "@/lib/oauth/server";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
	const cookieStore = cookies();
	const state = cookieStore.get(CONSENT_STATE_COOKIE)?.value;
	if (!isConsentLoginState(state)) return clearStateAndRedirect(request.url, "/oauth/consent");

	const supabase = createServerClient();
	try {
		const { data, error } = await supabase.auth.getUser();
		if (error !== null || data.user === null) {
			return clearStateAndRedirect(request.url, "/login?continuation=oauth-consent", false);
		}
	} catch {
		return clearStateAndRedirect(request.url, "/oauth/consent");
	}

	const { data, error } = await supabase.rpc("s14_consume_oauth_consent_state", {
		p_state_id: state,
	});
	if (error !== null || !isAuthorizationId(data)) {
		return clearStateAndRedirect(request.url, "/oauth/consent");
	}
	const target = new URL("/oauth/consent", request.url);
	target.searchParams.set("authorization_id", data);
	const response = NextResponse.redirect(target);
	response.cookies.delete(CONSENT_STATE_COOKIE);
	return response;
}

function clearStateAndRedirect(requestUrl: string, pathname: string, clear = true): Response {
	const response = NextResponse.redirect(new URL(pathname, requestUrl));
	if (clear) response.cookies.delete(CONSENT_STATE_COOKIE);
	return response;
}
