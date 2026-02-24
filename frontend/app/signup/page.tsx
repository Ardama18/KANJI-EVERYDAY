import { SignupForm } from "@/components/auth/signup-form";

export const SIGNUP_PAGE_TITLE = "新規登録";
export const SIGNUP_PAGE_DESCRIPTION =
	"表示名・メールアドレス・パスワードを入力してアカウントを作成します";

export default function SignupPage() {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-[28rem] flex-col justify-center px-4 py-8">
			<section className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
				<header className="space-y-1">
					<h1 className="text-2xl font-bold text-slate-900">{SIGNUP_PAGE_TITLE}</h1>
					<p className="text-sm text-slate-600">{SIGNUP_PAGE_DESCRIPTION}</p>
				</header>
				<SignupForm />
			</section>
		</main>
	);
}
