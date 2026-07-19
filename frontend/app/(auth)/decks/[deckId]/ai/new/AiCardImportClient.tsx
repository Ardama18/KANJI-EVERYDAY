"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AiCardForm, { type AiCardFormSubmission } from "@/components/ai-card-import/AiCardForm";
import DraftCardList from "@/components/ai-card-import/DraftCardList";
import ImportStatus from "@/components/ai-card-import/ImportStatus";
import WarningConfirmation from "@/components/ai-card-import/WarningConfirmation";
import {
	type AiCardImportFocusTarget,
	focusAiCardImportTarget,
} from "@/lib/ai-card-generation/focus-target";
import { safeCodeMessage } from "@/lib/ai-card-generation/safe-code-message";
import {
	type ImportStatusResponse,
	parseCommitAsyncResponse,
	parseImportStatusResponse,
} from "@/lib/ai-import/async-contract";
import type {
	ClientImageInput,
	ClientImportItemInput,
	ClientImportRequestInput,
} from "@/lib/ai-import/schema";
import {
	STATUS_CHANNEL_NAME,
	batchPointerKey,
	nextPollDelay,
	parseBatchPointer,
	selectStatusLeader,
	serializeBatchPointer,
} from "@/lib/ai-import/status-poller";
import { createBrowserClient } from "@/lib/supabase/client";

interface AiCardImportClientProps {
	readonly deckId: string;
}
interface ClientPreview {
	readonly importRequestHash: string;
	readonly previewToken: string;
	readonly previewExpiresAt: number;
	readonly cardReservationKey: string;
}

