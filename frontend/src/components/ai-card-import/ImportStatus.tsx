"use client";

import { safeCodeMessage } from "@/lib/ai-card-generation/safe-code-message";
import type { ImportStatusResponse } from "@/lib/ai-import/async-contract";

interface ImportStatusProps {
	readonly result: ImportStatusResponse | undefined;
	readonly tracking: boolean;
	readonly onRefresh: () => Promise<void>;
}

export default function ImportStatus({ result, tracking, onRefresh }: ImportStatusProps) {
	if (!tracking && result === undefined) return null;
	return (
		<section
			className="mt-6 rounded-xl border border-slate-200 p-4"
			aria-labelledby="import-status-heading"
		>
			<h2 id="import-status-heading" tabIndex={-1} className="text-lg font-bold text-slate-900">
				登録状況
			</h2>
			<p className="mt-2 text-sm text-slate-700">
				{result === undefined
					? "状況を取得しています"
					: `状態: ${result.status} / 成功 ${result.counts.succeeded}件 / 失敗 ${result.counts.failed}件`}
			</p>
			{result?.items.some((item) => item.status === "failed") ? (
				<ul className="mt-3 space-y-1 text-sm">
					{result.items
						.filter((item) => item.status === "failed")
						.map((item) => (
							<li key={item.itemId}>
								失敗: {item.conceptId} / {safeCodeMessage(item.errorCode ?? "INTERNAL_ERROR")}
							</li>
						))}
				</ul>
			) : null}
			<button
				type="button"
				onClick={() => void onRefresh()}
				className="mt-4 min-h-11 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700"
			>
				再取得
			</button>
		</section>
	);
}
