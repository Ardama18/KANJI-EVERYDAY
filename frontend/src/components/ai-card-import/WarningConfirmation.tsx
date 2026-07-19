"use client";

interface WarningConfirmationProps {
	readonly confirmed: boolean;
	readonly onChange: (confirmed: boolean) => void;
	readonly previewValid: boolean;
	readonly committing: boolean;
	readonly onPreview: () => Promise<void>;
	readonly onCommit: () => Promise<void>;
}

export default function WarningConfirmation({
	confirmed,
	onChange,
	previewValid,
	committing,
	onPreview,
	onCommit,
}: WarningConfirmationProps) {
	return (
		<section
			className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4"
			aria-labelledby="approval-heading"
		>
			<h2 id="approval-heading" className="font-bold text-amber-950">
				登録前の注意
			</h2>
			<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
				<li>表・裏・読みの正確さを全件確認してください。</li>
				<li>氏名・住所・連絡先など個人情報がないことを確認してください。</li>
				<li>教材と生成内容の著作権・利用権限を確認してください。</li>
			</ul>
			{previewValid ? (
				<label className="mt-4 flex min-h-11 items-start gap-3">
					<input
						type="checkbox"
						checked={confirmed}
						onChange={(event) => onChange(event.target.checked)}
						className="mt-1 size-5"
					/>
					<span className="text-sm font-semibold">全カードと上記注意事項を確認しました</span>
				</label>
			) : (
				<p className="mt-4 text-sm font-semibold text-amber-900">
					変更後のカードを再確認してください。
				</p>
			)}
			<div className="mt-4 flex flex-col gap-3 sm:flex-row">
				{!previewValid ? (
					<button
						type="button"
						disabled={committing}
						onClick={() => void onPreview()}
						className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-semibold text-white"
					>
						変更後を再確認
					</button>
				) : null}
				<button
					type="button"
					disabled={!previewValid || !confirmed || committing}
					onClick={() => void onCommit()}
					className="min-h-11 flex-1 rounded-xl bg-green-700 px-4 font-semibold text-white disabled:bg-slate-300"
				>
					登録する
				</button>
			</div>
		</section>
	);
}