export default function AiCardImportClient({ deckId }: AiCardImportClientProps) {
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string>();
	const [sourceUploadIds, setSourceUploadIds] = useState<readonly string[]>([]);
	const [request, setRequest] = useState<ClientImportRequestInput>();
	const [preview, setPreview] = useState<ClientPreview>();
	const [confirmed, setConfirmed] = useState(false);
	const [cardReservationKey, setCardReservationKey] = useState<string>();
	const [batchId, setBatchId] = useState<string>();
	const [batchResult, setBatchResult] = useState<ImportStatusResponse>();
	const [requiredIllustrationConceptIds, setRequiredIllustrationConceptIds] = useState<
		readonly string[]
	>([]);
	const generationAttemptRef = useRef<{ readonly fingerprint: string; readonly key: string }>();
	const commitIdempotencyKeyRef = useRef<string>();
	const statusAbortRef = useRef<AbortController>();
	const statusSequenceRef = useRef(0);
	const statusChannelRef = useRef<BroadcastChannel>();
	const terminalBatchRef = useRef<string>();
	const tabIdRef = useRef(crypto.randomUUID());
	const focusSequenceRef = useRef(0);
	const [focusRequest, setFocusRequest] = useState<{
		readonly target: AiCardImportFocusTarget;
		readonly sequence: number;
	}>();

	const requestFocus = useCallback((target: AiCardImportFocusTarget): void => {
		focusSequenceRef.current += 1;
		setFocusRequest({ target, sequence: focusSequenceRef.current });
	}, []);

	useEffect(() => {
		if (focusRequest === undefined) return;
		focusAiCardImportTarget(focusRequest.target);
	}, [focusRequest]);

	async function uploadSources(
		files: readonly File[],
		usageScope: "generation_source" | "card_illustration"
	): Promise<readonly string[]> {
		if (files.length === 0) return [];
		const prepareResponse = await fetch("/api/ai/imports/sources/prepare", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				usageScope,
				sources: files.map((file) => ({
					uploadKey: crypto.randomUUID(),
					declaredMime: file.type,
					byteSize: file.size,
				})),
			}),
		});
		const prepared: unknown = await prepareResponse.json();
		const uploads = parsePreparedUploads(prepared);
		if (!prepareResponse.ok) throw new Error(readSafeCode(prepared) ?? "SOURCE_PREPARE_FAILED");
		if (uploads === undefined || uploads.length !== files.length)
			throw new Error("SOURCE_PREPARE_FAILED");
		const supabase = createBrowserClient();
		try {
			for (const [index, upload] of uploads.entries()) {
				const file = files[index];
				if (file === undefined) throw new Error("SOURCE_PREPARE_FAILED");
				const { error } = await supabase.storage
					.from("ai-card-sources")
					.uploadToSignedUrl(upload.path, upload.token, file);
				if (error !== null) throw new Error("SOURCE_WRITE_FAILED");
				const completeResponse = await fetch("/api/ai/imports/sources/complete", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ uploadId: upload.uploadId }),
				});
				const completed: unknown = await completeResponse.json();
				if (!completeResponse.ok)
					throw new Error(readSafeCode(completed) ?? "SOURCE_FINALIZE_FAILED");
			}
		} catch (error) {
			if (usageScope === "generation_source")
				await releaseSourceUploads(uploads.map((upload) => upload.uploadId));
			throw error;
		}
		return uploads.map((upload) => upload.uploadId);
	}

	async function generate(value: AiCardFormSubmission): Promise<void> {
		setBusy(true);
		setStatus("教材画像を準備しています。");
		try {
			const fingerprint = generationFingerprint(value);
			const generationReservationKey =
				generationAttemptRef.current?.fingerprint === fingerprint
					? generationAttemptRef.current.key
					: value.generationReservationKey;
			generationAttemptRef.current = { fingerprint, key: generationReservationKey };
			const uploadIds = await uploadSources(value.sourceFiles, "generation_source");
			setSourceUploadIds(uploadIds);
			setStatus("カード案を生成しています。");
			const response = await fetch("/api/ai/card-drafts/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...value,
					generationReservationKey,
					sourceFiles: undefined,
					sourceUploadIds: uploadIds,
				}),
			});
			const result: unknown = await response.json();
			if (!response.ok) throw new Error(readSafeCode(result) ?? "INTERNAL_ERROR");
			const generated = parseGeneratedResult(result);
			if (generated === undefined) throw new Error("INTERNAL_ERROR");
			setRequest(generated.request);
			setPreview(generated.preview);
			setCardReservationKey(generationReservationKey);
			setRequiredIllustrationConceptIds(generated.requiresIllustrationUploads);
			commitIdempotencyKeyRef.current = crypto.randomUUID();
			setConfirmed(false);
			setStatus(
				generated.preview === undefined
					? "カード案を生成しました。concept共有画像を準備して再確認してください。"
					: "カード案を生成しました。全カードを確認してください。"
			);
			requestFocus("draft");
		} catch (error) {
			setStatus(safeMessage(error));
		} finally {
			setBusy(false);
		}
	}

	async function cancel(): Promise<void> {
		if (sourceUploadIds.length > 0) {
			await fetch("/api/ai/card-drafts/sources/release", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ uploadIds: sourceUploadIds }),
			});
			setSourceUploadIds([]);
		}
		setRequest(undefined);
		setPreview(undefined);
		setCardReservationKey(undefined);
		setConfirmed(false);
		setRequiredIllustrationConceptIds([]);
		generationAttemptRef.current = undefined;
		commitIdempotencyKeyRef.current = undefined;
		setStatus("作成を取り消しました。教材画像は削除処理へ移しました。");
	}

	function mutateItems(items: readonly ClientImportItemInput[]): void {
		if (request === undefined) return;
		setRequest({ ...request, items: [...items] });
		setPreview(undefined);
		setConfirmed(false);
	}

	async function uploadIllustration(conceptId: string, file: File): Promise<void> {
		if (request === undefined) return;
		setBusy(true);
		setStatus("カード用画像を準備しています。");
		try {
			const [uploadId] = await uploadSources([file], "card_illustration");
			if (uploadId === undefined) throw new Error("SOURCE_FINALIZE_FAILED");
			mutateItems(
				request.items.map((item) =>
					item.conceptId === conceptId ? { ...item, image: { mode: "upload", uploadId } } : item
				)
			);
			setStatus("共有画像を準備しました。変更後を再確認してください。");
		} catch (error) {
			setStatus(safeMessage(error));
		} finally {
			setBusy(false);
		}
	}

	async function rePreview(): Promise<void> {
		if (request === undefined || request.items.length === 0) {
			setStatus("登録するカードを1枚以上残してください。");
			return;
		}
		const required = new Set(requiredIllustrationConceptIds);
		const missing = [...new Set(request.items.map((item) => item.conceptId))].find(
			(conceptId) =>
				required.has(conceptId) &&
				request.items.some((item) => item.conceptId === conceptId && item.image.mode !== "upload")
		);
		if (missing !== undefined) {
			setStatus(`${missing} の共有画像を選択してください。`);
			return;
		}
		const reservationKey = preview?.cardReservationKey ?? cardReservationKey;
		if (reservationKey === undefined) {
			setStatus("生成情報を確認できません。再生成してください。");
			return;
		}
		setBusy(true);
		try {
			const response = await fetch("/api/ai/imports/preview", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ request, cardReservationKey: reservationKey }),
			});
			const value: unknown = await response.json();
			if (!response.ok) throw new Error(readSafeCode(value) ?? "VALIDATION_ERROR");
			const generated = parseGeneratedResult(value);
			if (generated?.preview === undefined) throw new Error("INTERNAL_ERROR");
			setRequest(generated.request);
			setPreview(generated.preview);
			setCardReservationKey(generated.preview.cardReservationKey);
			setConfirmed(false);
			setStatus("変更後のカードを再確認しました。");
			requestFocus("draft");
		} catch (error) {
			setStatus(safeMessage(error));
		} finally {
			setBusy(false);
		}
	}

	async function commit(): Promise<void> {
		if (request === undefined || preview === undefined || !confirmed) return;
		setBusy(true);
		setStatus("カードを登録キューへ送信しています。");
		try {
			const idempotencyKey = commitIdempotencyKeyRef.current ?? crypto.randomUUID();
			commitIdempotencyKeyRef.current = idempotencyKey;
			const response = await fetch("/api/ai/imports/commit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					request,
					importRequestHash: preview.importRequestHash,
					previewToken: preview.previewToken,
					cardReservationKey: preview.cardReservationKey,
					idempotencyKey,
					confirmedWarnings: true,
				}),
			});
			const value: unknown = await response.json();
			const committed = parseCommitAsyncResponse(value);
			if (!response.ok || committed === undefined)
				throw new Error(readSafeCode(value) ?? "INTERNAL_ERROR");
			localStorage.setItem(
				batchPointerKey(deckId),
				serializeBatchPointer({ version: 1, deckId, batchId: committed.batchId })
			);
			setBatchId(committed.batchId);
			setRequest(undefined);
			setPreview(undefined);
			setCardReservationKey(undefined);
			setConfirmed(false);
			setRequiredIllustrationConceptIds([]);
			generationAttemptRef.current = undefined;
			commitIdempotencyKeyRef.current = undefined;
			setStatus("登録処理を開始しました。");
			requestFocus("status");
		} catch (error) {
			setStatus(safeMessage(error));
		} finally {
			setBusy(false);
		}
	}

	const applyBatchStatus = useCallback(
		(parsed: ImportStatusResponse, currentBatchId: string): void => {
			if (
				terminalBatchRef.current === currentBatchId &&
				nextPollDelay(30_000, parsed.status) !== undefined
			)
				return;
			setBatchResult(parsed);
			if (nextPollDelay(30_000, parsed.status) === undefined) {
				terminalBatchRef.current = currentBatchId;
				localStorage.removeItem(batchPointerKey(deckId));
				setBatchId(undefined);
				setStatus(`登録処理が${parsed.status}になりました。`);
				requestFocus("status");
			}
		},
		[deckId, requestFocus]
	);

	const refreshStatus = useCallback(async (): Promise<void> => {
		if (batchId === undefined) return;
		statusAbortRef.current?.abort();
		const controller = new AbortController();
		statusAbortRef.current = controller;
		const sequence = ++statusSequenceRef.current;
		try {
			const response = await fetch(
				`/api/ai/imports/status?batchId=${encodeURIComponent(batchId)}`,
				{
					signal: controller.signal,
				}
			);
			if (sequence !== statusSequenceRef.current) return;
			const value: unknown = await response.json();
			if (response.status === 401 || response.status === 404) {
				localStorage.removeItem(batchPointerKey(deckId));
				setBatchId(undefined);
				return;
			}
			if (!response.ok) return;
			const parsed = parseImportStatusResponse(value);
			if (parsed === undefined) return;
			applyBatchStatus(parsed, batchId);
			statusChannelRef.current?.postMessage({ type: "status", batchId, value: parsed });
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			setStatus("状況取得に失敗しました。5秒後に再試行します。");
		}
	}, [applyBatchStatus, batchId, deckId]);

	useEffect(() => {
		const stored = localStorage.getItem(batchPointerKey(deckId));
		if (stored === null) return;
		const pointer = parseBatchPointer(stored, deckId);
		if (pointer === undefined) localStorage.removeItem(batchPointerKey(deckId));
		else setBatchId(pointer.batchId);
	}, [deckId]);

	useEffect(() => {
		if (batchId === undefined) return;
		const startedAt = Date.now();
		let timer: ReturnType<typeof setTimeout>;
		let cancelled = false;
		const peers = new Map<
			string,
			{ readonly id: string; readonly visible: boolean; readonly heartbeatAt: number }
		>();
		const channel =
			typeof BroadcastChannel === "undefined"
				? undefined
				: new BroadcastChannel(STATUS_CHANNEL_NAME);
		statusChannelRef.current = channel;
		const heartbeat = () => {
			const peer = {
				id: tabIdRef.current,
				visible: document.visibilityState === "visible",
				heartbeatAt: Date.now(),
			};
			peers.set(peer.id, peer);
			channel?.postMessage({ type: "heartbeat", batchId, ...peer });
		};
		if (channel !== undefined) {
			channel.onmessage = (event: MessageEvent<unknown>) => {
				if (!isRecord(event.data) || event.data.batchId !== batchId) return;
				if (
					event.data.type === "heartbeat" &&
					typeof event.data.id === "string" &&
					typeof event.data.visible === "boolean" &&
					typeof event.data.heartbeatAt === "number"
				)
					peers.set(event.data.id, {
						id: event.data.id,
						visible: event.data.visible,
						heartbeatAt: event.data.heartbeatAt,
					});
				if (event.data.type === "status") {
					const parsed = parseImportStatusResponse(event.data.value);
					if (parsed !== undefined) applyBatchStatus(parsed, batchId);
				}
			};
		}
		heartbeat();
		const heartbeatTimer = setInterval(heartbeat, 3_000);
		const poll = async () => {
			const leader = selectStatusLeader([...peers.values()], Date.now());
			if (channel === undefined || leader === tabIdRef.current) await refreshStatus();
			if (!cancelled)
				timer = setTimeout(() => void poll(), Date.now() - startedAt < 30_000 ? 2_000 : 5_000);
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
			clearInterval(heartbeatTimer);
			statusAbortRef.current?.abort();
			channel?.close();
			if (statusChannelRef.current === channel) statusChannelRef.current = undefined;
		};
	}, [applyBatchStatus, batchId, refreshStatus]);

	return (
		<section className="mt-6" aria-labelledby="ai-card-safety-heading" data-deck-id={deckId}>
			<h2 id="ai-card-safety-heading" className="text-lg font-semibold text-slate-900">
				作成前の確認
			</h2>
			<ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
				<li>AIの出力には誤りがあり得ます。表・裏・読みを確認してください。</li>
				<li>氏名、住所、連絡先などの個人情報を入力しないでください。</li>
				<li>教材画像と生成内容の著作権・利用権限を確認してください。</li>
			</ul>
			{request === undefined && batchId === undefined && batchResult === undefined ? (
				<AiCardForm deckId={deckId} disabled={busy} onSubmit={generate} onCancel={cancel} />
			) : null}
			{request !== undefined ? (
				<>
					<DraftCardList
						items={request.items}
						onChange={mutateItems}
						onIllustration={uploadIllustration}
						requiredIllustrationConceptIds={requiredIllustrationConceptIds}
						disabled={busy}
					/>
					<WarningConfirmation
						confirmed={confirmed}
						onChange={setConfirmed}
						previewValid={preview !== undefined}
						committing={busy}
						onPreview={rePreview}
						onCommit={commit}
					/>
				</>
			) : null}
			<ImportStatus
				result={batchResult}
				tracking={batchId !== undefined}
				onRefresh={refreshStatus}
			/>
			<p className="mt-4 min-h-6 break-words text-sm text-slate-700" aria-live="polite">
				{status}
			</p>
		</section>
	);
}

