import { getDeckOverview } from "@/actions/deck-actions";
import { isAiCardImportEnabled } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";

import AiCardImportClient from "./AiCardImportClient";

interface AiCardNewPageProps {
	readonly params: { readonly deckId: string };
}

export default async function AiCardNewPage({ params }: AiCardNewPageProps) {
	if (!isAiCardImportEnabled()) notFound();
	const deck = await getDeckOverview(params.deckId);
	if (deck === null) notFound();
	return (
		<main className="mx-auto w-full max-w-lg px-4 py-6">
			<Link
				href={`/decks/${deck.id}`}
				className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 hover:text-slate-900"
			>
				← デッキへ戻る
			</Link>
			<h1 className="mt-3 text-2xl font-bold text-slate-900">AIでカードを作る</h1>
			<p className="mt-1 break-words text-sm text-slate-600">対象デッキ: {deck.name}</p>
			<AiCardImportClient deckId={deck.id} />
		</main>
	);
}
