"use client";

import type {
	MnemonicExplanationDraft,
	MnemonicSlotsDraft,
} from "@/lib/ai-card-generation/contracts";

export type MnemonicImageMode = "none" | "ai" | "upload";

export interface MnemonicConceptView {
	readonly conceptId: string;
	readonly image: MnemonicImageMode;
}

export interface MnemonicApprovalEntry {
	readonly slots: MnemonicSlotsDraft;
	readonly explanation: MnemonicExplanationDraft;
	readonly approved: boolean;
}

export type MnemonicApprovalMap = ReadonlyMap<string, MnemonicApprovalEntry>;

interface MnemonicApprovalListProps {
	readonly concepts: readonly MnemonicConceptView[];
	readonly entries: MnemonicApprovalMap;
	readonly onEntryChange: (conceptId: string, entry: MnemonicApprovalEntry) => void;
	readonly disabled: boolean;
}

const MNEMONIC_LIMITS = {
	kanjiMax: 16,
	textMax: 100,
	summaryMax: 120,
	mappingsMin: 2,
	mappingsMax: 4,
} as const;

const FIELD_INPUT_CLASS =
	"mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100";

export default function MnemonicApprovalList({
	concepts,
	entries,
	onEntryChange,
	disabled,
}: MnemonicApprovalListProps) {
	const editable = concepts.filter((concept) => entries.has(concept.conceptId));
	if (editable.length === 0) return null;
	return (
		<section className="mt-6" aria-labelledby="mnemonic-approval-heading">
			<h2 id="mnemonic-approval-heading" tabIndex={-1} className="text-xl font-bold text-slate-900">
				ニーモニックの承認（{editable.length}件）
			</h2>
			<p className="mt-1 text-sm text-slate-600">
				穴埋めと説明を確認・編集し、内容が正しければ承認してください。承認したものだけが保存されます。
			</p>
			<div className="mt-4 space-y-6">
				{editable.map((concept) => {
					const entry = entries.get(concept.conceptId);
					if (entry === undefined) return null;
					return (
						<ConceptApproval
							key={concept.conceptId}
							concept={concept}
							entry={entry}
							disabled={disabled}
							onEntryChange={onEntryChange}
						/>
					);
				})}
			</div>
		</section>
	);
}

