import { createHash, randomUUID } from "node:crypto";

import { hashGenerationRequest, hashImportRequest } from "../../../../../frontend/src/lib/ai-import/canonical-request";
import { signPreviewToken, verifyPreviewToken } from "../../../../../frontend/src/lib/ai-import/preview-token";
import {
	buildCommitImportRpcArgs,
	type ClientDeckInput,
	type ClientImportItemInput,
	type ImportSource,
	type NormalizedImportRequest,
	validateImportRequest,
} from "../../../../../frontend/src/lib/ai-import/schema";
import {
	type S10Actor,
	type S10DbClient,
	S10_ACTORS,
	sqlLiteral,
} from "./s10-db-testkit";

type OwnedActor = S10Actor & { readonly userId: string };

export interface S10ContractPreparedWorkflow {
	readonly marker: string;
	readonly owner: OwnedActor;
	readonly source: ImportSource;
	readonly request: { readonly deck: ClientDeckInput; readonly items: readonly ClientImportItemInput[] };
	readonly normalized: NormalizedImportRequest;
	readonly importRequestHash: string;
	readonly generationRequestHash: string;
	readonly cardReservationKey: string;
	readonly idempotencyKey: string;
	readonly previewToken: string;
	readonly deckId: string;
}

export interface S10ContractCommittedWorkflow extends S10ContractPreparedWorkflow {
	readonly batchId: string;
}

export interface S10ContractFinalizeResult {
	readonly itemId: string;
	readonly batchId: string;
	readonly status: "finalized" | "failed";
	readonly cardId?: string;
	readonly errorCode?: string;
	readonly batchStatus: string;
}

export interface S10ContractSnapshot {
	readonly batches: readonly Readonly<Record<string, unknown>>[];
	readonly decks: readonly Readonly<Record<string, unknown>>[];
	readonly items: readonly {
		readonly id: string;
		readonly status: string;
		readonly deletedCardId: string | null;
	}[];
	readonly cards: readonly {
		readonly id: string;
		readonly ownerUserId: string;
		readonly cardKey: string;
	}[];
	readonly deckCards: readonly Readonly<Record<string, unknown>>[];
	readonly cardTags: readonly Readonly<Record<string, unknown>>[];
	readonly itemTags: readonly Readonly<Record<string, unknown>>[];
	readonly tags: readonly Readonly<Record<string, unknown>>[];
	readonly illustrations: readonly Readonly<Record<string, unknown>>[];
	readonly reservations: readonly {
		readonly kind: string;
		readonly source: string;
		readonly units: number;
		readonly status: string;
	}[];
	readonly usage: readonly {
		readonly generatedCardCount: number;
		readonly generatedImageCount: number;
	}[];
	readonly uploads: readonly { readonly id: string; readonly status: string }[];
}

interface PrepareOptions {
	readonly marker: string;
	readonly owner: OwnedActor;
	readonly source: ImportSource;
	readonly items?: readonly ClientImportItemInput[];
	readonly deck?: ClientDeckInput;
}

interface RunOptions extends PrepareOptions {}

interface ReservationOptions {
	readonly owner: OwnedActor;
	readonly marker: string;
	readonly units: number;
	readonly testNow?: string;
}

interface SqlOnlyReservationOptions extends ReservationOptions {
	readonly sqlOnly: true;
}

interface ReservationResult {
	readonly reservationId: string;
	readonly status: "reserved" | "exempt";
	readonly usageDate: string;
	readonly units: number;
}

const PREVIEW_SECRET = "s10-contract-preview-secret-with-at-least-32-bytes";
const PREVIEW_NOW = 2_000_000_000;

export function buildS10ContractItems(marker: string): ClientImportItemInput[] {
	const suffix = marker.slice(-20);
	return [
		{
			clientItemId: `r-${suffix}`,
			conceptId: `concept-${suffix}`,
			pattern: "R1",
			front: `漢字 ${marker}`,
			back: "かんじ",
			tags: [`読-${suffix}`],
			image: { mode: "none" },
		},
		{
			clientItemId: `w-${suffix}`,
			conceptId: `concept-${suffix}`,
			pattern: "W1",
			front: "かんじ",
			back: `漢字 ${marker}`,
			tags: [`書-${suffix}`],
			image: { mode: "none" },
		},
	];
}