function parsePreparedUploads(
	value: unknown
):
	| readonly { readonly uploadId: string; readonly path: string; readonly token: string }[]
	| undefined {
	if (!isRecord(value) || !Array.isArray(value.uploads)) return undefined;
	const uploads: { uploadId: string; path: string; token: string }[] = [];
	for (const upload of value.uploads) {
		if (
			!isRecord(upload) ||
			typeof upload.uploadId !== "string" ||
			typeof upload.path !== "string" ||
			typeof upload.token !== "string"
		)
			return undefined;
		uploads.push({ uploadId: upload.uploadId, path: upload.path, token: upload.token });
	}
	return uploads;
}
function parseGeneratedResult(value: unknown):
	| {
			readonly request: ClientImportRequestInput;
			readonly preview?: ClientPreview;
			readonly requiresIllustrationUploads: readonly string[];
	  }
	| undefined {
	if (!isRecord(value)) return undefined;
	const request = parseClientRequest(value.request);
	if (request === undefined) return undefined;
	if (
		typeof value.previewToken === "string" &&
		typeof value.importRequestHash === "string" &&
		typeof value.previewExpiresAt === "number" &&
		typeof value.cardReservationKey === "string"
	)
		return {
			request,
			requiresIllustrationUploads: [],
			preview: {
				previewToken: value.previewToken,
				importRequestHash: value.importRequestHash,
				previewExpiresAt: value.previewExpiresAt,
				cardReservationKey: value.cardReservationKey,
			},
		};
	if (
		Array.isArray(value.requiresIllustrationUploads) &&
		value.requiresIllustrationUploads.every((conceptId) => typeof conceptId === "string")
	)
		return { request, requiresIllustrationUploads: value.requiresIllustrationUploads };
	return undefined;
}

