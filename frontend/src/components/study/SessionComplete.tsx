"use client";

import type { StudySummary } from "@/actions/session-actions";
import Link from "next/link";

type SessionCompleteProps = {
	deckName: string;
	summary: StudySummary;
};

export function SessionComplete({ deckName, summary }: SessionCompleteProps) {
	return (
		<div className="flex min-h-[calc(100dvh-2rem)] flex-col items-center justify-center text-center">
			<p className="text-sm font-medium text-slate-500">{deckName}</p>
			<h1 className="mt-2 text-3xl font-bold text-slate-900">{summary.message}</h1>
			<p className="mt-4 text-base text-slate-700">
				学習したカード数: {summary.studiedUniqueCards}
			</p>

			<Link
				href="/decks"
				className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-blue-600 px-6 text-base font-semibold text-white transition hover:bg-blue-700"
			>
				デッキ一覧にもどる
			</Link>
		</div>
	);
}
