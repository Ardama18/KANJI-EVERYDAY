import { createReadOnlyServerClient } from "@/lib/supabase/server";

export const ROOT_PAGE_TITLE = "まいにち漢字";
export const ROOT_PAGE_DESCRIPTION = "毎日少しずつ、漢字の読み書きを復習しよう。";

export const ROOT_GUEST_NAV_LINKS = [
	{ href: "/login", label: "ログイン", variant: "primary" },
	{ href: "/signup", label: "新規登録", variant: "secondary" },
] as const;

export const ROOT_AUTHENTICATED_NAV_LINK = {
	href: "/decks",
	label: "今日の学習をはじめる",
	variant: "primary",
} as const;

async function getCurrentUser() {
	const supabase = createReadOnlyServerClient();

	try {
		const result = await supabase.auth.getUser();
		return result.error === null ? result.data.user : null;
	} catch {
		return null;
	}
}

export default async function HomePage() {
	const user = await getCurrentUser();
	const links = user === null ? ROOT_GUEST_NAV_LINKS : [ROOT_AUTHENTICATED_NAV_LINK];

	return (
		<main className="app-page flex min-h-screen items-center">
			<section
				aria-labelledby="root-page-title"
				className="w-full rounded-lg border border-slate-200 bg-white px-5 py-8 shadow-sm"
			>
				<h1 id="root-page-title" className="text-3xl font-bold tracking-normal text-slate-950">
					{ROOT_PAGE_TITLE}
				</h1>
				<p className="mt-3 text-base leading-7 text-slate-700">{ROOT_PAGE_DESCRIPTION}</p>
				<nav aria-label="次の操作" className="mt-6">
					<ul className="m-0 grid gap-3 sm:grid-cols-2">
						{links.map((link) => (
							<li key={link.href}>
								<a
									href={link.href}
									className={[
										"flex min-h-12 items-center justify-center rounded-lg border px-4 py-3 text-center text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
										link.variant === "primary"
											? "border-blue-700 bg-blue-700 text-white hover:bg-blue-800"
											: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
									].join(" ")}
								>
									{link.label}
								</a>
							</li>
						))}
					</ul>
				</nav>
			</section>
		</main>
	);
}