export async function verifyS10ContractPreview(
	prepared: S10ContractPreparedWorkflow,
	previewToken = prepared.previewToken
): Promise<void> {
	await verifyPreviewToken(
		previewToken,
		{
			userId: prepared.owner.userId,
			reservationKey: prepared.cardReservationKey,
			importRequestHash: prepared.importRequestHash,
		},
		PREVIEW_SECRET,
		PREVIEW_NOW
	);
}

export async function prepareS10ContractWorkflow(
	client: S10DbClient,
	options: PrepareOptions
): Promise<S10ContractPreparedWorkflow> {
	const deck = options.deck ?? { create: { name: options.marker } };
	const items = [...(options.items ?? buildS10ContractItems(options.marker))];
	const request = { deck, items };
	const validated = await validateImportRequest(request);
	if (!validated.success) {
		throw new Error(`contract request failed validation: ${JSON.stringify(validated.issues)}`);
	}
	const importRequestHash = await hashImportRequest(request);
	const generationRequestHash = await hashGenerationRequest({
		input: { marker: options.marker },
		options: { source: options.source },
		requestedUnits: {
			cardGeneration: options.source === "app_ai" ? items.length : 0,
			illustrationConcept: items.filter(({ image }) => image.mode === "ai").length,
		},
	});
	const cardReservationKey = `card-${options.marker}`;
	const previewExpected = {
		userId: options.owner.userId,
		reservationKey: cardReservationKey,
		importRequestHash,
	};
	const previewToken = await signPreviewToken(previewExpected, PREVIEW_SECRET, PREVIEW_NOW);
	await verifyPreviewToken(previewToken, previewExpected, PREVIEW_SECRET, PREVIEW_NOW);
	await reserveCardUsage(client, {
		owner: options.owner,
		reservationKey: cardReservationKey,
		source: options.source,
		generationRequestHash,
		units: options.source === "app_ai" ? items.length : 0,
	});

	return {
		marker: options.marker,
		owner: options.owner,
		source: options.source,
		request,
		normalized: validated.data,
		importRequestHash,
		generationRequestHash,
		cardReservationKey,
		idempotencyKey: `import-${options.marker}`,
		previewToken,
		deckId: "",
	};
}

export async function commitS10ContractWorkflow(
	client: S10DbClient,
	prepared: S10ContractPreparedWorkflow
): Promise<{ readonly batchId: string; readonly status: string; readonly deckId: string }> {
	const args = buildCommitImportRpcArgs({
		context: {
			actorUserId: prepared.owner.userId,
			source: prepared.source,
			quotaPolicy: prepared.source === "app_ai" ? "consume" : "exempt",
		},
		idempotencyKey: prepared.idempotencyKey,
		importRequestHash: prepared.importRequestHash,
		cardReservationKey: prepared.cardReservationKey,
		request: prepared.normalized,
	});
	const rows = await client.query<{ result: { batchId: string; status: string } }>(`
		SELECT public.commit_import(
			${sqlLiteral(args.p_actor_user_id)}::uuid,
			${sqlLiteral(args.p_source)},
			${sqlLiteral(args.p_idempotency_key)},
			${sqlLiteral(args.p_import_request_hash)},
			${sqlLiteral(JSON.stringify(args.p_request))}::jsonb,
			${sqlLiteral(args.p_card_reservation_key)}
		) AS result
	`, { actor: S10_ACTORS.service });
	const result = rows[0]?.result;
	if (result === undefined) throw new Error("commit_import returned no result");
	const [batch] = await client.query<{ deckId: string }>(`
		SELECT target_deck_id::text AS "deckId"
		FROM public.ai_import_batches WHERE id=${sqlLiteral(result.batchId)}::uuid
	`);
	if (batch === undefined) throw new Error("committed batch readback failed");
	return { ...result, deckId: batch.deckId };
}

