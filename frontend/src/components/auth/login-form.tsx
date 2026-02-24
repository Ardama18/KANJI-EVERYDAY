"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { signIn } from "@/actions/auth-actions";
import { AUTH_ACTION_INITIAL_STATE } from "@/actions/auth-types";

import { AuthErrorBanner } from "./auth-error-banner";
import { SubmitButton } from "./submit-button";

export function LoginForm() {
	const [state, formAction] = useFormState(signIn, AUTH_ACTION_INITIAL_STATE);

	return (
		<form action={formAction} noValidate className="flex w-full max-w-[28rem] flex-col gap-4">
			<AuthErrorBanner message={state.message} />

			<div className="flex flex-col gap-1.5">
				<label htmlFor="email" className="text-sm font-medium text-slate-700">
					メールアドレス
				</label>
				<input
					id="email"
					name="email"
					type="email"
					autoComplete="email"
					required
					className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="password" className="text-sm font-medium text-slate-700">
					パスワード
				</label>
				<input
					id="password"
					name="password"
					type="password"
					autoComplete="current-password"
					required
					className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
				/>
			</div>

			<SubmitButton idleLabel="ログイン" pendingLabel="ログイン中..." />

			<p className="text-sm text-slate-600">
				アカウントをお持ちでない方は{" "}
				<Link href="/signup" className="font-semibold text-sky-700 underline underline-offset-2">
					アカウントを作成する
				</Link>
			</p>
		</form>
	);
}
