"use client";

import { type RefObject, useId } from "react";

interface SourceUploadListProps {
	readonly files: readonly File[];
	readonly onChange: (files: readonly File[]) => void;
	readonly disabled: boolean;
	readonly inputRef?: RefObject<HTMLInputElement>;
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export function sourceFilesError(files: readonly File[]): string | undefined {
	if (
		files.length > 5 ||
		files.some((file) => !ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_BYTES) ||
		files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES
	)
		return "画像は5枚まで、各10MiB・合計50MiB以内にしてください。";
	return undefined;
}

export default function SourceUploadList({
	files,
	onChange,
	disabled,
	inputRef,
}: SourceUploadListProps) {
	const id = useId();
	const error = sourceFilesError(files);
	return (
		<section aria-labelledby={`${id}-heading`}>
			<h3 id={`${id}-heading`} className="text-sm font-semibold text-slate-800">
				教材source画像（任意・最大5枚）
			</h3>
			<p className="mt-1 text-xs text-slate-600">
				カード用画像とは別です。PNG（8-bit・透過なし）/JPEG/WebP（透過なし）、各10MiB以下。
			</p>
			<label
				htmlFor={`${id}-source`}
				className="mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-400 px-3 text-sm font-medium text-slate-700"
			>
				画像を選ぶ
			</label>
			<input
				ref={inputRef}
				id={`${id}-source`}
				className="sr-only"
				type="file"
				accept="image/png,image/jpeg,image/webp"
				multiple
				disabled={disabled}
				aria-invalid={error !== undefined}
				aria-describedby={error !== undefined ? `${id}-error` : undefined}
				onChange={(event) => onChange(Array.from(event.target.files ?? []).slice(0, 6))}
			/>
			{error !== undefined ? (
				<p id={`${id}-error`} role="alert" className="mt-2 text-sm text-red-700">
					{error}
				</p>
			) : null}
			<ul className="mt-2 space-y-2">
				{files.map((file, index) => (
					<li
						key={`${file.name}-${file.size}`}
						className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm"
					>
						<span className="min-w-0 break-all">{file.name}</span>
						<button
							type="button"
							disabled={disabled}
							aria-label={`${file.name}を削除`}
							onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
							className="min-h-11 shrink-0 rounded-lg px-3 text-red-700"
						>
							削除
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
