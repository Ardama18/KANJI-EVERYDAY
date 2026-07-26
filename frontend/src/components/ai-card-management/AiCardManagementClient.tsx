"use client";

import {
	deleteAiCardsAction,
	getAiCardListAction,
	getAiCardManagementOptionsAction,
	setAiCardDecksAction,
	setAiCardTagNamesAction,
	updateAiCardContentAction,
	updateAiCardMnemonicAction,
} from "@/actions/ai-card-management-actions";
import {
	MNEMONIC_LIMITS,
	isMnemonicEntryValid,
} from "@/components/ai-card-import/MnemonicApprovalList";
import type {
	MnemonicExplanationDraft,
	MnemonicSlotsDraft,
} from "@/lib/ai-card-generation/contracts";
import { createExclusiveOperationRunner } from "@/lib/ai-card-management/exclusive-operation";
import type {
	AiCardListFilters,
	AiCardListPage,
	AiCardManagementOptions,
	ManagedAiCard,
	ManagedCardMnemonic,
} from "@/lib/ai-card-management/types";
import { useMemo, useRef, useState } from "react";
import { AiCardIllustrationThumbnail } from "./AiCardIllustrationThumbnail";

/** The mnemonic form's payload, split out so AC-10a can test it as a pure function. */
export const mnemonicMutationInput = (
	card: Pick<ManagedAiCard, "id" | "illustrationKey">,
	entry: Readonly<{ slots: MnemonicSlotsDraft; explanation: MnemonicExplanationDraft }>
) => ({
	cardId: card.id,
	illustrationKey: card.illustrationKey,
	slots: entry.slots,
	explanation: entry.explanation,
});

interface Props {
	readonly initialPage: AiCardListPage;
	readonly initialError: string | null;
	readonly initialOptions:
		| { readonly status: "ready"; readonly data: AiCardManagementOptions }
		| { readonly status: "error"; readonly message: string };
}

type Notice = { kind: "error" | "success"; text: string } | null;

const formatDateTime = (value: string) =>
	new Intl.DateTimeFormat("ja-JP", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Tokyo",
	}).format(new Date(value));

const checkedValues = (form: HTMLFormElement, name: string) =>
	Array.from(new FormData(form).getAll(name), String);

export const managedCardSyncKey = (card: ManagedAiCard) =>
	JSON.stringify({
		id: card.id,
		updatedAt: card.updatedAt,
		frontText: card.frontText,
		backText: card.backText,
		skill: card.skill,
		pattern: card.pattern,
		deckIds: card.decks.map((deck) => deck.id),
		tagIds: card.tags.map((tag) => tag.id),
		illustrationId: card.illustration?.id ?? null,
		// A mnemonic save does not move cards.updated_at, so without this the row
		// would not remount and the form would keep the pre-normalization values.
		mnemonic: card.mnemonic === null ? null : JSON.stringify(card.mnemonic),
		mnemonicSharedCardCount: card.mnemonicSharedCardCount,
	});

