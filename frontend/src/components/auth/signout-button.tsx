import { signOut } from "@/actions/auth-actions";

export function SignOutButton() {
	return (
		<form action={signOut}>
			<button
				type="submit"
				className="h-12 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
			>
				ログアウト
			</button>
		</form>
	);
}
