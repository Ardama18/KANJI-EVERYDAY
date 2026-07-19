"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import {
	OAUTH_ACTION_INITIAL_STATE,
	type OAuthActionState,
	revokeOAuthConnection,
} from "@/actions/oauth-actions";

export interface OAuthConnectionView {
	readonly clientId: string;
	readonly clientName: string;
	readonly grantedAt: string;
}

function RevokeButton({ clientName }: Readonly<{ clientName: string }>) {
	const { pending } = useFormStatus();
	return (
		<button
			type="submit"
			disabled={pending}
			className="min-h-12 rounded-lg border border-rose-300 bg-white px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:bg-slate-100"
		>
			{pending ? "解除中..." : `「${clientName}」との連携を解除する`}
		</button>
	);
}

function ConnectionRow({ connection }: Readonly<{ connection: OAuthConnectionView }>) {
	const [confirming, setConfirming] = useState(false);
	const [state, formAction] = useFormState<OAuthActionState, FormData>(
		revokeOAuthConnection,
		OAUTH_ACTION_INITIAL_STATE
	);
	return (
		<li className="rounded-lg border border-slate-200 p-4">
			<p className="break-words font-semibold text-slate-900">{connection.clientName}</p>
			<p className="mt-1 text-sm text-slate-600">
				許可日:{" "}
				{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
					new Date(connection.grantedAt)
				)}
			</p>
			{confirming ? (
				<form action={formAction} className="mt-4 flex flex-col gap-3">
					<input type="hidden" name="client_id" value={connection.clientId} />
					<p className="text-sm text-slate-700">この外部AIは直ちにカード操作できなくなります。</p>
					{state.status === "error" && state.message ? (
						<p role="alert" className="text-sm text-rose-700">
							{state.message}
						</p>
					) : null}
					<div className="flex flex-wrap gap-3">
						<RevokeButton clientName={connection.clientName} />
						<button
							type="button"
							onClick={() => setConfirming(false)}
							className="min-h-12 rounded-lg px-4 py-3 text-sm font-semibold text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
						>
							キャンセル
						</button>
					</div>
				</form>
			) : (
				<button
					type="button"
					onClick={() => setConfirming(true)}
					className="mt-4 min-h-12 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
				>
					連携解除へ進む
				</button>
			)}
		</li>
	);
}

export function OAuthConnectionsClient(
	props: Readonly<{ connections: readonly OAuthConnectionView[] }>
) {
	if (props.connections.length === 0) {
		return (
			<p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-700">
				連携中の外部AIはありません。
			</p>
		);
	}
	return (
		<ul className="mt-5 grid gap-3" aria-label="外部AIとの連携一覧">
			{props.connections.map((connection) => (
				<ConnectionRow key={connection.clientId} connection={connection} />
			))}
		</ul>
	);
}