export function AiCardManagementClient({ initialPage, initialError, initialOptions }: Props) {
	const [cards, setCards] = useState<readonly ManagedAiCard[]>(initialPage.items);
	const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
	const [filters, setFilters] = useState<AiCardListFilters>({});
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [listError, setListError] = useState(initialError);
	const [optionsState, setOptionsState] = useState(initialOptions);
	const [requiresFreshData, setRequiresFreshData] = useState(false);
	const [notice, setNotice] = useState<Notice>(null);
	const [isPending, setIsPending] = useState(false);
	const runExclusive = useRef(createExclusiveOperationRunner(setIsPending)).current;
	const selectedCards = useMemo(
		() => cards.filter((card) => selected.has(card.id)),
		[cards, selected]
	);
	const options = optionsState.status === "ready" ? optionsState.data : null;
	const mutationsDisabled = isPending || requiresFreshData || listError !== null;
	const relationsDisabled = mutationsDisabled || options === null;

	const refresh = (nextFilters: AiCardListFilters = filters) => {
		void runExclusive(
			async () => {
				setNotice(null);
				const result = await getAiCardListAction(nextFilters);
				if (!result.ok) {
					setListError(result.error.message);
					return;
				}
				setCards(result.data.items);
				setNextCursor(result.data.nextCursor);
				setSelected(new Set());
				setListError(null);
			},
			() => setListError("通信に失敗しました。再試行してください。")
		);
	};

	const retryUnavailableData = () => {
		void runExclusive(
			async () => {
				setNotice(null);
				const [listResult, optionsResult] = await Promise.all([
					getAiCardListAction(filters),
					getAiCardManagementOptionsAction(),
				]);
				if (listResult.ok) {
					setCards(listResult.data.items);
					setNextCursor(listResult.data.nextCursor);
					setSelected(new Set());
					setListError(null);
				} else {
					setListError(listResult.error.message);
				}
				if (optionsResult.ok) {
					setOptionsState({ status: "ready", data: optionsResult.data });
				} else {
					setOptionsState({ status: "error", message: optionsResult.error.message });
				}
				if (!listResult.ok || !optionsResult.ok) return;

				setRequiresFreshData(false);
				setNotice({ kind: "success", text: "最新のカード情報を読み込みました。" });
			},
			() => setNotice({ kind: "error", text: "通信に失敗しました。再試行してください。" })
		);
	};

	const applyMutation = (
		operation: () => Promise<{ ok: boolean; error?: { message: string } }>,
		message: string
	) => {
		void runExclusive(
			async () => {
				setNotice(null);
				const result = await operation();
				if (!result.ok)
					return setNotice({
						kind: "error",
						text: result.error?.message ?? "処理に失敗しました。",
					});
				setRequiresFreshData(true);
				setSelected(new Set());
				const [refreshed, refreshedOptions] = await Promise.all([
					getAiCardListAction(filters),
					getAiCardManagementOptionsAction(),
				]);
				if (refreshed.ok) {
					setCards(refreshed.data.items);
					setNextCursor(refreshed.data.nextCursor);
					setListError(null);
				} else {
					setListError(refreshed.error.message);
				}
				if (refreshedOptions.ok) {
					setOptionsState({ status: "ready", data: refreshedOptions.data });
				} else {
					setOptionsState({ status: "error", message: refreshedOptions.error.message });
				}
				if (!refreshed.ok || !refreshedOptions.ok) return;

				setRequiresFreshData(false);
				setNotice({ kind: "success", text: message });
			},
			() => setNotice({ kind: "error", text: "通信に失敗しました。再試行してください。" })
		);
	};

	return (
		<section className="mt-6" aria-busy={isPending}>
			<form
				className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
				onSubmit={(event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					const next: AiCardListFilters = {
						deckId: String(data.get("deckId") || "") || undefined,
						tagId: String(data.get("tagId") || "") || undefined,
						source: (String(data.get("source") || "") || undefined) as AiCardListFilters["source"],
						createdFrom: String(data.get("createdFrom") || "") || undefined,
						createdTo: String(data.get("createdTo") || "") || undefined,
					};
					setFilters(next);
					refresh(next);
				}}
			>
				<label className="text-sm font-medium text-slate-700">
					デッキ
					<select
						name="deckId"
						disabled={isPending || options === null}
						aria-describedby={options === null ? "ai-card-options-error" : undefined}
						className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
					>
						<option value="">{options === null ? "取得できません" : "すべて"}</option>
						{options?.decks.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<label className="text-sm font-medium text-slate-700">
					タグ
					<select
						name="tagId"
						disabled={isPending || options === null}
						aria-describedby={options === null ? "ai-card-options-error" : undefined}
						className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
					>
						<option value="">{options === null ? "取得できません" : "すべて"}</option>
						{options?.tags.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<label className="text-sm font-medium text-slate-700">
					登録元
					<select
						name="source"
						className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
					>
						<option value="">すべて</option>
						<option value="app_ai">アプリAI</option>
						<option value="remote_mcp">外部AI</option>
					</select>
				</label>
				<label className="text-sm font-medium text-slate-700">
					登録日（開始）
					<input
						name="createdFrom"
						type="date"
						className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
					/>
				</label>
				<label className="text-sm font-medium text-slate-700">
					登録日（終了）
					<input
						name="createdTo"
						type="date"
						className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
					/>
				</label>
				<button
					type="submit"
					disabled={isPending || requiresFreshData || listError !== null}
					className="min-h-12 self-end rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60"
				>
					絞り込む
				</button>
			</form>

			{requiresFreshData || listError !== null || optionsState.status === "error" ? (
				<div
					id={optionsState.status === "error" ? "ai-card-options-error" : undefined}
					role="alert"
					className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
				>
					{requiresFreshData ? (
						<p>変更後の最新情報を取得できませんでした。安全のため編集・削除を停止しています。</p>
					) : null}
					{listError !== null ? <p>カード一覧を取得できませんでした。{listError}</p> : null}
					{optionsState.status === "error" ? (
						<p>
							デッキ・タグの選択肢を取得できませんでした。関係の編集は一時的に利用できません。
							{optionsState.message}
						</p>
					) : null}
					<button
						type="button"
						disabled={isPending}
						className="mt-3 min-h-12 rounded-lg border border-red-700 bg-white px-4 font-semibold text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-60"
						onClick={retryUnavailableData}
					>
						カード情報を再読み込み
					</button>
				</div>
			) : null}

			{notice ? (
				<p
					role={notice.kind === "error" ? "alert" : "status"}
					className={`mt-4 rounded-lg px-4 py-3 text-sm ${notice.kind === "error" ? "border border-red-300 bg-red-50 text-red-800" : "border border-green-300 bg-green-50 text-green-800"}`}
				>
					{notice.text}
				</p>
			) : null}
			{isPending ? (
				<output aria-live="polite" className="mt-4 block text-sm text-slate-600">
					処理中です…
				</output>
			) : null}

			{selectedCards.length > 0 ? (
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
					<p className="text-sm font-medium text-red-900">{selectedCards.length}件を選択中</p>
					<button
						type="button"
						disabled={mutationsDisabled}
						className="min-h-12 rounded-lg bg-red-700 px-4 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-60"
						onClick={() => {
							if (
								!window.confirm(
									`${selectedCards.length}件のカードを削除します。学習履歴も削除されます。よろしいですか？`
								)
							)
								return;
							applyMutation(
								() =>
									deleteAiCardsAction(
										selectedCards.map((card) => ({
											cardId: card.id,
											expectedUpdatedAt: card.updatedAt,
										}))
									),
								`${selectedCards.length}件を削除しました。`
							);
						}}
					>
						選択したカードを削除
					</button>
				</div>
			) : null}

			{cards.length === 0 && !isPending && listError === null ? (
				<p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
					条件に合うAIカードはありません。
				</p>
			) : (
				<ul className="mt-4 grid gap-4">
					{cards.map((card) => (
						<li
							key={managedCardSyncKey(card)}
							className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
						>
							<div className="flex items-start gap-3">
								<input
									type="checkbox"
									aria-label={`${card.frontText}を選択`}
									checked={selected.has(card.id)}
									disabled={mutationsDisabled}
									className="mt-1 h-6 w-6 shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
									onChange={(event) =>
										setSelected((current) => {
											const next = new Set(current);
											if (event.target.checked) next.add(card.id);
											else next.delete(card.id);
											return next;
										})
									}
								/>
								<div className="min-w-0 flex-1">
									<p className="break-words text-lg font-bold text-slate-900">{card.frontText}</p>
									<p className="mt-1 break-words text-slate-700">{card.backText}</p>
									<p className="mt-2 text-xs text-slate-500">
										{card.pattern} / {card.skill === "reading" ? "読み" : "書き"} ・{" "}
										{formatDateTime(card.createdAt)}
									</p>
									<p className="mt-1 text-xs text-slate-500">
										デッキ: {card.decks.map((item) => item.name).join("、") || "なし"} / タグ:{" "}
										{card.tags.map((item) => item.name).join("、") || "なし"}
									</p>
									<AiCardIllustrationThumbnail
										illustration={card.illustration}
										altText={card.frontText}
									/>
								</div>
							</div>
							<details className="mt-4 border-t border-slate-200 pt-3">
								<summary className="min-h-12 cursor-pointer rounded-lg px-2 py-3 font-medium text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
									編集と取り消し
								</summary>
								<form
									className="mt-3 grid gap-3"
									onSubmit={(event) => {
										event.preventDefault();
										const data = new FormData(event.currentTarget);
										applyMutation(
											() =>
												updateAiCardContentAction({
													cardId: card.id,
													expectedUpdatedAt: card.updatedAt,
													frontText: data.get("frontText"),
													backText: data.get("backText"),
													skill: data.get("skill"),
													pattern: data.get("pattern"),
												}),
											"カード本文を保存しました。学習状態はNewに戻りました。"
										);
									}}
								>
									<label className="text-sm font-medium">
										表
										<input
											name="frontText"
											defaultValue={card.frontText}
											maxLength={200}
											required
											disabled={mutationsDisabled}
											className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3"
										/>
									</label>
									<label className="text-sm font-medium">
										裏
										<input
											name="backText"
											defaultValue={card.backText}
											maxLength={200}
											required
											disabled={mutationsDisabled}
											className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3"
										/>
									</label>
									<div className="grid grid-cols-2 gap-3">
										<label className="text-sm font-medium">
											種類
											<select
												name="skill"
												defaultValue={card.skill}
												disabled={mutationsDisabled}
												className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3"
											>
												<option value="reading">読み</option>
												<option value="writing">書き</option>
											</select>
										</label>
										<label className="text-sm font-medium">
											形式
											<select
												name="pattern"
												defaultValue={card.pattern}
												disabled={mutationsDisabled}
												className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3"
											>
												<option value="R1">R1</option>
												<option value="W1">W1</option>
											</select>
										</label>
									</div>
									<button
										type="submit"
										disabled={mutationsDisabled}
										className="min-h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-60"
									>
										本文を保存
									</button>
								</form>
								<RelationEditor
									title="所属デッキ"
									name="deckIds"
									choices={options?.decks ?? null}
									selected={card.decks.map((item) => item.id)}
									disabled={relationsDisabled}
									onSave={(form) =>
										applyMutation(
											() =>
												setAiCardDecksAction({
													cardId: card.id,
													deckIds: checkedValues(form, "deckIds"),
												}),
											"所属デッキを保存しました。学習状態は維持されます。"
										)
									}
								/>
								<form
									className="mt-4 grid gap-2"
									onSubmit={(event) => {
										event.preventDefault();
										const tagNames = String(new FormData(event.currentTarget).get("tagNames") ?? "")
											.split(",")
											.map((name) => name.trim())
											.filter(Boolean);
										applyMutation(
											() => setAiCardTagNamesAction({ cardId: card.id, tagNames }),
											"タグを保存しました。学習状態は維持されます。"
										);
									}}
								>
									<fieldset disabled={relationsDisabled}>
										<label className="text-sm font-medium">
											タグ（カンマ区切り・最大10件）
											<input
												name="tagNames"
												defaultValue={card.tags.map((tag) => tag.name).join(", ")}
												className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3"
											/>
										</label>
									</fieldset>
									<button
										type="submit"
										disabled={relationsDisabled}
										className="min-h-12 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60"
									>
										タグを保存
									</button>
								</form>
								<MnemonicEditor
									card={card}
									disabled={mutationsDisabled}
									onSave={(entry) =>
										applyMutation(
											() => updateAiCardMnemonicAction(mnemonicMutationInput(card, entry)),
											"覚え方を保存しました。学習状態は維持されます。"
										)
									}
								/>
								<div className="mt-5 grid gap-3 border-t border-red-200 pt-4">
									<button
										type="button"
										disabled={mutationsDisabled}
										className="min-h-12 rounded-lg border border-red-600 px-4 font-semibold text-red-700 disabled:opacity-60"
										onClick={() => {
											if (window.confirm(`「${card.frontText}」を削除します。よろしいですか？`))
												applyMutation(
													() =>
														deleteAiCardsAction([
															{ cardId: card.id, expectedUpdatedAt: card.updatedAt },
														]),
													"カードを削除しました。"
												);
										}}
									>
										このカードを削除
									</button>
								</div>
							</details>
						</li>
					))}
				</ul>
			)}
			{nextCursor ? (
				<button
					type="button"
					disabled={isPending || requiresFreshData || listError !== null}
					className="mt-5 min-h-12 w-full rounded-lg border border-blue-600 bg-white px-4 font-semibold text-blue-700 disabled:opacity-60"
					onClick={() =>
						void runExclusive(
							async () => {
								const result = await getAiCardListAction({ ...filters, cursor: nextCursor });
								if (!result.ok) return setNotice({ kind: "error", text: result.error.message });
								setCards((current) => [...current, ...result.data.items]);
								setNextCursor(result.data.nextCursor);
							},
							() => setNotice({ kind: "error", text: "通信に失敗しました。再試行してください。" })
						)
					}
				>
					次の20件を読み込む
				</button>
			) : null}
		</section>
	);
}

type MnemonicEntryDraft = Readonly<{
	slots: MnemonicSlotsDraft;
	explanation: MnemonicExplanationDraft;
}>;

/**
 * Post-commit mnemonic editor (S-20).  A card without an approved mnemonic — or
 * without an illustration key to write against — only reports "未設定": there is
 * nothing to upsert and the Server Action would reject the request anyway.
 */
function MnemonicEditor({
	card,
	disabled,
	onSave,
}: {
	readonly card: ManagedAiCard;
	readonly disabled: boolean;
	readonly onSave: (entry: MnemonicEntryDraft) => void;
}) {
	if (card.mnemonic === null || card.illustrationKey === null) {
		return (
			<p className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-600">
				覚え方（ニーモニック）: 未設定
			</p>
		);
	}
	return (
		<MnemonicForm
			mnemonic={card.mnemonic}
			sharedCardCount={card.mnemonicSharedCardCount}
			disabled={disabled}
			onSave={onSave}
		/>
	);
}

function MnemonicForm({
	mnemonic,
	sharedCardCount,
	disabled,
	onSave,
}: {
	readonly mnemonic: ManagedCardMnemonic;
	readonly sharedCardCount: number;
	readonly disabled: boolean;
	readonly onSave: (entry: MnemonicEntryDraft) => void;
}) {
	// Controlled state, because adding or removing a mapping changes the field
	// count.  Following refreshed server state is the row remount's job
	// (`managedCardSyncKey`), so there is no props-syncing effect here.
	const [slots, setSlots] = useState<MnemonicSlotsDraft>(mnemonic.slots);
	const [explanation, setExplanation] = useState<MnemonicExplanationDraft>(mnemonic.explanation);
	const valid = isMnemonicEntryValid({ slots, explanation });
	const canAddMapping = explanation.mappings.length < MNEMONIC_LIMITS.mappingsMax;
	const canRemoveMapping = explanation.mappings.length > MNEMONIC_LIMITS.mappingsMin;
	const updateMapping = (index: number, patch: { part?: string; meaning?: string }) =>
		setExplanation((current) => ({
			...current,
			mappings: current.mappings.map((mapping, mappingIndex) =>
				mappingIndex === index ? { ...mapping, ...patch } : mapping
			),
		}));
	return (
		<form
			className="mt-4 grid gap-2 border-t border-slate-200 pt-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSave({ slots, explanation });
			}}
		>
			<p className="text-sm font-semibold text-slate-900">覚え方（ニーモニック）</p>
			<fieldset disabled={disabled}>
				<MnemonicTextField
					label="漢字"
					value={slots.kanji}
					onChange={(kanji) =>
						setSlots((current) => ({
							...current,
							kanji,
							isSingleKanji: Array.from(kanji).length === 1,
						}))
					}
				/>
				<div className="mt-2 flex items-center gap-2">
					<input
						type="checkbox"
						checked={slots.isSingleKanji}
						onChange={(event) =>
							setSlots((current) => ({ ...current, isSingleKanji: event.target.checked }))
						}
						className="h-5 w-5"
						aria-label="単一の漢字として扱う（オフで熟語）"
					/>
					<span className="text-sm font-medium text-slate-700">
						単一の漢字として扱う（オフで熟語）
					</span>
				</div>
				<p className="mt-1 text-xs text-slate-500">
					漢字を編集すると自動判定されます。必要に応じて手動で切り替えてください。
				</p>
				<MnemonicTextField
					label="形のヒント（部品）"
					value={slots.shapeHint.part}
					onChange={(part) =>
						setSlots((current) => ({ ...current, shapeHint: { ...current.shapeHint, part } }))
					}
				/>
				<MnemonicTextField
					label="形のヒント（イメージ）"
					value={slots.shapeHint.picture}
					onChange={(picture) =>
						setSlots((current) => ({ ...current, shapeHint: { ...current.shapeHint, picture } }))
					}
				/>
				<MnemonicTextField
					label="意味のヒント"
					value={slots.meaningHint}
					onChange={(meaningHint) => setSlots((current) => ({ ...current, meaningHint }))}
				/>
				<MnemonicTextField
					label="覚え方のストーリー"
					value={slots.story}
					onChange={(story) => setSlots((current) => ({ ...current, story }))}
				/>
				<MnemonicTextField
					label="説明のまとめ"
					value={explanation.summary}
					onChange={(summary) => setExplanation((current) => ({ ...current, summary }))}
				/>
				<div className="mt-4">
					<p className="text-sm font-medium text-slate-700">部品と意味の対応（2〜4件）</p>
					<div className="mt-2 space-y-2">
						{explanation.mappings.map((mapping, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: mappings have no stable id; order is the identity here.
							<div key={index} className="flex flex-wrap items-end gap-2">
								<MnemonicTextField
									label={`部品 ${index + 1}`}
									value={mapping.part}
									onChange={(part) => updateMapping(index, { part })}
									className="min-w-0 flex-1"
								/>
								<MnemonicTextField
									label={`意味 ${index + 1}`}
									value={mapping.meaning}
									onChange={(meaning) => updateMapping(index, { meaning })}
									className="min-w-0 flex-1"
								/>
								<button
									type="button"
									disabled={disabled || !canRemoveMapping}
									onClick={() =>
										setExplanation((current) => ({
											...current,
											mappings: current.mappings.filter(
												(_, mappingIndex) => mappingIndex !== index
											),
										}))
									}
									className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-red-700 disabled:text-slate-300"
								>
									対応を削除
								</button>
							</div>
						))}
					</div>
					<button
						type="button"
						disabled={disabled || !canAddMapping}
						onClick={() =>
							setExplanation((current) => ({
								...current,
								mappings: [...current.mappings, { part: "", meaning: "" }],
							}))
						}
						className="mt-2 min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:text-slate-300"
					>
						対応を追加
					</button>
				</div>
			</fieldset>
			{sharedCardCount >= 2 ? (
				<p className="text-sm text-slate-600">
					このイラストの覚え方は{sharedCardCount}枚のカードで共有されています。
				</p>
			) : null}
			{!valid ? (
				<p className="text-sm text-amber-700">
					すべての項目を入力し、対応を2〜4件にすると保存できます。
				</p>
			) : null}
			<button
				type="submit"
				disabled={disabled || !valid}
				className="min-h-12 rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60"
			>
				覚え方を保存
			</button>
		</form>
	);
}