async function releaseSourceUploads(uploadIds: readonly string[]): Promise<void> {
	if (uploadIds.length === 0) return;
	try {
		await fetch("/api/ai/card-drafts/sources/release", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ uploadIds }),
		});
	} catch {
		// The database cleanup deadline remains the durable fallback.
	}
}

function generationFingerprint(value: AiCardFormSubmission): string {
	return JSON.stringify({
		instruction: value.instruction,
		pattern: value.pattern,
		requestedCardCount: value.requestedCardCount,
		tags: value.tags,
		illustration: value.illustration,
		sources: value.sourceFiles.map((file) => [file.name, file.type, file.size, file.lastModified]),
	});
}
function parseClientRequest(value: unknown): ClientImportRequestInput | undefined {
	if (
		!isRecord(value) ||
		!isRecord(value.deck) ||
		typeof value.deck.id !== "string" ||
		!Array.isArray(value.items)
	)
		return undefined;
	const items: ClientImportItemInput[] = [];
	for (const raw of value.items) {
		if (
			!isRecord(raw) ||
			typeof raw.clientItemId !== "string" ||
			typeof raw.conceptId !== "string" ||
			(raw.pattern !== "R1" && raw.pattern !== "W1") ||
			typeof raw.front !== "string" ||
			typeof raw.back !== "string" ||
			!Array.isArray(raw.tags) ||
			raw.tags.some((tag) => typeof tag !== "string")
		)
			return undefined;
		const image = parseImage(raw.image);
		if (image === undefined) return undefined;
		items.push({
			clientItemId: raw.clientItemId,
			conceptId: raw.conceptId,
			pattern: raw.pattern,
			front: raw.front,
			back: raw.back,
			tags: raw.tags as string[],
			image,
		});
	}
	return { deck: { id: value.deck.id }, items };
}
function parseImage(value: unknown): ClientImageInput | undefined {
	if (!isRecord(value)) return undefined;
	if (value.mode === "none" || value.mode === "ai") return { mode: value.mode };
	if (value.mode === "upload" && typeof value.uploadId === "string")
		return { mode: "upload", uploadId: value.uploadId };
	return undefined;
}
function readSafeCode(value: unknown): string | undefined {
	return isRecord(value) && isRecord(value.error) && typeof value.error.code === "string"
		? value.error.code
		: undefined;
}
function safeMessage(error: unknown): string {
	const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
	return safeCodeMessage(code);
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
