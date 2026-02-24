export const DECKS_STUB_TITLE = "デッキ";
export const DECKS_STUB_MESSAGE = "デッキ一覧実装予定";

export default function DecksPage() {
	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-10">
			<h1 className="text-2xl font-bold text-slate-900">{DECKS_STUB_TITLE}</h1>
			<p className="mt-2 text-slate-600">{DECKS_STUB_MESSAGE}</p>
		</main>
	);
}
