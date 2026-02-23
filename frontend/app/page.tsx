export const ROOT_PAGE_TITLE = "KANJI-EVERYDAY";
export const ROOT_PAGE_NOTICE = "導線案内（将来実装予定）";

export const ROOT_NAV_LINKS = [
	{ href: "/login", label: "/login へ進む" },
	{ href: "/decks", label: "/decks へ進む" },
] as const;

export default function HomePage() {
	return (
		<main className="app-page">
			<h1>{ROOT_PAGE_TITLE}</h1>
			<p>{ROOT_PAGE_NOTICE}</p>
			<nav aria-label="navigation">
				<ul>
					{ROOT_NAV_LINKS.map((link) => (
						<li key={link.href}>
							<a href={link.href} className="app-link">
								{link.label}
							</a>
						</li>
					))}
				</ul>
			</nav>
		</main>
	);
}
