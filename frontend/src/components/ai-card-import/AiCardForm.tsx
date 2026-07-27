"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type {
	GenerateCardDraftInput,
	GenerationIllustrationMode,
	GenerationPattern,
} from "@/lib/ai-card-generation/contracts";

import SourceUploadList, { sourceFilesError } from "./SourceUploadList";

export interface AiCardFormSubmission extends GenerateCardDraftInput {
	readonly sourceFiles: readonly File[];
}

interface AiCardFormProps {
	readonly deckId: string;
	readonly disabled: boolean;
	readonly onSubmit: (value: AiCardFormSubmission) => Promise<void>;
	readonly onCancel: () => Promise<void>;
}

const PATTERN_OPTIONS: readonly {
	readonly value: GenerationPattern;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		value: "R1",
		label: "読みを練習",
		description: "表に漢字、裏によみを入れます。",
	},
	{
		value: "W1",
		label: "書きを練習",
		description: "表によみ、裏に漢字を入れます。",
	},
	{
		value: "both",
		label: "読みと書きの両方",
		description: "1つの漢字から読みカードと書きカードを1枚ずつ作ります。",
	},
];

export default function AiCardForm({ deckId, disabled, onSubmit, onCancel }: AiCardFormProps) {
	const id = useId();
	const [instruction, setInstruction] = useState("");
	const [pattern, setPattern] = useState<GenerationPattern>("both");
	const [count, setCount] = useState(2);
	const [tag, setTag] = useState("");
	const [illustration, setIllustration] = useState<GenerationIllustrationMode>("none");
	const [sourceFiles, setSourceFiles] = useState<readonly File[]>([]);
	const [error, setError] = useState<{
		readonly field: "instruction" | "count" | "tag";
		readonly message: string;
	}>();
	const instructionRef = useRef<HTMLTextAreaElement>(null);
	const sourceRef = useRef<HTMLInputElement>(null);
	const countRef = useRef<HTMLInputElement>(null);
	const tagRef = useRef<HTMLInputElement>(null);
	const showError = (field: "instruction" | "count" | "tag", message: string) => {
		setError({ field, message });
		queueMicrotask(() =>
			({ instruction: instructionRef, count: countRef, tag: tagRef })[field].current?.focus()
		);
	};

	async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		const normalizedInstruction = instruction.trim();
		if (normalizedInstruction.length < 1 || Array.from(normalizedInstruction).length > 4_000) {
			showError("instruction", "指示は1〜4,000文字で入力してください。");
			return;
		}
		if (sourceFilesError(sourceFiles) !== undefined) {
			sourceRef.current?.focus();
			return;
		}
		if (
			!Number.isSafeInteger(count) ||
			count < 1 ||
			count > 50 ||
			(pattern === "both" && count % 2 !== 0)
		) {
			showError(
				"count",
				pattern === "both"
					? "読みと書きの両方では、作るカードの合計枚数を2〜50の偶数で入力してください。"
					: "枚数は1〜50で入力してください。"
			);
			return;
		}
		if (tag.trim().length > 30) {
			showError("tag", "タグは30文字以内で入力してください。");
			return;
		}
		setError(undefined);
		await onSubmit({
			deckId,
			instruction: normalizedInstruction,
			pattern,
			requestedCardCount: count,
			tags: tag.trim().length === 0 ? [] : [tag.trim()],
			illustration,
			generationReservationKey: crypto.randomUUID(),
			sourceFiles,
		});
	}

	return (
		<form className="mt-6 space-y-5" onSubmit={submit} noValidate>
			<div>
				<label htmlFor={`${id}-instruction`} className="block text-sm font-semibold text-slate-800">
					作りたいカードの指示
				</label>
				<textarea
					ref={instructionRef}
					id={`${id}-instruction`}
					value={instruction}
					onChange={(event) => setInstruction(event.target.value)}
					disabled={disabled}
					aria-invalid={error?.field === "instruction"}
					aria-describedby={`${id}-instruction-help${error?.field === "instruction" ? ` ${id}-instruction-error` : ""}`}
					className="mt-2 min-h-28 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
				<p id={`${id}-instruction-help`} className="mt-1 text-xs text-slate-600">
					個人情報を含めず、学年や学習内容を入力してください。
				</p>
			</div>
			<SourceUploadList
				files={sourceFiles}
				onChange={setSourceFiles}
				disabled={disabled}
				inputRef={sourceRef}
			/>
			<fieldset disabled={disabled}>
				<legend className="text-sm font-semibold text-slate-800">カード形式</legend>
				<div className="mt-2 flex flex-wrap gap-2">
					{PATTERN_OPTIONS.map((option) => (
						<label
							key={option.value}
							className="flex min-h-11 max-w-full items-start gap-2 rounded-lg border border-slate-300 px-3 py-2"
						>
							<input
								className="mt-1"
								type="radio"
								name={`${id}-pattern`}
								value={option.value}
								checked={pattern === option.value}
								onChange={() => setPattern(option.value)}
							/>
							<span>
								<span className="block text-sm font-semibold text-slate-800">{option.label}</span>
								<span className="block text-xs text-slate-600">{option.description}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>
			<div>
				<label htmlFor={`${id}-count`} className="block text-sm font-semibold text-slate-800">
					作るカードの合計枚数
				</label>
				<input
					ref={countRef}
					id={`${id}-count`}
					type="number"
					min={1}
					max={50}
					step={pattern === "both" ? 2 : 1}
					value={count}
					onChange={(event) => setCount(Number(event.target.value))}
					disabled={disabled}
					aria-invalid={error?.field === "count"}
					aria-describedby={`${id}-count-help${error?.field === "count" ? ` ${id}-count-error` : ""}`}
					className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3"
				/>
				<p id={`${id}-count-help`} className="mt-1 text-xs text-slate-600">
					{pattern === "both"
						? "読みと書きの両方では、1つの漢字から2枚作るため偶数で指定してください。"
						: "この枚数分のカード案を作ります。"}
				</p>
			</div>
			<div>
				<label htmlFor={`${id}-tag`} className="block text-sm font-semibold text-slate-800">
					タグ（任意）
				</label>
				<input
					ref={tagRef}
					id={`${id}-tag`}
					value={tag}
					maxLength={30}
					onChange={(event) => setTag(event.target.value)}
					disabled={disabled}
					aria-invalid={error?.field === "tag"}
					aria-describedby={error?.field === "tag" ? `${id}-tag-error` : undefined}
					className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3"
				/>
			</div>
			<fieldset disabled={disabled}>
				<legend className="text-sm font-semibold text-slate-800">カード画像</legend>
				<div className="mt-2 flex flex-wrap gap-2">
					{(["none", "ai", "upload"] as const).map((value) => (
						<label
							key={value}
							className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3"
						>
							<input
								type="radio"
								name={`${id}-illustration`}
								value={value}
								checked={illustration === value}
								onChange={() => setIllustration(value)}
							/>
							{value === "none" ? "なし" : value === "ai" ? "AI画像" : "別画像をアップロード"}
						</label>
					))}
				</div>
			</fieldset>
			{error !== undefined ? (
				<p
					id={`${id}-${error.field}-error`}
					role="alert"
					className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
				>
					{error.message}
				</p>
			) : null}
			<div className="flex flex-col gap-3 sm:flex-row">
				<button
					type="submit"
					disabled={disabled}
					className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:bg-slate-300"
				>
					カード案を生成
				</button>
				<button
					type="button"
					onClick={() => void onCancel()}
					disabled={disabled}
					className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700"
				>
					取消
				</button>
			</div>
		</form>
	);
}
