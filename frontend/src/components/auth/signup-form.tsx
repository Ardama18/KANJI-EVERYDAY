"use client";

import Link from "next/link";
import { useFormState } from "react-dom";

import { signUp } from "@/actions/auth-actions";
import { AUTH_ACTION_INITIAL_STATE } from "@/actions/auth-types";

import { AuthErrorBanner } from "./auth-error-banner";
import { SubmitButton } from "./submit-button";

export function SignupForm() {
	const [state, formAction] = useFormState(signUp, AUTH_ACTION_INITIAL_STATE);

	const displayNameError = state.fieldErrors?.displayName;
	const emailError = state.fieldErrors?.email;
	const passwordError = state.fieldErrors?.password;

	return (
		<form action={formAction} noValidate className="flex w-full max-w-[28rem] flex-col gap-4">
			<AuthErrorBanner message={state.message} />

			<div className="flex flex-col gap-1.5">
				<label htmlFor="display_name" className="text-sm font-medium text-slate-700">
					表示名
				</label>
				<input
					id="display_name"
					name="display_name"
					type="text"
					autoComplete="nickname"
					required
					aria-invalid={Boolean(displayNameError)}
					aria-describedby={displayNameError ? "signup-display-name-error" : undefined}
					className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
				/>
				{displayNameError ? (
					<p id="signup-display-name-error" role="alert" className="text-sm text-rose-700">
						{displayNameError}
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="signup-email" className="text-sm font-medium text-slate-700">
					メールアドレス
				</label>
				<input
					id="signup-email"
					name="email"
					type="email"
					autoComplete="email"
					required
					aria-invalid={Boolean(emailError)}
					aria-describedby={emailError ? "signup-email-error" : undefined}
					className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
				/>
				{emailError ? (
					<p id="signup-email-error" role="alert" className="text-sm text-rose-700">
						{emailError}
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="signup-password" className="text-sm font-medium text-slate-700">
					パスワード
				</label>
				<input
					id="signup-password"
					name="password"
					type="password"
					autoComplete="new-password"
					required
					aria-invalid={Boolean(passwordError)}
					aria-describedby={passwordError ? "signup-password-error" : undefined}
					className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
				/>
				{passwordError ? (
					<p id="signup-password-error" role="alert" className="text-sm text-rose-700">
						{passwordError}
					</p>
				) : null}
			</div>

			<SubmitButton idleLabel="アカウントを作成" pendingLabel="作成中..." />

			<p className="text-sm text-slate-600">
				すでにアカウントをお持ちの方は{" "}
				<Link href="/login" className="font-semibold text-sky-700 underline underline-offset-2">
					ログインはこちら
				</Link>
			</p>
		</form>
	);
}
