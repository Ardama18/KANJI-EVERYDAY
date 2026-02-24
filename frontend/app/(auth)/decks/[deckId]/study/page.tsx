import Link from "next/link";

export const STUDY_PLACEHOLDER_TITLE = "学習セッション準備中";
export const STUDY_PLACEHOLDER_MESSAGE =
	"この画面の実装は S-07（study-session-flow）で有効化されます。";

type StudyPlaceholderPageProps = {
	params: {
		deckId: string;
	};
};

export default function StudyPlaceholderPage({ params }: StudyPlaceholderPageProps) {
	return (
		<main className="mx-auto w-full max-w-lg px-4 py-8">
			<h1 className="text-2xl font-bold text-slate-900">{STUDY_PLACEHOLDER_TITLE}</h1>
			<p className="mt-3 text-sm text-slate-600">{STUDY_PLACEHOLDER_MESSAGE}</p>
			<p className="mt-2 text-sm text-slate-500">対象デッキID: {params.deckId}</p>
			<Link
				href={`/decks/${params.deckId}`}
				className="mt-6 inline-flex text-sm font-medium text-blue-600 hover:text-blue-800"
			>
				← デッキ概要へ戻る
			</Link>
		</main>
	);
}
