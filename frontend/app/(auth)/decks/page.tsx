import { getDecksWithCounts } from "@/actions/deck-actions";
import { DeckCard } from "@/components/deck/DeckCard";

export const DECKS_PAGE_TITLE = "デッキ一覧";
export const DECKS_EMPTY_MESSAGE = "デッキがまだありません";
// Compatibility token kept for S-01 scaffold regression tests.
export const DECKS_STUB_MESSAGE = "デッキ一覧実装予定";

export default async function DecksPage() {
	const decks = await getDecksWithCounts();

	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-6">
			<h1 className="text-2xl font-bold text-slate-900">{DECKS_PAGE_TITLE}</h1>
			{decks.length === 0 ? (
				<p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-600">
					{DECKS_EMPTY_MESSAGE}
				</p>
			) : (
				<ul className="mt-4 flex flex-col gap-3">
					{decks.map((deck) => (
						<li key={deck.id}>
							<DeckCard deck={deck} />
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
