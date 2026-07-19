import { NextResponse } from "next/server";

import { CONSENT_STATE_COOKIE, createConsentLoginState } from "@/lib/oauth/consent-state";
import { isAuthorizationId } from "@/lib/oauth/server";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const authorizationId = url.searchParams.get("authorization_id");
	if (!isAuthorizationId(authorizationId)) return consentStartError();

	const supabase = createServerClient();
	try {
		const { data, error } = await supabase.auth.getUser();
		if (error === null && data.user !== null) {
			return NextResponse.redirect(consentUrl(request.url, authorizationId));
		}
	} catch {
		return consentStartError();
	}

	const state = createConsentLoginState();
	const { error } = await supabase.rpc("s14_create_oauth_consent_state", {
		p_state_id: state,
		p_authorization_id: authorizationId,
	});
	if (error !== null) return consentStartError();

	const response = NextResponse.redirect(new URL("/login?continuation=oauth-consent", request.url));
	response.cookies.set({
		name: CONSENT_STATE_COOKIE,
		value: state,
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 300,
	});
	return response;
}

function consentUrl(requestUrl: string, authorizationId: string): URL {
	const url = new URL("/oauth/consent", requestUrl);
	url.searchParams.set("authorization_id", authorizationId);
	return url;
}

function consentStartError(): Response {
	return Response.json(
		{ error: "invalid_consent_request" },
		{ status: 400, headers: { "Cache-Control": "no-store" } }
	);
}
