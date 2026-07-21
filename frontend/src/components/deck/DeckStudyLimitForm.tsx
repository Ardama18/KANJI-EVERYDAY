"use client";

import { DECK_STUDY_LIMIT_ACTION_INITIAL_STATE } from "@/actions/deck-action-types";
import { updateDeckStudyLimit } from "@/actions/deck-actions";
import { useFormState, useFormStatus } from "react-dom";

type DeckStudyLimitFormProps = {
	deckId: string;
	dailyStudyLimit: number;
	newLimitPerDay: number;
};

function DeckStudyLimitSubmitButton() {
	const { pending } = useFormStatus();

	return (
		<button
			type="submit"
			disabled={pending}
			aria-disabled={pending}
			className="h-12 rounded-md bg-sky-600 px-5 text-base font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
		>
			{pending ? "保存中..." : "保存"}
		</button>
	);
}

export function DeckStudyLimitForm({
	deckId,
	dailyStudyLimit,
	newLimitPerDay,
}: DeckStudyLimitFormProps) {
	const [state, formAction] = useFormState(
		updateDeckStudyLimit,
		DECK_STUDY_LIMIT_ACTION_INITIAL_STATE
	);
	const isError = state.status === "error";
	const isSuccess = state.status === "success";

	return (
		<form action={formAction} noValidate className="mt-3 flex flex-col gap-3">
			<input type="hidden" name="deckId" value={deckId} />
			<div className="flex flex-col gap-1.5">
				<label htmlFor="daily-study-limit" className="text-sm font-medium text-slate-700">
					一日最大枚数
				</label>
				<div className="flex flex-col gap-2 sm:flex-row">
					<input
						id="daily-study-limit"
						name="dailyStudyLimit"
						type="number"
						required
						min={1}
						max={100}
						step={1}
						defaultValue={dailyStudyLimit}
						className="h-12 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-base text-slate-900"
					/>
					<DeckStudyLimitSubmitButton />
				</div>
			</div>
			<p className="text-sm text-slate-600">新規カード上限: {newLimitPerDay}枚</p>
			{isError ? (
				<p role="alert" className="text-sm font-medium text-rose-700">
					{state.message}
				</p>
			) : null}
			{isSuccess ? <p className="text-sm font-medium text-emerald-700">{state.message}</p> : null}
		</form>
	);
}