export async function runS10ContractWorkflow(
	client: S10DbClient,
	options: RunOptions
): Promise<{
	readonly prepared: S10ContractCommittedWorkflow;
	readonly finalizations: readonly S10ContractFinalizeResult[];
	readonly snapshot: S10ContractSnapshot;
}> {
	const prepared = await prepareS10ContractWorkflow(client, options);
	const committed = await commitS10ContractWorkflow(client, prepared);
	const committedWorkflow: S10ContractCommittedWorkflow = {
		...prepared,
		batchId: committed.batchId,
		deckId: committed.deckId,
	};
	const items = await client.query<{
		id: string;
		conceptId: string;
		imageMode: "none" | "ai" | "upload";
	}>(`
		SELECT id::text, concept_id AS "conceptId", image_mode AS "imageMode"
		FROM public.ai_import_items
		WHERE batch_id=${sqlLiteral(committed.batchId)}::uuid ORDER BY ordinal
	`);
	const finalizations: S10ContractFinalizeResult[] = [];
	for (const item of items) {
		let illustrationId: string | undefined;
		if (item.imageMode !== "none") {
			const reservationKey = `illustration-${options.marker}-${item.id.slice(0, 8)}`;
			await reserveIllustrationUsage(client, {
				owner: options.owner,
				reservationKey,
				source: options.source,
				generationRequestHash: prepared.generationRequestHash,
				units: item.imageMode === "ai" ? 1 : 0,
				batchId: committed.batchId,
				itemId: item.id,
				conceptId: item.conceptId,
			});
			illustrationId = randomUUID();
			await client.execute(`
				INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path)
				VALUES(
					${sqlLiteral(illustrationId)}::uuid,
					${sqlLiteral(options.owner.userId)}::uuid,
					${sqlLiteral(`contract-${options.marker}-${item.id}`)},
					'ready',
					${sqlLiteral(`${options.owner.userId}/${options.marker}-${item.id}.webp`)}
				)
			`);
		}
		finalizations.push(await finalizeS10ContractItem(
			client, options.owner, committed.batchId, item.id, { illustrationId }
		));
	}
	return {
		prepared: committedWorkflow,
		finalizations,
		snapshot: await captureS10ContractSnapshot(client, committed.batchId),
	};
}

export function finalizeS10ContractItem(
	client: S10DbClient,
	owner: OwnedActor,
	batchId: string,
	itemId: string,
	options: { readonly sqlOnly: true; readonly illustrationId?: string }
): string;
export function finalizeS10ContractItem(
	client: S10DbClient,
	owner: OwnedActor,
	batchId: string,
	itemId: string,
	options?: { readonly illustrationId?: string }
): Promise<S10ContractFinalizeResult>;
export function finalizeS10ContractItem(
	client: S10DbClient,
	owner: OwnedActor,
	batchId: string,
	itemId: string,
	options: { readonly sqlOnly?: boolean; readonly illustrationId?: string } = {}
): string | Promise<S10ContractFinalizeResult> {
	const sql = `SELECT public.finalize_import_item(
		${sqlLiteral(owner.userId)}::uuid,
		${sqlLiteral(batchId)}::uuid,
		${sqlLiteral(itemId)}::uuid,
		${options.illustrationId === undefined ? "NULL" : `${sqlLiteral(options.illustrationId)}::uuid`}
	) AS result`;
	if (options.sqlOnly === true) return sql;
	return querySingleJson<S10ContractFinalizeResult>(client, sql, S10_ACTORS.service);
}

