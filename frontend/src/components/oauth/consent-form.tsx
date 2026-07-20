"use client";

import { useFormState, useFormStatus } from "react-dom";

import { OAUTH_ACTION_INITIAL_STATE, type OAuthActionState } from "@/actions/oauth-action-types";
import { decideOAuthConsent } from "@/actions/oauth-actions";

function DecisionButton({
	decision,
	label,
}: Readonly<{ decision: "approve" | "deny"; label: string }>) {
	const { pending } = useFormStatus();
	return (
		<button
			type="submit"
			name="decision"
			value={decision}
			disabled={pending}
			className={
				decision === "approve"
					? "min-h-12 rounded-lg bg-sky-700 px-5 py-3 text-base font-semibold text-white hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:bg-slate-400"
					: "min-h-12 rounded-lg border border-slate-400 bg-white px-5 py-3 text-base font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:bg-slate-100"
			}
		>
			{pending ? "処理中..." : label}
		</button>
	);
}

export function OAuthConsentForm(props: Readonly<{ authorizationId: string; clientName: string }>) {
	const [state, formAction] = useFormState<OAuthActionState, FormData>(
		decideOAuthConsent,
		OAUTH_ACTION_INITIAL_STATE
	);
	return (
		<form action={formAction} className="mt-6 flex flex-col gap-5">
			<input type="hidden" name="authorization_id" value={props.authorizationId} />
			{state.status === "error" && state.message ? (
				<p
					role="alert"
					className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
				>
					{state.message}
				</p>
			) : null}
			<div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
				<DecisionButton decision="approve" label="許可する" />
				<DecisionButton decision="deny" label="拒否する" />
			</div>
		</form>
	);
}
