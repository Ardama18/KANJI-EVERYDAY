"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
	idleLabel: string;
	pendingLabel?: string;
};

export function SubmitButton({ idleLabel, pendingLabel = "送信中..." }: SubmitButtonProps) {
	const { pending } = useFormStatus();

	return (
		<button
			type="submit"
			disabled={pending}
			aria-disabled={pending}
			className="h-12 w-full rounded-md bg-sky-600 px-4 text-base font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
		>
			{pending ? pendingLabel : idleLabel}
		</button>
	);
}