export async function captureS10ContractSnapshot(
	client: S10DbClient,
	batchId: string
): Promise<S10ContractSnapshot> {
	const batchFilter = `${sqlLiteral(batchId)}::uuid`;
	const [batches, decks, items, cards, deckCards, cardTags, itemTags, tags, illustrations, reservations, usage, uploads] = await Promise.all([
		client.query<Record<string, unknown>>(`SELECT id::text,status,target_deck_id::text AS "deckId",auto_created_deck_id::text AS "autoCreatedDeckId",finalized_count AS "finalizedCount",failed_count AS "failedCount" FROM public.ai_import_batches WHERE id=${batchFilter}`),
		client.query<Record<string, unknown>>(`SELECT decks.id::text,decks.owner_user_id::text AS "ownerUserId",decks.name FROM public.decks AS decks JOIN public.ai_import_batches AS batches ON batches.target_deck_id=decks.id WHERE batches.id=${batchFilter}`),
		client.query<{ id: string; status: string; deletedCardId: string | null }>(`SELECT id::text,status,deleted_card_id::text AS "deletedCardId" FROM public.ai_import_items WHERE batch_id=${batchFilter} ORDER BY ordinal`),
		client.query<{ id: string; ownerUserId: string; cardKey: string }>(`SELECT cards.id::text,cards.owner_user_id::text AS "ownerUserId",cards.card_key AS "cardKey" FROM public.cards AS cards JOIN public.ai_import_items AS items ON items.result_card_id=cards.id WHERE items.batch_id=${batchFilter} ORDER BY items.ordinal`),
		client.query<Record<string, unknown>>(`SELECT relations.deck_id::text AS "deckId",relations.card_id::text AS "cardId" FROM public.deck_cards AS relations JOIN public.ai_import_items AS items ON items.result_card_id=relations.card_id WHERE items.batch_id=${batchFilter} ORDER BY relations.card_id`),
		client.query<Record<string, unknown>>(`SELECT relations.card_id::text AS "cardId",relations.tag_id::text AS "tagId" FROM public.card_tags AS relations JOIN public.ai_import_items AS items ON items.result_card_id=relations.card_id WHERE items.batch_id=${batchFilter} ORDER BY relations.card_id,relations.tag_id`),
		client.query<Record<string, unknown>>(`SELECT relations.item_id::text AS "itemId",relations.tag_id::text AS "tagId" FROM public.ai_import_item_tags AS relations JOIN public.ai_import_items AS items ON items.id=relations.item_id WHERE items.batch_id=${batchFilter} ORDER BY relations.item_id,relations.tag_id`),
		client.query<Record<string, unknown>>(`SELECT DISTINCT tags.id::text,tags.owner_user_id::text AS "ownerUserId",tags.display_name AS "displayName",tags.normalized_name AS "normalizedName" FROM public.tags AS tags JOIN public.ai_import_item_tags AS links ON links.tag_id=tags.id JOIN public.ai_import_items AS items ON items.id=links.item_id WHERE items.batch_id=${batchFilter} ORDER BY tags.id::text`),
		client.query<Record<string, unknown>>(`SELECT DISTINCT illustrations.id::text,illustrations.owner_user_id::text AS "ownerUserId",illustrations.illustration_key AS "illustrationKey",illustrations.status FROM public.illustrations AS illustrations JOIN public.cards AS cards ON cards.illustration_key=illustrations.illustration_key JOIN public.ai_import_items AS items ON items.result_card_id=cards.id WHERE items.batch_id=${batchFilter} ORDER BY illustrations.id::text`),
		client.query<{ kind: string; source: string; units: number; status: string }>(`SELECT kind,source,units,status FROM public.ai_quota_reservations WHERE batch_id=${batchFilter} ORDER BY kind,item_id NULLS FIRST`),
		client.query<{ generatedCardCount: number; generatedImageCount: number }>(`SELECT usage.generated_card_count AS "generatedCardCount",usage.generated_image_count AS "generatedImageCount" FROM public.ai_usage_daily AS usage JOIN public.ai_import_batches AS batches ON batches.owner_user_id=usage.owner_user_id WHERE batches.id=${batchFilter} ORDER BY usage.usage_date`),
		client.query<{ id: string; status: string }>(`SELECT uploads.id::text,uploads.status FROM public.ai_uploads AS uploads JOIN public.ai_import_items AS items ON items.upload_id=uploads.id WHERE items.batch_id=${batchFilter} ORDER BY uploads.id`),
	]);
	return { batches, decks, items, cards, deckCards, cardTags, itemTags, tags, illustrations, reservations, usage, uploads };
}

