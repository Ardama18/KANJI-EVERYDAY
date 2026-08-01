import { redirect } from "next/navigation";

import { OAuthConsentForm } from "@/components/oauth/consent-form";
import { isMcpEnabled } from "@/lib/env";
import { getOAuthClientDisplay } from "@/lib/oauth/client-display";
import {
	type OAuthServerApi,
	getVerifiedAuthorization,
	isAuthorizationId,
} from "@/lib/oauth/server";
import { createReadOnlyServerClient } from "@/lib/supabase/server";

type ConsentPageProps = Readonly<{
	searchParams?: Readonly<{ authorization_id?: string | string[] }>;
}>;

export default async function OAuthConsentPage({ searchParams }: ConsentPageProps) {
	const authorizationId =
		typeof searchParams?.authorization_id === "string" ? searchParams.authorization_id : undefined;
	if (!isAuthorizationId(authorizationId)) return <ConsentProblem />;

	const supabase = createReadOnlyServerClient();
	let userId: string | null = null;
	try {
		const { data, error } = await supabase.auth.getUser();
		userId = error === null ? (data.user?.id ?? null) : null;
	} catch {
		return <ConsentProblem />;
	}
	if (userId === null)
		redirect(`/oauth/consent/start?authorization_id=${encodeURIComponent(authorizationId)}`);

	const details = await getVerifiedAuthorization(
		supabase.auth.oauth as unknown as OAuthServerApi,
		userId,
		authorizationId
	);
	if (details === null) return <ConsentProblem />;
	if ("redirectUrl" in details) redirect(details.redirectUrl);
	if (!isMcpEnabled()) return <ConsentProblem message="現在この連携は利用できません。" />;
	const display = getOAuthClientDisplay(details.clientId, details.clientName);

	return (
		<main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-8">
			<section
				aria-labelledby="oauth-consent-heading"
				className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
			>
				<h1 id="oauth-consent-heading" className="text-2xl font-bold text-slate-900">
					{display.heading}
				</h1>
				<p className="mt-3 break-words text-base font-semibold text-slate-900">
					{details.clientName}
				</p>
				<p className="mt-5 text-sm font-medium text-slate-800">この連携でできること</p>
				<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
					{display.permissions.map((permission) => (
						<li key={permission}>{permission}</li>
					))}
				</ul>
				<div className="mt-4 space-y-2 text-sm text-slate-600">
					{display.description.map((description) => (
						<p key={description}>{description}</p>
					))}
				</div>
				<OAuthConsentForm
					authorizationId={details.authorizationId}
					clientName={details.clientName}
				/>
			</section>
		</main>
	);
}

function ConsentProblem(props: Readonly<{ message?: string }>) {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-8">
			<section className="w-full rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
				<h1 className="text-xl font-bold text-slate-900">連携を確認できません</h1>
				<p className="mt-3 text-sm text-slate-700">
					{props.message ??
						"連携の有効期限が切れたか、確認情報が正しくありません。外部サービスからもう一度連携を開始してください。"}
				</p>
			</section>
		</main>
	);
}
