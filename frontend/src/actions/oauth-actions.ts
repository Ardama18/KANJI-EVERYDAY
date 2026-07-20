"use server";

import { isMcpEnabled } from "@/lib/env";
import {
	type OAuthServerApi,
	getOAuthConnections,
	getOfficialRedirect,
	getVerifiedAuthorization,
	isAuthorizationId,
} from "@/lib/oauth/server";
import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { OAuthActionState } from "./oauth-action-types";

const CONSENT_ERROR = "連携の確認を完了できませんでした。最初からやり直してください。";
const REVOKE_ERROR = "連携の解除を完了できませんでした。画面を更新して再試行してください。";

export async function decideOAuthConsent(
	_previous: OAuthActionState,
	formData: FormData
): Promise<OAuthActionState> {
	const authorizationId = formValue(formData, "authorization_id");
	const decision = formValue(formData, "decision");
	if (!isAuthorizationId(authorizationId) || (decision !== "approve" && decision !== "deny")) {
		return { status: "error", message: CONSENT_ERROR };
	}
	if (decision === "approve" && !isMcpEnabled()) {
		return { status: "error", message: "現在この連携は利用できません。" };
	}

	const supabase = createServerClient();
	let userId: string | null = null;
	try {
		const { data, error } = await supabase.auth.getUser();
		userId = error === null ? (data.user?.id ?? null) : null;
	} catch {
		return { status: "error", message: CONSENT_ERROR };
	}
	if (userId === null) return { status: "error", message: CONSENT_ERROR };

	const oauth = supabase.auth.oauth as unknown as OAuthServerApi;
	let redirectUrl: string | null;
	try {
		const details = await getVerifiedAuthorization(oauth, userId, authorizationId);
		if (details === null || "redirectUrl" in details)
			return { status: "error", message: CONSENT_ERROR };

		const result =
			decision === "approve"
				? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
				: await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
		redirectUrl = await getOfficialRedirect(result);
		if (redirectUrl === null) return { status: "error", message: CONSENT_ERROR };
	} catch {
		return { status: "error", message: CONSENT_ERROR };
	}
	redirect(redirectUrl);
}

export async function revokeOAuthConnection(
	_previous: OAuthActionState,
	formData: FormData
): Promise<OAuthActionState> {
	const clientId = formValue(formData, "client_id");
	if (!isAuthorizationId(clientId)) return { status: "error", message: REVOKE_ERROR };
	const supabase = createServerClient();
	let userId: string | null = null;
	try {
		const { data, error } = await supabase.auth.getUser();
		userId = error === null ? (data.user?.id ?? null) : null;
	} catch {
		return { status: "error", message: REVOKE_ERROR };
	}
	if (userId === null) return { status: "error", message: REVOKE_ERROR };

	const oauth = supabase.auth.oauth as unknown as OAuthServerApi;
	const connections = await getOAuthConnections(oauth);
	if (connections === null || !connections.some((connection) => connection.clientId === clientId)) {
		return { status: "error", message: "連携先が見つかりません。画面を更新してください。" };
	}
	try {
		const result = await oauth.revokeGrant({ clientId });
		if (!isSuccessfulOAuthOperation(result)) return { status: "error", message: REVOKE_ERROR };
	} catch {
		return { status: "error", message: REVOKE_ERROR };
	}
	revalidatePath("/oauth/connections");
	return { status: "idle" };
}

function formValue(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
}

function isSuccessfulOAuthOperation(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		(value as Readonly<Record<string, unknown>>).error === null
	);
}