function MnemonicTextField({
	label,
	value,
	onChange,
	className,
}: {
	readonly label: string;
	readonly value: string;
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
				onChange={(event) => onChange(event.target.value)}
				className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100"
			/>
		</label>
	);
}

function RelationEditor({
	title,
	name,
	choices,
	selected,
	disabled,
	onSave,
}: {
	readonly title: string;
	readonly name: string;
	readonly choices: readonly { id: string; name: string }[] | null;
	readonly selected: readonly string[];
	readonly disabled: boolean;
	readonly onSave: (form: HTMLFormElement) => void;
}) {
	return (
		<form
			className="mt-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSave(event.currentTarget);
			}}
		>
			<fieldset disabled={disabled}>
				<legend className="text-sm font-medium">{title}</legend>
				<div className="mt-2 grid gap-1 sm:grid-cols-2">
					{choices === null ? (
						<p className="text-sm text-red-700">選択肢を取得できません。</p>
					) : choices.length === 0 ? (
						<p className="text-sm text-slate-500">選択肢がありません。</p>
					) : (
						choices.map((choice) => (
							<label
								key={choice.id}
								className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"
							>
								<input
									type="checkbox"
									name={name}
									value={choice.id}
									defaultChecked={selected.includes(choice.id)}
									className="h-5 w-5"
								/>
								{choice.name}
							</label>
						))
					)}
				</div>
			</fieldset>
			<button
				type="submit"
				disabled={disabled}
				className="mt-2 min-h-12 w-full rounded-lg border border-blue-600 px-4 font-semibold text-blue-700 disabled:opacity-60"
			>
				保存
			</button>
		</form>
	);
}
