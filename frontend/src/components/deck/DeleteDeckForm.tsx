"use client";

import { DECK_DELETE_ACTION_INITIAL_STATE } from "@/actions/deck-action-types";
import { deleteDeck } from "@/actions/deck-actions";
import { useEffect, useId, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

type DeleteDeckFormProps = {
	deckId: string;
	deckName: string;
};

function DeleteDeckDialogButtons({
	canSubmit,
	isSubmitting,
	onCancel,
}: {
	canSubmit: boolean;
	isSubmitting: boolean;
	onCancel: () => void;
}) {
	const { pending } = useFormStatus();
	const isDeleteInFlight = pending || isSubmitting;
	const submitDisabled = isDeleteInFlight || !canSubmit;

	return (
		<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button
				type="button"
				onClick={onCancel}
				disabled={isDeleteInFlight}
				aria-disabled={isDeleteInFlight}
				className="h-12 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
			>
				キャンセル
			</button>
			<button
				type="submit"
				disabled={submitDisabled}
				aria-disabled={submitDisabled}
				className="h-12 rounded-md border border-rose-700 bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
			>
				{isDeleteInFlight ? "削除中..." : "削除を実行"}
			</button>
		</div>
	);
}

export function DeleteDeckForm({ deckId, deckName }: DeleteDeckFormProps) {
	const [state, formAction] = useFormState(deleteDeck, DECK_DELETE_ACTION_INITIAL_STATE);
	const [isOpen, setIsOpen] = useState(false);
	const [confirmationName, setConfirmationName] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const dialogId = useId();
	const titleId = `${dialogId}-title`;
	const descriptionId = `${dialogId}-description`;
	const isError = state.status === "error";
	const isConfirmationMatched = confirmationName.trim() === deckName;

	useEffect(() => {
		if (isError) {
			setIsSubmitting(false);
		}
	}, [isError]);

	const openDialog = () => {
		if (isSubmitting) {
			return;
		}
		setIsOpen(true);
		window.setTimeout(() => inputRef.current?.focus(), 0);
	};

	const closeDialog = () => {
		if (isSubmitting) {
			return;
		}
		setIsOpen(false);
		setConfirmationName("");
	};

	return (
		<div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
			<button
				type="button"
				aria-label={`「${deckName}」を削除`}
				onClick={openDialog}
				disabled={isSubmitting}
				aria-disabled={isSubmitting}
				className="h-12 w-full rounded-md border border-rose-200 px-4 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 sm:w-auto"
			>
				削除
			</button>
			{isOpen ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							closeDialog();
						}
					}}
				>
					<dialog
						open
						aria-modal="true"
						aria-labelledby={titleId}
						aria-describedby={descriptionId}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								closeDialog();
							}
						}}
						className="m-0 flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-lg bg-white p-0 shadow-xl backdrop:bg-transparent"
					>
						<form
							action={formAction}
							noValidate
							className="flex flex-col gap-4 p-5"
							onSubmit={(event) => {
								if (!isConfirmationMatched) {
									event.preventDefault();
									return;
								}
								setIsSubmitting(true);
							}}
						>
							<input type="hidden" name="deckId" value={deckId} />
							<div className="space-y-2">
								<h2 id={titleId} className="text-lg font-bold text-slate-950">
									デッキを削除
								</h2>
								<p id={descriptionId} className="text-sm leading-6 text-slate-700">
									{"「"}
									{deckName}
									{
										"」を削除します。この操作は元に戻せません。カード、復習状態、学習履歴の行は保持されますが、通常の学習対象から外れます。"
									}
								</p>
							</div>
							<label className="flex flex-col gap-2 text-sm font-semibold text-slate-800">
								確認のためデッキ名を入力
								<input
									ref={inputRef}
									name="confirmationName"
									value={confirmationName}
									onChange={(event) => setConfirmationName(event.target.value)}
									autoComplete="off"
									className="min-h-12 rounded-md border border-slate-300 px-3 text-base font-normal text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
								/>
							</label>
							{isError ? (
								<p role="alert" className="text-sm font-medium text-rose-700">
									{state.message}
								</p>
							) : null}
							<DeleteDeckDialogButtons
								canSubmit={isConfirmationMatched}
								isSubmitting={isSubmitting}
								onCancel={closeDialog}
							/>
						</form>
					</dialog>
				</div>
			) : null}
		</div>
	);
}
