import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/signout-button";
import { isAiCardManagementEnabled } from "@/lib/env";
import Link from "next/link";

type AuthLayoutProps = {
	children: ReactNode;
};

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: AuthLayoutProps) {
	const managementEnabled = isAiCardManagementEnabled();
	return (
		<div className="min-h-screen bg-slate-50">
			<header className="border-b border-slate-200 bg-white">
				<div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
					<div className="flex min-w-0 items-center gap-3">
						<Link
							href="/decks"
							className="text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
						>
							まいにち漢字
						</Link>
						{managementEnabled ? (
							<Link
								href="/ai/cards"
								className="min-h-12 rounded-lg px-3 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
							>
								AIカード管理
							</Link>
						) : null}
						<Link
							href="/oauth/connections"
							className="min-h-12 rounded-lg px-3 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
						>
							外部AI連携
						</Link>
					</div>
					<SignOutButton />
				</div>
			</header>
			<main>{children}</main>
		</div>
	);
}
