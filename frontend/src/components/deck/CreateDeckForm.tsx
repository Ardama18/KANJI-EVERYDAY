"use client";

import { DECK_ACTION_INITIAL_STATE, MAX_DECK_NAME_LENGTH } from "@/actions/deck-action-types";
import { createDeck } from "@/actions/deck-actions";
import { useFormState, useFormStatus } from "react-dom";

function CreateDeckSubmitButton() {
	const { pending } = useFormStatus();

	return (
		<button
			type="submit"
			disabled={pending}
			aria-disabled={pending}
			className="h-12 rounded-md bg-sky-600 px-5 text-base font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
		>
			{pending ? "作成中..." : "デッキを作成"}
		</button>
	);
}

export function CreateDeckForm() {
	const [state, formAction] = useFormState(createDeck, DECK_ACTION_INITIAL_STATE);
	const isError = state.status === "error";
	const isSuccess = state.status === "success" && state.deck !== undefined;

	return (
		<form
			action={formAction}
			noValidate
			className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
		>
			<div className="flex flex-col gap-1.5">
				<label htmlFor="deck-name" className="text-sm font-medium text-slate-700">
					新しいデッキ名
				</label>
				<div className="flex flex-col gap-2 sm:flex-row">
					<input
						id="deck-name"
						name="name"
						type="text"
						required
						maxLength={MAX_DECK_NAME_LENGTH}
						autoComplete="off"
						className="h-12 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-base text-slate-900 placeholder:text-slate-400"
						placeholder="例: 小学3年生の漢字"
					/>
					<CreateDeckSubmitButton />
				</div>
			</div>
			{isError ? (
				<p role="alert" className="text-sm font-medium text-rose-700">
					{state.message}
				</p>
			) : null}
			{isSuccess ? (
				<p className="text-sm font-medium text-emerald-700">
					「{state.deck.name}」を作成しました。
				</p>
			) : null}
		</form>
	);
}
