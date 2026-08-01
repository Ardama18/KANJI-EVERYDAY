import { redirect } from "next/navigation";

import { OAuthConnectionsClient } from "@/components/oauth/connections-client";
import { type OAuthServerApi, getOAuthConnections } from "@/lib/oauth/server";
import { createReadOnlyServerClient } from "@/lib/supabase/server";

export default async function OAuthConnectionsPage() {
	const supabase = createReadOnlyServerClient();
	const { data, error } = await supabase.auth.getUser();
	if (error !== null || data.user === null) redirect("/login");
	const connections = await getOAuthConnections(supabase.auth.oauth as unknown as OAuthServerApi);
	return (
		<section className="mx-auto w-full max-w-3xl px-4 py-8">
			<h1 className="text-2xl font-bold text-slate-900">外部サービス連携</h1>
			<p className="mt-2 text-sm text-slate-600">
				連携を解除すると、そのサービスは次回の操作からこのアカウントで許可された情報にアクセスできません。
			</p>
			{connections === null ? (
				<p
					role="alert"
					className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
				>
					連携一覧を取得できませんでした。時間をおいて再試行してください。
				</p>
			) : (
				<OAuthConnectionsClient connections={connections} />
			)}
		</section>
	);
}