function ConceptApproval({
	concept,
	entry,
	disabled,
	onEntryChange,
}: {
	readonly concept: MnemonicConceptView;
	readonly entry: MnemonicApprovalEntry;
	readonly disabled: boolean;
	readonly onEntryChange: (conceptId: string, entry: MnemonicApprovalEntry) => void;
}) {
	const valid = isMnemonicEntryValid(entry);
	// An approved entry must always be valid: dropping below validity clears
	// the approval so the commit body never carries an unverified concept.
	const emit = (next: MnemonicApprovalEntry): void =>
		onEntryChange(
			concept.conceptId,
			isMnemonicEntryValid(next) ? next : { ...next, approved: false }
		);
	const updateSlots = (patch: Partial<MnemonicSlotsDraft>): void =>
		emit({ ...entry, slots: { ...entry.slots, ...patch } });
	const updateKanji = (kanji: string): void =>
		updateSlots({ kanji, isSingleKanji: Array.from(kanji).length === 1 });
	const updateShapeHint = (patch: Partial<MnemonicSlotsDraft["shapeHint"]>): void =>
		updateSlots({ shapeHint: { ...entry.slots.shapeHint, ...patch } });
	const updateExplanation = (patch: Partial<MnemonicExplanationDraft>): void =>
		emit({ ...entry, explanation: { ...entry.explanation, ...patch } });
	const updateMapping = (index: number, patch: { part?: string; meaning?: string }): void =>
		updateExplanation({
			mappings: entry.explanation.mappings.map((mapping, mappingIndex) =>
				mappingIndex === index ? { ...mapping, ...patch } : mapping
			),
		});
	const addMapping = (): void => {
		if (entry.explanation.mappings.length >= MNEMONIC_LIMITS.mappingsMax) return;
		updateExplanation({
			mappings: [...entry.explanation.mappings, { part: "", meaning: "" }],
		});
	};
	const removeMapping = (index: number): void => {
		if (entry.explanation.mappings.length <= MNEMONIC_LIMITS.mappingsMin) return;
		updateExplanation({
			mappings: entry.explanation.mappings.filter((_, mappingIndex) => mappingIndex !== index),
		});
	};
	const canAdd = entry.explanation.mappings.length < MNEMONIC_LIMITS.mappingsMax;
	const canRemove = entry.explanation.mappings.length > MNEMONIC_LIMITS.mappingsMin;
	const approveBlocked = disabled || (!valid && !entry.approved);
	return (
		<fieldset className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
			<legend className="px-1 font-semibold text-slate-900">{concept.conceptId}</legend>
			<TextField
				label="漢字"
				value={entry.slots.kanji}
				disabled={disabled}
				onChange={updateKanji}
			/>
			<p className="mt-1 text-xs text-slate-500">
				{entry.slots.isSingleKanji ? "単一の漢字として扱います。" : "熟語として扱います。"}
			</p>
			<TextField
				label="形のヒント（部品）"
				value={entry.slots.shapeHint.part}
				disabled={disabled}
				onChange={(part) => updateShapeHint({ part })}
			/>
			<TextField
				label="形のヒント（イメージ）"
				value={entry.slots.shapeHint.picture}
				disabled={disabled}
				onChange={(picture) => updateShapeHint({ picture })}
			/>
			<TextField
				label="意味のヒント"
				value={entry.slots.meaningHint}
				disabled={disabled}
				onChange={(meaningHint) => updateSlots({ meaningHint })}
			/>
			<TextField
				label="覚え方のストーリー"
				value={entry.slots.story}
				disabled={disabled}
				onChange={(story) => updateSlots({ story })}
			/>
			<TextField
				label="説明のまとめ"
				value={entry.explanation.summary}
				disabled={disabled}
				onChange={(summary) => updateExplanation({ summary })}
			/>
			<div className="mt-4">
				<p className="text-sm font-medium text-slate-700">部品と意味の対応（2〜4件）</p>
				<div className="mt-2 space-y-2">
					{entry.explanation.mappings.map((mapping, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: mappings have no stable id; order is the identity here.
						<div key={index} className="flex flex-wrap items-end gap-2">
							<TextField
								label={`部品 ${index + 1}`}
								value={mapping.part}
								disabled={disabled}
								onChange={(part) => updateMapping(index, { part })}
								className="min-w-0 flex-1"
							/>
							<TextField
								label={`意味 ${index + 1}`}
								value={mapping.meaning}
								disabled={disabled}
								onChange={(meaning) => updateMapping(index, { meaning })}
								className="min-w-0 flex-1"
							/>
							<button
								type="button"
								disabled={disabled || !canRemove}
								onClick={() => removeMapping(index)}
								className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-red-700 disabled:text-slate-300"
							>
								対応を削除
							</button>
						</div>
					))}
				</div>
				<button
					type="button"
					disabled={disabled || !canAdd}
					onClick={addMapping}
					className="mt-2 min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:text-slate-300"
				>
					対応を追加
				</button>
			</div>
			<div className="mt-4 flex items-center gap-2">
				<input
					id={`mnemonic-approve-${concept.conceptId}`}
					type="checkbox"
					checked={entry.approved}
					disabled={approveBlocked}
					onChange={(event) => emit({ ...entry, approved: event.target.checked })}
					className="h-5 w-5"
				/>
				<label
					htmlFor={`mnemonic-approve-${concept.conceptId}`}
					className="text-sm font-semibold text-slate-900"
				>
					この内容を承認する
				</label>
			</div>
			{!valid ? (
				<p className="mt-2 text-sm text-amber-700">
					すべての項目を入力し、対応を2〜4件にすると承認できます。
				</p>
			) : null}
			{concept.image === "ai" && !entry.approved ? (
				<p className="mt-2 text-sm font-semibold text-slate-700" aria-live="polite">
					ニーモニック未承認：画像は生成されません
				</p>
			) : null}
		</fieldset>
	);
}

function TextField({
	label,
	value,
	disabled,
	onChange,
	className,
}: {
	readonly label: string;
	readonly value: string;
	readonly disabled: boolean;
	readonly onChange: (value: string) => void;
	readonly className?: string;
}) {
	return (
		<label
			className={`mt-3 block text-sm font-medium text-slate-700${className ? ` ${className}` : ""}`}
		>
			{label}
			<input
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				className={FIELD_INPUT_CLASS}
			/>
		</label>
	);
}

/**
 * Client-side approval gate mirroring the server sanitizer's shape rules
 * (non-empty, code-point length caps, mappings 2-4). The server remains the
 * authoritative validator (NFKC + re-cap); this only governs the approve UI.
 */
export function isMnemonicEntryValid(entry: MnemonicApprovalEntry): boolean {
	const { slots, explanation } = entry;
	if (!isBounded(slots.kanji, MNEMONIC_LIMITS.kanjiMax)) return false;
	if (typeof slots.isSingleKanji !== "boolean") return false;
	if (
		!isBounded(slots.shapeHint.part, MNEMONIC_LIMITS.textMax) ||
		!isBounded(slots.shapeHint.picture, MNEMONIC_LIMITS.textMax) ||
		!isBounded(slots.meaningHint, MNEMONIC_LIMITS.textMax) ||
		!isBounded(slots.story, MNEMONIC_LIMITS.textMax)
	) {
		return false;
	}
	if (!isBounded(explanation.summary, MNEMONIC_LIMITS.summaryMax)) return false;
	if (
		explanation.mappings.length < MNEMONIC_LIMITS.mappingsMin ||
		explanation.mappings.length > MNEMONIC_LIMITS.mappingsMax
	) {
		return false;
	}
	return explanation.mappings.every(
		(mapping) =>
			isBounded(mapping.part, MNEMONIC_LIMITS.textMax) &&
			isBounded(mapping.meaning, MNEMONIC_LIMITS.textMax)
	);
}

function isBounded(value: string, max: number): boolean {
	const length = Array.from(value.trim()).length;
	return length >= 1 && length <= max;
}