export async function createS10ContractUpload(
	client: S10DbClient,
	owner: OwnedActor,
	marker: string
): Promise<{ readonly uploadId: string; readonly storagePath: string }> {
	const storagePath = `${owner.userId}/${marker}.png`;
	const uploadKey = `upload-${marker}`;
	await client.execute(`
		INSERT INTO storage.objects(id,bucket_id,name,owner,owner_id,metadata)
		VALUES(
			${sqlLiteral(randomUUID())}::uuid,'illustrations',${sqlLiteral(storagePath)},
			${sqlLiteral(owner.userId)}::uuid,${sqlLiteral(owner.userId)},
			'{"mimetype":"image/png","size":1024}'::jsonb
		)
	`);
	const result = await querySingleJson<{ uploadId: string; status: string }>(client, `
		SELECT public.register_ai_upload(
			${sqlLiteral(owner.userId)}::uuid,${sqlLiteral(uploadKey)},'card_illustration',
			${sqlLiteral(storagePath)},'image/png',1024
		) AS result
	`, S10_ACTORS.service);
	return { uploadId: result.uploadId, storagePath };
}

export function reserveS10ContractUsage(
	client: S10DbClient,
	options: SqlOnlyReservationOptions
): string;
export function reserveS10ContractUsage(
	client: S10DbClient,
	options: ReservationOptions
): Promise<ReservationResult>;
export function reserveS10ContractUsage(
	client: S10DbClient,
	options: ReservationOptions & { readonly sqlOnly?: boolean }
): string | Promise<ReservationResult> {
	const generationHash = createHash("sha256").update(options.marker).digest("hex");
	const functionName = options.testNow === undefined
		? "public.reserve_provider_usage"
		: "public.reserve_provider_usage_internal";
	const clockArg = options.testNow === undefined ? "" : `,${sqlLiteral(options.testNow)}::timestamptz`;
	const sql = `SELECT ${functionName}(
		${sqlLiteral(options.owner.userId)}::uuid,${sqlLiteral(options.marker)},'card_generation','app_ai',
		${sqlLiteral(generationHash)},${options.units},NULL,NULL,NULL${clockArg}
	) AS result`;
	if (options.sqlOnly === true) return sql;
	return querySingleJson<ReservationResult>(
		client,
		sql,
		options.testNow === undefined ? S10_ACTORS.service : undefined
	);
}

export async function undoS10ContractWorkflow(
	client: S10DbClient,
	owner: OwnedActor,
	batchId: string
): Promise<{
	readonly status: string;
	readonly deletedCardCount: number;
	readonly deletedSkipCount: number;
	readonly autoDeckStatus: string;
}> {
	return await querySingleJson(client, `SELECT public.undo_import(${sqlLiteral(batchId)}::uuid) AS result`, owner);
}

