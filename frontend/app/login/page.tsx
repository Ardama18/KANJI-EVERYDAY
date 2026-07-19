import { LoginForm } from "@/components/auth/login-form";

export const LOGIN_PAGE_TITLE = "ログイン";
export const LOGIN_PAGE_DESCRIPTION = "メールアドレスとパスワードでログインできます";

type LoginPageProps = Readonly<{ searchParams?: Readonly<{ continuation?: string | string[] }> }>;

export default function LoginPage({ searchParams }: LoginPageProps) {
	const continuation = searchParams?.continuation === "oauth-consent" ? "oauth-consent" : undefined;
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-[28rem] flex-col justify-center px-4 py-8">
			<section className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
				<header className="space-y-1">
					<h1 className="text-2xl font-bold text-slate-900">{LOGIN_PAGE_TITLE}</h1>
					<p className="text-sm text-slate-600">{LOGIN_PAGE_DESCRIPTION}</p>
				</header>
				<LoginForm continuation={continuation} />
			</section>
		</main>
	);
}
