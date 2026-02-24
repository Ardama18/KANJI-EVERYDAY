import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/signout-button";

type AuthLayoutProps = {
	children: ReactNode;
};

export default function AuthLayout({ children }: AuthLayoutProps) {
	return (
		<div className="min-h-screen bg-slate-50">
			<header className="border-b border-slate-200 bg-white">
				<div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
					<p className="text-lg font-semibold text-slate-900">まいにち漢字</p>
					<SignOutButton />
				</div>
			</header>
			<main>{children}</main>
		</div>
	);
}
