"use client";

import { DECK_DELETE_ACTION_INITIAL_STATE } from "@/actions/deck-action-types";
import { deleteDeck } from "@/actions/deck-actions";
import { useFormState, useFormStatus } from "react-dom";

type DeleteDeckFormProps = {
	deckId: string;
	deckName: string;
};

function DeleteDeckSubmitButton({ deckName }: { deckName: string }) {
	const { pending } = useFormStatus();

	return (
		<button
			type="submit"
			aria-label={`「${deckName}」を削除`}
			disabled={pending}
			aria-disabled={pending}
			className="h-12 w-full rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 sm:w-auto"
		>
			{pending ? "削除中..." : "削除"}
		</button>
	);
}

export function DeleteDeckForm({ deckId, deckName }: DeleteDeckFormProps) {
	const [state, formAction] = useFormState(deleteDeck, DECK_DELETE_ACTION_INITIAL_STATE);
	const isError = state.status === "error";

	return (
		<form
			action={formAction}
			noValidate
			onSubmit={(event) => {
				if (!window.confirm(`「${deckName}」を削除しますか？`)) {
					event.preventDefault();
				}
			}}
			className="flex w-full flex-col gap-2 sm:w-auto sm:items-end"
		>
			<input type="hidden" name="deckId" value={deckId} />
			<DeleteDeckSubmitButton deckName={deckName} />
			{isError ? (
				<p role="alert" className="text-sm font-medium text-rose-700 sm:max-w-56 sm:text-right">
					{state.message}
				</p>
			) : null}
		</form>
	);
}
