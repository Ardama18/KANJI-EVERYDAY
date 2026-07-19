import {
	getAiCardListAction,
	getAiCardManagementOptionsAction,
} from "@/actions/ai-card-management-actions";
import { AiCardManagementClient } from "@/components/ai-card-management/AiCardManagementClient";
import { isAiCardManagementEnabled } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AiCardsPage() {
	if (!isAiCardManagementEnabled()) notFound();
	const supabase = createServerClient();
	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user) redirect("/login");
	const [initialPage, options] = await Promise.all([
		getAiCardListAction({}),
		getAiCardManagementOptionsAction(),
	]);
	return (
		<main className="mx-auto w-full max-w-5xl px-4 py-6">
			<h1 className="text-2xl font-bold text-slate-900">AIカード管理</h1>
			<p className="mt-2 text-sm text-slate-600">
				AIで登録した自分のカードを検索・編集・削除できます。
			</p>
			<AiCardManagementClient
				initialPage={initialPage.ok ? initialPage.data : { items: [], nextCursor: null }}
				initialError={initialPage.ok ? null : initialPage.error.message}
				initialOptions={
					options.ok
						? { status: "ready", data: options.data }
						: { status: "error", message: options.error.message }
				}
			/>
		</main>
	);
}