export async function cleanupS10ContractMarker(
	client: S10DbClient,
	marker: string
): Promise<void> {
	const likeMarker = sqlLiteral(`%${marker}%`);
	await client.execute(`
		CREATE TEMP TABLE s10_cleanup_usage_delta ON COMMIT DROP AS
		SELECT
			owner_user_id,
			usage_date,
			coalesce(sum(units) FILTER (
				WHERE kind='card_generation' AND status='reserved'
			), 0)::integer AS card_units,
			coalesce(sum(units) FILTER (
				WHERE kind='illustration_concept' AND status='reserved'
			), 0)::integer AS image_units
		FROM public.ai_quota_reservations
		WHERE reservation_key LIKE ${likeMarker}
		GROUP BY owner_user_id, usage_date;
		UPDATE public.ai_usage_daily AS usage
		SET
			generated_card_count = usage.generated_card_count - delta.card_units,
			generated_image_count = usage.generated_image_count - delta.image_units,
			updated_at = now()
		FROM s10_cleanup_usage_delta AS delta
		WHERE usage.owner_user_id=delta.owner_user_id
			AND usage.usage_date=delta.usage_date;
		DELETE FROM public.study_sessions WHERE deck_id IN (
			SELECT id FROM public.decks WHERE name LIKE ${likeMarker}
		);
		DELETE FROM public.cards WHERE visibility='private' AND (
			front_text LIKE ${likeMarker} OR back_text LIKE ${likeMarker} OR id IN (
				SELECT items.result_card_id
				FROM public.ai_import_items AS items
				JOIN public.ai_import_batches AS batches ON batches.id=items.batch_id
				WHERE batches.idempotency_key LIKE ${likeMarker}
			)
		);
		DELETE FROM public.tags WHERE id IN (
			SELECT links.tag_id
			FROM public.ai_import_item_tags AS links
			JOIN public.ai_import_items AS items ON items.id=links.item_id
			JOIN public.ai_import_batches AS batches ON batches.id=items.batch_id
			WHERE batches.idempotency_key LIKE ${likeMarker}
		);
		DELETE FROM public.ai_import_batches WHERE idempotency_key LIKE ${likeMarker};
		DELETE FROM public.ai_quota_reservations WHERE reservation_key LIKE ${likeMarker};
		DELETE FROM public.ai_usage_daily AS usage
		USING s10_cleanup_usage_delta AS delta
		WHERE usage.owner_user_id=delta.owner_user_id
			AND usage.usage_date=delta.usage_date
			AND usage.generated_card_count=0
			AND usage.generated_image_count=0;
		DELETE FROM public.illustrations WHERE illustration_key LIKE ${likeMarker} OR storage_path LIKE ${likeMarker};
		DELETE FROM public.ai_uploads WHERE upload_key LIKE ${likeMarker} OR storage_path LIKE ${likeMarker};
		SET LOCAL storage.allow_delete_query='true';
		DELETE FROM storage.objects WHERE bucket_id='illustrations' AND name LIKE ${likeMarker};
		DELETE FROM public.tags WHERE display_name LIKE ${likeMarker} OR normalized_name LIKE ${likeMarker};
		DELETE FROM public.decks WHERE name LIKE ${likeMarker};
	`);
}

async function reserveCardUsage(
	client: S10DbClient,
	params: {
		readonly owner: OwnedActor;
		readonly reservationKey: string;
		readonly source: ImportSource;
		readonly generationRequestHash: string;
		readonly units: number;
	}
): Promise<ReservationResult> {
	return await querySingleJson(client, `SELECT public.reserve_provider_usage(
		${sqlLiteral(params.owner.userId)}::uuid,${sqlLiteral(params.reservationKey)},
		'card_generation',${sqlLiteral(params.source)},${sqlLiteral(params.generationRequestHash)},
		${params.units},NULL,NULL,NULL
	) AS result`, S10_ACTORS.service);
}

async function reserveIllustrationUsage(
	client: S10DbClient,
	params: {
		readonly owner: OwnedActor;
		readonly reservationKey: string;
		readonly source: ImportSource;
		readonly generationRequestHash: string;
		readonly units: number;
		readonly batchId: string;
		readonly itemId: string;
		readonly conceptId: string;
	}
): Promise<ReservationResult> {
	return await querySingleJson(client, `SELECT public.reserve_provider_usage(
		${sqlLiteral(params.owner.userId)}::uuid,${sqlLiteral(params.reservationKey)},
		'illustration_concept',${sqlLiteral(params.source)},${sqlLiteral(params.generationRequestHash)},
		${params.units},${sqlLiteral(params.batchId)}::uuid,${sqlLiteral(params.itemId)}::uuid,
		${sqlLiteral(params.conceptId)}
	) AS result`, S10_ACTORS.service);
}

async function querySingleJson<T>(
	client: S10DbClient,
	sql: string,
	actor?: S10Actor
): Promise<T> {
	const rows = await client.query<{ result: T }>(sql, actor === undefined ? undefined : { actor });
	const result = rows[0]?.result;
	if (result === undefined) throw new Error("S-10 contract primitive returned no result");
	return result;
}
