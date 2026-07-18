"use client";

import type { ClientImportItemInput } from "@/lib/ai-import/schema";

interface DraftCardListProps {
	readonly items: readonly ClientImportItemInput[];
	readonly onChange: (items: readonly ClientImportItemInput[]) => void;
	readonly onIllustration: (conceptId: string, file: File) => Promise<void>;
	readonly requiredIllustrationConceptIds: readonly string[];
	readonly disabled: boolean;
}

export default function DraftCardList({
	items,
	onChange,
	onIllustration,
	requiredIllustrationConceptIds,
	disabled,
}: DraftCardListProps) {
	const requiredIllustrations = new Set(requiredIllustrationConceptIds);
	const firstConceptIndexes = new Map<string, number>();
	for (const [index, item] of items.entries())
		if (!firstConceptIndexes.has(item.conceptId)) firstConceptIndexes.set(item.conceptId, index);
	function update(index: number, patch: Partial<ClientImportItemInput>): void {
		onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
	}
	function move(index: number, offset: -1 | 1): void {
		const target = index + offset;
		if (target < 0 || target >= items.length) return;
		const next = [...items];
		const [item] = next.splice(index, 1);
		if (item === undefined) return;
		next.splice(target, 0, item);
		onChange(next);
	}
	return (
		<section className="mt-6" aria-labelledby="draft-heading">
			<h2 id="draft-heading" tabIndex={-1} className="text-xl font-bold text-slate-900">
				カード案（{items.length}枚）
			</h2>
			<div className="mt-4 space-y-4">
				{items.map((item, index) => (
					<article
						key={item.clientItemId}
						className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="font-semibold text-slate-900">
								{item.pattern} / {item.conceptId}
							</h3>
							<button
								type="button"
								disabled={disabled}
								onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
								className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700"
							>
								除外
							</button>
						</div>
						<label className="mt-3 block text-sm font-medium text-slate-700">
							表
							<input
								value={item.front}
								disabled={disabled}
								onChange={(event) => update(index, { front: event.target.value })}
								className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3"
							/>
						</label>
						<label className="mt-3 block text-sm font-medium text-slate-700">
							裏
							<input
								value={item.back}
								disabled={disabled}
								onChange={(event) => update(index, { back: event.target.value })}
								className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3"
							/>
						</label>
						<label className="mt-3 block text-sm font-medium text-slate-700">
							タグ（カンマ区切り）
							<input
								value={item.tags.join(",")}
								disabled={disabled}
								onChange={(event) =>
									update(index, {
										tags: event.target.value
											.split(",")
											.map((tag) => tag.trim())
											.filter(Boolean),
									})
								}
								className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3"
							/>
						</label>
						{item.image.mode === "upload" ? (
							<p className="mt-2 break-all text-xs text-slate-600">
								画像準備済み: {item.image.uploadId}
							</p>
						) : null}
						{requiredIllustrations.has(item.conceptId) &&
						firstConceptIndexes.get(item.conceptId) === index ? (
							<label className="mt-3 block text-sm font-medium text-slate-700">
								concept共有画像（必須）
								<input
									type="file"
									accept="image/png,image/jpeg,image/webp"
									disabled={disabled}
									onChange={(event) => {
										const file = event.target.files?.[0];
										if (file !== undefined) void onIllustration(item.conceptId, file);
									}}
									className="mt-1 block min-h-11 w-full text-sm"
								/>
							</label>
						) : null}
						<div className="mt-3 flex gap-2">
							<button
								type="button"
								disabled={disabled || index === 0}
								onClick={() => move(index, -1)}
								className="min-h-11 rounded-lg border border-slate-300 px-3 disabled:text-slate-300"
							>
								上へ
							</button>
							<button
								type="button"
								disabled={disabled || index === items.length - 1}
								onClick={() => move(index, 1)}
								className="min-h-11 rounded-lg border border-slate-300 px-3 disabled:text-slate-300"
							>
								下へ
							</button>
						</div>
					</article>
				))}
			</div>
		</section>
	);
}
