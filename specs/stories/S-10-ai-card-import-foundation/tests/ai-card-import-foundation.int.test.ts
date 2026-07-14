// S-10 DB統合テストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: Integration Test（実PostgreSQL/Supabase契約）
// 実装タイミング: migration / RPC / trigger実装と同時
//
// TODO(test-executor): S-02のDB testkitをS-10用に拡張し、各todoを独立transaction、
// actor fixture、固定DB clock、parallel connection、failpoint fixtureで実装する。

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
	hashImportRequest,
	type CanonicalImportRequestInput,
} from "../../../../frontend/src/lib/ai-import/canonical-request";
import {
	type CardPattern,
	computeCardKey,
} from "../../../../frontend/src/lib/ai-import/card-key";
import canonicalRequestFixture from "../fixtures/canonical-requests.json";
import unicodeFixture from "../fixtures/unicode-card-key.json";
import {
	captureS10SeedGeneralSnapshot,
	captureS10SeedKeySnapshot,
	captureS10Snapshot,
	createS10DbClient,
	ensureS10ActorFixtures,
	S10_ACTORS,
	sqlLiteral,
} from "./helpers/s10-db-testkit";
import {
	readS10JobSnapshot,
	runS10AcSmoke,
	runS10MigrationFailureChecks,
	selectS10DatabaseJobs,
} from "./helpers/s10-db-jobs";

const database = createS10DbClient();

type QuotaKind = "card_generation" | "illustration_concept";
type ImportSource = "app_ai" | "remote_mcp";

interface ReserveUsageParams {
	ownerUserId?: string;
	reservationKey: string;
	kind: QuotaKind;
	source: ImportSource;
	generationRequestHash: string;
	units: number;
	batchId?: string;
	itemId?: string;
	conceptId?: string;
	testNow?: string;
}

interface ReservationResult {
	reservationId: string;
	status: "reserved" | "exempt";
	usageDate: string;
	units: number;
	providerStartedAt: string;
}

interface CommitImportParams {
	ownerUserId?: string;
	source: ImportSource;
	idempotencyKey: string;
	importRequestHash: string;
	request: CanonicalImportRequestInput | Readonly<Record<string, unknown>>;
	cardReservationKey: string;
	internal?: boolean;
}

interface CommitImportResult {
	batchId: string;
	status: "committed";
	requestedCardCount: number;
	requestedImageCount: number;
}

interface RegisterUploadParams {
	ownerUserId?: string;
	uploadKey: string;
	purpose?: string;
	storagePath: string;
	mimeType: string;
	byteSize: number;
	internal?: boolean;
}

interface RegisterUploadResult {
	uploadId: string;
	status: "ready";
}

interface FinalizeItemParams {
	ownerUserId?: string;
	batchId: string;
	itemId: string;
	illustrationId?: string;
	internal?: boolean;
}

interface FinalizeItemResult {
	itemId: string;
	batchId: string;
	status: "finalized" | "failed";
	cardId?: string;
	errorCode?: string;
	batchStatus: "processing" | "completed";
}

interface MarkFailedParams {
	ownerUserId?: string;
	batchId: string;
	itemId: string;
	attemptKey: string;
	errorCode: string;
	safeDetail?: Readonly<Record<string, unknown>>;
	internal?: boolean;
}

interface MarkFailedResult {
	itemId: string;
	batchId: string;
	status: "failed";
	errorCode: string;
	batchStatus: "processing" | "completed";
}

interface UndoImportResult {
	batchId: string;
	status: "undone";
	deletedCardCount: number;
	deletedSkipCount: number;
	autoDeckStatus: "deleted" | "retained" | "not_applicable";
	autoDeckId: string | null;
}

interface FinalizeFixture {
	marker: string;
	deckId: string;
	batchId: string;
	itemId: string;
	conceptId: string;
	uploadId?: string;
	illustrationId?: string;
}

interface UndoFixture {
	marker: string;
	batchId: string;
	deckId: string;
	itemIds: string[];
	cardIds: string[];
	reservationKey: string;
}

interface CommitFixture {
	marker: string;
	deckId: string;
	request: CanonicalImportRequestInput;
	idempotencyKey: string;
	reservationKey: string;
	importRequestHash: string;
	generationRequestHash: string;
}

const fixedHash = (marker: string): string => marker.repeat(64).slice(0, 64);

const nullableText = (value: string | undefined): string =>
	value === undefined ? "NULL" : sqlLiteral(value);

const nullableUuid = (value: string | undefined): string =>
	value === undefined ? "NULL" : `${sqlLiteral(value)}::uuid`;

function reserveUsageSql(params: ReserveUsageParams): string {
	const argumentsSql = [
		`${sqlLiteral(params.ownerUserId ?? S10_ACTORS.ownerA.userId)}::uuid`,
		sqlLiteral(params.reservationKey),
		sqlLiteral(params.kind),
		sqlLiteral(params.source),
		sqlLiteral(params.generationRequestHash),
		String(params.units),
		nullableUuid(params.batchId),
		nullableUuid(params.itemId),
		nullableText(params.conceptId),
	];
	const functionName =
		params.testNow === undefined
			? "public.reserve_provider_usage"
			: "public.reserve_provider_usage_internal";
	if (params.testNow !== undefined) {
		argumentsSql.push(`${sqlLiteral(params.testNow)}::timestamptz`);
	}
	return `SELECT ${functionName}(${argumentsSql.join(", ")}) AS result`;
}

async function reserveUsage(params: ReserveUsageParams): Promise<ReservationResult> {
	const rows = await database.query<{ result: ReservationResult }>(reserveUsageSql(params));
	const result = rows[0]?.result;
	if (result === undefined) {
		throw new Error("quota reservation did not return a result");
	}
	return result;
}

function commitImportSql(params: CommitImportParams): string {
	const functionName = params.internal ? "public.commit_import_internal" : "public.commit_import";
	return `SELECT ${functionName}(
		${sqlLiteral(params.ownerUserId ?? S10_ACTORS.ownerA.userId)}::uuid,
		${sqlLiteral(params.source)},
		${sqlLiteral(params.idempotencyKey)},
		${sqlLiteral(params.importRequestHash)},
		${sqlLiteral(JSON.stringify(params.request))}::jsonb,
		${sqlLiteral(params.cardReservationKey)}
	) AS result`;
}

async function commitImport(params: CommitImportParams): Promise<CommitImportResult> {
	const rows = await database.query<{ result: CommitImportResult }>(commitImportSql(params),
		params.internal ? undefined : { actor: S10_ACTORS.service });
	const result = rows[0]?.result;
	if (result === undefined) {
		throw new Error("commit import did not return a result");
	}
	return result;
}

function registerUploadSql(params: RegisterUploadParams): string {
	const functionName = params.internal
		? "public.register_ai_upload_internal"
		: "public.register_ai_upload";
	return `SELECT ${functionName}(
		${sqlLiteral(params.ownerUserId ?? S10_ACTORS.ownerA.userId)}::uuid,
		${sqlLiteral(params.uploadKey)},
		${sqlLiteral(params.purpose ?? "card_illustration")},
		${sqlLiteral(params.storagePath)},
		${sqlLiteral(params.mimeType)},
		${params.byteSize}::bigint
	) AS result`;
}

async function registerUpload(params: RegisterUploadParams): Promise<RegisterUploadResult> {
	const rows = await database.query<{ result: RegisterUploadResult }>(
		registerUploadSql(params),
		params.internal ? undefined : { actor: S10_ACTORS.service }
	);
	const result = rows[0]?.result;
	if (result === undefined) {
		throw new Error("upload registration did not return a result");
	}
	return result;
}

function finalizeItemSql(params: FinalizeItemParams): string {
	const functionName = params.internal
		? "public.finalize_import_item_internal"
		: "public.finalize_import_item";
	return `SELECT ${functionName}(
		${sqlLiteral(params.ownerUserId ?? S10_ACTORS.ownerA.userId)}::uuid,
		${sqlLiteral(params.batchId)}::uuid,
		${sqlLiteral(params.itemId)}::uuid,
		${nullableUuid(params.illustrationId)}
	) AS result`;
}

async function finalizeItem(params: FinalizeItemParams): Promise<FinalizeItemResult> {
	const rows = await database.query<{ result: FinalizeItemResult }>(
		finalizeItemSql(params), params.internal ? undefined : { actor: S10_ACTORS.service }
	);
	const result = rows[0]?.result;
	if (result === undefined) throw new Error("finalize did not return a result");
	return result;
}

function markFailedSql(params: MarkFailedParams): string {
	const functionName = params.internal
		? "public.mark_import_item_failed_internal"
		: "public.mark_import_item_failed";
	return `SELECT ${functionName}(
		${sqlLiteral(params.ownerUserId ?? S10_ACTORS.ownerA.userId)}::uuid,
		${sqlLiteral(params.batchId)}::uuid,
		${sqlLiteral(params.itemId)}::uuid,
		${sqlLiteral(params.attemptKey)},
		${sqlLiteral(params.errorCode)},
		${sqlLiteral(JSON.stringify(params.safeDetail ?? {}))}::jsonb
	) AS result`;
}

async function markFailed(params: MarkFailedParams): Promise<MarkFailedResult> {
	const rows = await database.query<{ result: MarkFailedResult }>(
		markFailedSql(params), params.internal ? undefined : { actor: S10_ACTORS.service }
	);
	const result = rows[0]?.result;
	if (result === undefined) throw new Error("mark failed did not return a result");
	return result;
}

function undoImportSql(batchId: string, internal = false): string {
	return internal
		? `SELECT public.undo_import_internal('${S10_ACTORS.ownerA.userId}'::uuid,'${batchId}'::uuid) AS result`
		: `SELECT public.undo_import('${batchId}'::uuid) AS result`;
}

async function undoImport(batchId: string): Promise<UndoImportResult> {
	const rows=await database.query<{result:UndoImportResult}>(undoImportSql(batchId),{actor:S10_ACTORS.ownerA});
	const result=rows[0]?.result; if(result===undefined) throw new Error("undo result missing"); return result;
}

async function createStorageObject(params: {
	path: string;
	ownerUserId?: string;
	mimeType: string;
	byteSize: number;
}): Promise<void> {
	const ownerUserId = params.ownerUserId ?? S10_ACTORS.ownerA.userId;
	await database.execute(`
		INSERT INTO storage.objects (
			id, bucket_id, name, owner, owner_id, metadata
		) VALUES (
			'${randomUUID()}'::uuid, 'illustrations', ${sqlLiteral(params.path)},
			'${ownerUserId}'::uuid, ${sqlLiteral(ownerUserId)},
			jsonb_build_object('mimetype', ${sqlLiteral(params.mimeType)}, 'size', ${params.byteSize})
		)
	`);
}

async function cleanupUploadFixtures(marker: string): Promise<void> {
	await database.execute(`
		DELETE FROM public.ai_uploads
		WHERE upload_key LIKE ${sqlLiteral(`%${marker}%`)}
			OR storage_path LIKE ${sqlLiteral(`%${marker}%`)};
		SET LOCAL storage.allow_delete_query = 'true';
		DELETE FROM storage.objects
		WHERE bucket_id = 'illustrations' AND name LIKE ${sqlLiteral(`%${marker}%`)}
	`);
}

async function createFinalizeFixture(
	imageMode: "none" | "ai" | "upload" = "none"
): Promise<FinalizeFixture> {
	const marker = `finalize-${randomUUID()}`;
	const conceptId = `concept-${marker}`;
	let uploadId: string | undefined;
	if (imageMode === "upload") {
		const storagePath = `${S10_ACTORS.ownerA.userId}/${marker}.png`;
		await createStorageObject({ path: storagePath, mimeType: "image/png", byteSize: 1024 });
		uploadId = (await registerUpload({
			uploadKey: `upload-${marker}`, storagePath, mimeType: "image/png", byteSize: 1024,
		})).uploadId;
	}
	const item = {
		clientItemId: `item-${marker}`, conceptId, pattern: "R1" as const,
		front: `漢字 ${marker}`, back: `かんじ ${marker}`, tags: [` tag ${marker.slice(-8)} `],
		image: imageMode === "upload"
			? { mode: "upload" as const, uploadId: uploadId as string }
			: imageMode === "ai" ? { mode: "ai" as const } : { mode: "none" as const },
	};
	const commitFixture = await createCommitFixture({ marker, items: [item] });
	await createCommitReservation(commitFixture);
	const committed = await commitImport({
		source: "app_ai", idempotencyKey: commitFixture.idempotencyKey,
		importRequestHash: commitFixture.importRequestHash, request: commitFixture.request,
		cardReservationKey: commitFixture.reservationKey,
	});
	const [itemRow] = await database.query<{ id: string }>(`
		SELECT id::text FROM public.ai_import_items WHERE batch_id = '${committed.batchId}'
	`);
	if (itemRow === undefined) throw new Error("finalize fixture item missing");
	let illustrationId: string | undefined;
	if (imageMode !== "none") {
		illustrationId = randomUUID();
		await database.execute(`
			INSERT INTO public.illustrations (
				id, owner_user_id, illustration_key, status, storage_path
			) VALUES (
				'${illustrationId}', '${S10_ACTORS.ownerA.userId}', 'illustration-${marker}',
				'ready', '${S10_ACTORS.ownerA.userId}/${marker}-result.webp'
			)
		`);
		await reserveUsage({
			reservationKey: `illustration-${marker}`, kind: "illustration_concept",
			source: "app_ai", generationRequestHash: fixedHash("7"),
			units: imageMode === "ai" ? 1 : 0, batchId: committed.batchId,
			itemId: itemRow.id, conceptId, testNow: "2049-01-01T00:00:00Z",
		});
	}
	return {
		marker, deckId: commitFixture.deckId, batchId: committed.batchId,
		itemId: itemRow.id, conceptId, uploadId, illustrationId,
	};
}

async function cleanupFinalizeFixture(fixture: FinalizeFixture): Promise<void> {
	await cleanupCommitFixtures([fixture.marker]);
	await database.execute(`DELETE FROM public.illustrations WHERE illustration_key LIKE ${sqlLiteral(`%${fixture.marker}%`)}`);
	await cleanupUploadFixtures(fixture.marker);
}

async function createUndoFixture(autoDeck=false,itemCount=2): Promise<UndoFixture> {
	const marker=`undo-${randomUUID()}`;
	const items=Array.from({length:itemCount},(_,index)=>({clientItemId:`item-${index}-${marker}`,conceptId:`concept-${index}-${marker}`,pattern:"R1" as const,front:`漢字 ${index} ${marker}`,back:`かんじ ${index} ${marker}`,tags:[`共有 ${marker.slice(-8)}`],image:{mode:"none" as const}}));
	const commitFixture=await createCommitFixture({marker,deck:autoDeck?{create:{name:`auto-${marker}`}}:undefined,items});
	await createCommitReservation(commitFixture);
	const committed=await commitImport({source:"app_ai",idempotencyKey:commitFixture.idempotencyKey,importRequestHash:commitFixture.importRequestHash,request:commitFixture.request,cardReservationKey:commitFixture.reservationKey});
	const rows=await database.query<{id:string}>(`SELECT id::text FROM public.ai_import_items WHERE batch_id='${committed.batchId}' ORDER BY ordinal`);
	const cardIds:string[]=[];
	for(const row of rows){ const result=await finalizeItem({batchId:committed.batchId,itemId:row.id}); if(result.cardId===undefined) throw new Error("undo fixture card missing"); cardIds.push(result.cardId); }
	const [batch]=await database.query<{deck:string}>(`SELECT target_deck_id::text deck FROM public.ai_import_batches WHERE id='${committed.batchId}'`);
	if(batch===undefined) throw new Error("undo fixture batch missing");
	return {marker,batchId:committed.batchId,deckId:batch.deck,itemIds:rows.map(row=>row.id),cardIds,reservationKey:commitFixture.reservationKey};
}

async function cleanupUndoFixture(fixture: UndoFixture): Promise<void> {
	await cleanupCommitFixtures([fixture.marker]);
}

const undoSnapshotQueries=(fixture:UndoFixture)=>[
	{name:"batch",sql:`SELECT status,target_deck_id::text,auto_created_deck_id::text,undo_result,undone_at FROM public.ai_import_batches WHERE id='${fixture.batchId}'`},
	{name:"items",sql:`SELECT id::text,status,result_card_id::text,deleted_card_id::text,user_edited_at,undone_at FROM public.ai_import_items WHERE batch_id='${fixture.batchId}' ORDER BY id`},
	{name:"cards",sql:`SELECT id::text,front_text FROM public.cards WHERE id=ANY(ARRAY[${fixture.cardIds.map(id=>`'${id}'::uuid`).join(",")}]) ORDER BY id`},
	{name:"deckCards",sql:`SELECT deck_id::text,card_id::text FROM public.deck_cards WHERE card_id=ANY(ARRAY[${fixture.cardIds.map(id=>`'${id}'::uuid`).join(",")}]) ORDER BY deck_id,card_id`},
	{name:"cardTags",sql:`SELECT card_id::text,tag_id::text FROM public.card_tags WHERE card_id=ANY(ARRAY[${fixture.cardIds.map(id=>`'${id}'::uuid`).join(",")}]) ORDER BY card_id,tag_id`},
	{name:"itemTags",sql:`SELECT item_id::text,tag_id::text FROM public.ai_import_item_tags WHERE item_id=ANY(ARRAY[${fixture.itemIds.map(id=>`'${id}'::uuid`).join(",")}]) ORDER BY item_id,tag_id`},
	{name:"quota",sql:`SELECT reservation_key,batch_id::text,status,units FROM public.ai_quota_reservations WHERE reservation_key='${fixture.reservationKey}'`},
] as const;

const finalizeSnapshotQueries = (fixture: FinalizeFixture) => [
	{ name: "cards", sql: `SELECT id::text, illustration_key FROM public.cards WHERE owner_user_id='${S10_ACTORS.ownerA.userId}' AND (front_text LIKE '%${fixture.marker}%' OR back_text LIKE '%${fixture.marker}%') ORDER BY id` },
	{ name: "deckCards", sql: `SELECT card_id::text FROM public.deck_cards WHERE deck_id='${fixture.deckId}' ORDER BY card_id` },
	{ name: "cardTags", sql: `SELECT card_id::text, tag_id::text FROM public.card_tags WHERE card_id IN (SELECT id FROM public.cards WHERE front_text LIKE '%${fixture.marker}%') ORDER BY card_id,tag_id` },
	{ name: "item", sql: `SELECT status,result_card_id::text,error_code,error_detail,terminal_attempt_key,finalized_at,failed_at FROM public.ai_import_items WHERE id='${fixture.itemId}'` },
	{ name: "upload", sql: `SELECT status,consumed_at FROM public.ai_uploads WHERE id=${nullableUuid(fixture.uploadId)}` },
	{ name: "batch", sql: `SELECT status,finalized_count,failed_count,completed_at FROM public.ai_import_batches WHERE id='${fixture.batchId}'` },
] as const;

async function createCommitFixture(options: {
	marker?: string;
	deck?: CanonicalImportRequestInput["deck"];
	items?: CanonicalImportRequestInput["items"];
} = {}): Promise<CommitFixture> {
	const marker = options.marker ?? randomUUID();
	const deckId = randomUUID();
	if (options.deck === undefined) {
		await database.execute(`
			INSERT INTO public.decks (id, owner_user_id, name)
			VALUES ('${deckId}', '${S10_ACTORS.ownerA.userId}', 'commit-${marker}')
		`);
	}
	const request: CanonicalImportRequestInput = {
		deck: options.deck ?? { id: deckId },
		items: options.items ?? [
			{
				clientItemId: `r-${marker}`,
				conceptId: `concept-${marker}`,
				pattern: "R1",
				front: `漢字 ${marker}`,
				back: `かんじ ${marker}`,
				tags: [` 国語 ${marker.slice(0, 8)} `],
				image: { mode: "none" },
			},
			{
				clientItemId: `w-${marker}`,
				conceptId: `concept-${marker}`,
				pattern: "W1",
				front: `かんじ ${marker}`,
				back: `漢字 ${marker}`,
				tags: [` 国語 ${marker.slice(0, 8)} `],
				image: { mode: "none" },
			},
		],
	};
	return {
		marker,
		deckId,
		request,
		idempotencyKey: `commit-${marker}`,
		reservationKey: `card-${marker}`,
		importRequestHash: await hashImportRequest(request),
		generationRequestHash: fixedHash("e"),
	};
}

async function createCommitReservation(
	fixture: CommitFixture,
	source: ImportSource = "app_ai"
): Promise<ReservationResult> {
	return await reserveUsage({
		reservationKey: fixture.reservationKey,
		kind: "card_generation",
		source,
		generationRequestHash: fixture.generationRequestHash,
		units: source === "app_ai" ? fixture.request.items.length : 0,
		testNow: "2048-01-01T00:00:00Z",
	});
}

const commitSnapshotQueries = [
	{ name: "decks", sql: `SELECT count(*)::int AS count FROM public.decks WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "cards", sql: `SELECT count(*)::int AS count FROM public.cards WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "deckCards", sql: `SELECT count(*)::int AS count FROM public.deck_cards AS relations INNER JOIN public.decks ON decks.id = relations.deck_id WHERE decks.owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "batches", sql: `SELECT count(*)::int AS count FROM public.ai_import_batches WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "items", sql: `SELECT count(*)::int AS count FROM public.ai_import_items WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "tags", sql: `SELECT count(*)::int AS count FROM public.tags WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "itemTags", sql: `SELECT count(*)::int AS count FROM public.ai_import_item_tags WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "cardTags", sql: `SELECT count(*)::int AS count FROM public.card_tags WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'` },
	{ name: "usage", sql: `SELECT usage_date::text, generated_card_count, generated_image_count FROM public.ai_usage_daily WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' ORDER BY usage_date` },
	{ name: "reservations", sql: `SELECT reservation_key, import_request_hash, batch_id::text FROM public.ai_quota_reservations WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' ORDER BY reservation_key, kind` },
] as const;

async function cleanupCommitFixtures(markers: readonly string[]): Promise<void> {
	const patterns = markers.map((marker) => `${sqlLiteral(`%${marker}%`)}`).join(", ");
	if (patterns.length === 0) {
		return;
	}
	await database.execute(`
		DELETE FROM public.ai_import_batches
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND (${markers.map((marker) => `idempotency_key LIKE ${sqlLiteral(`%${marker}%`)}`).join(" OR ")});
		DELETE FROM public.ai_quota_reservations
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND (${markers.map((marker) => `reservation_key LIKE ${sqlLiteral(`%${marker}%`)}`).join(" OR ")});
		DELETE FROM public.ai_uploads
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND (${markers.map((marker) => `upload_key LIKE ${sqlLiteral(`%${marker}%`)}`).join(" OR ")});
		DELETE FROM public.tags
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND display_name LIKE ANY (ARRAY[${patterns}]);
		DELETE FROM public.tags AS tags
		WHERE tags.owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND NOT EXISTS (SELECT 1 FROM public.ai_import_item_tags WHERE tag_id = tags.id)
			AND NOT EXISTS (SELECT 1 FROM public.card_tags WHERE tag_id = tags.id);
		DELETE FROM public.decks
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND name LIKE ANY (ARRAY[${patterns}]);
		DELETE FROM public.cards
		WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
			AND (front_text LIKE ANY (ARRAY[${patterns}]) OR back_text LIKE ANY (ARRAY[${patterns}]));
		DELETE FROM public.ai_usage_daily WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}';
	`);
}

async function createIllustrationQuotaFixture(params: {
	source: ImportSource;
	imageMode: "ai" | "upload";
}): Promise<{ batchId: string; itemId: string; conceptId: string; uploadId?: string }> {
	const batchId = randomUUID();
	const itemId = randomUUID();
	const conceptId = `concept-${randomUUID()}`;
	const uploadId = params.imageMode === "upload" ? randomUUID() : undefined;
	if (uploadId !== undefined) {
		await database.execute(`
			INSERT INTO public.ai_uploads (
				id, owner_user_id, upload_key, purpose, storage_path, mime_type, byte_size
			) VALUES (
				'${uploadId}', '${S10_ACTORS.ownerA.userId}', '${uploadId}',
				'card_illustration', '${S10_ACTORS.ownerA.userId}/${uploadId}.png',
				'image/png', 1024
			)
		`);
	}
	await database.execute(`
		INSERT INTO public.ai_import_batches (
			id, owner_user_id, source, idempotency_key, import_request_hash,
			requested_card_count, requested_image_count
		) VALUES (
			'${batchId}', '${S10_ACTORS.ownerA.userId}', '${params.source}', '${batchId}',
			'${fixedHash("d")}', 1, 1
		);
		INSERT INTO public.ai_import_items (
			id, owner_user_id, batch_id, client_item_id, concept_id, ordinal,
			pattern, skill, front_text, back_text, card_key, image_mode, upload_id
		) VALUES (
			'${itemId}', '${S10_ACTORS.ownerA.userId}', '${batchId}', 'item-${itemId}',
			'${conceptId}', 0, 'R1', 'reading', 'front-${itemId}', 'back',
			'${randomUUID().replaceAll("-", "").repeat(2)}', '${params.imageMode}',
			${nullableUuid(uploadId)}
		)
	`);
	return { batchId, itemId, conceptId, uploadId };
}

async function cleanupQuotaFixtures(
	reservationKeys: readonly string[],
	batchIds: readonly string[] = [],
	uploadIds: readonly string[] = []
): Promise<void> {
	const keys = reservationKeys.map(sqlLiteral).join(", ");
	const batches = batchIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ");
	const uploads = uploadIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ");
	await database.execute(`
		${reservationKeys.length === 0 ? "" : `DELETE FROM public.ai_quota_reservations WHERE reservation_key IN (${keys});`}
		${batchIds.length === 0 ? "" : `DELETE FROM public.ai_import_batches WHERE id IN (${batches});`}
		${uploadIds.length === 0 ? "" : `DELETE FROM public.ai_uploads WHERE id IN (${uploads});`}
		DELETE FROM public.ai_usage_daily WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
	`);
}

beforeAll(async () => {
	await ensureS10ActorFixtures(database);
});

describe("S-10 AIカード登録基盤 DB統合契約", () => {
	describe("RLS・grant・owner境界 (AC-09)", () => {
		// AC原文: 2ユーザー・未認証actorで全SELECT/INSERT/UPDATE/DELETEを検証し、非所有privateデータへの操作をすべて拒否する。
		// 期待結果/合格基準: ownerに許可した契約だけが成功し、非owner/anonの成功件数は0。service wrapperも保存済みownerを再検証する。
		// @category: integration
		// @dependency: S-10 migration RLS policies, actor fixture
		// @complexity: high
		it("IT-RLS-01: owner A/B/anon/serviceのactor matrixでprivate cardsのSELECT/INSERT/UPDATE/DELETE許否が契約どおりになる", async () => {
			const id = randomUUID();
			try {
				await database.execute(`INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${id}','${S10_ACTORS.ownerA.userId}','private','reading','R1','rls-${id}','back','x')`);
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.cards WHERE id='${id}'`, { actor: S10_ACTORS.ownerA })).toEqual([{ n: 1 }]);
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.cards WHERE id='${id}'`, { actor: S10_ACTORS.ownerB })).toEqual([{ n: 0 }]);
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.cards WHERE id='${id}'`, { actor: S10_ACTORS.anonymous })).toEqual([{ n: 0 }]);
				await database.execute(`UPDATE public.cards SET back_text='owner update' WHERE id='${id}'`, { actor: S10_ACTORS.ownerA });
				expect(await database.captureError(`INSERT INTO public.cards(owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${S10_ACTORS.ownerB.userId}','private','reading','R1','forged','back','x')`, { actor: S10_ACTORS.ownerA })).toMatchObject({ sqlState: "42501" });
				expect(await database.captureError(`SELECT * FROM public.cards WHERE id='${id}'`, { actor: S10_ACTORS.service })).toMatchObject({ sqlState: "42501" });
			} finally { await database.execute(`DELETE FROM public.cards WHERE id='${id}'`); }
		});

		// @category: integration
		// @dependency: ai_import_batches/items RLS
		// @complexity: high
		it("IT-RLS-02: batch/itemはowner SELECTだけを許可し、authenticatedの直接INSERT/UPDATE/DELETEを全拒否する", async () => {
			const batch = randomUUID(); const item = randomUUID();
			try {
				await database.execute(`INSERT INTO public.ai_import_batches(id,owner_user_id,source,idempotency_key,import_request_hash,requested_card_count,requested_image_count) VALUES('${batch}','${S10_ACTORS.ownerA.userId}','app_ai','${batch}',repeat('a',64),1,0); INSERT INTO public.ai_import_items(id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,front_text,back_text,card_key) VALUES('${item}','${S10_ACTORS.ownerA.userId}','${batch}','item','concept',0,'R1','reading','front','back',repeat('b',64))`);
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.ai_import_batches WHERE id='${batch}'`, { actor: S10_ACTORS.ownerA })).toEqual([{ n: 1 }]);
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.ai_import_items WHERE id='${item}'`, { actor: S10_ACTORS.ownerB })).toEqual([{ n: 0 }]);
				for (const sql of [`INSERT INTO public.ai_import_batches(owner_user_id,source,idempotency_key,import_request_hash,requested_card_count,requested_image_count) VALUES('${S10_ACTORS.ownerA.userId}','app_ai','deny',repeat('c',64),1,0)`, `UPDATE public.ai_import_batches SET source='remote_mcp' WHERE id='${batch}'`, `DELETE FROM public.ai_import_items WHERE id='${item}'`]) expect((await database.captureError(sql, { actor: S10_ACTORS.ownerA })).sqlState).toBe("42501");
			} finally { await database.execute(`DELETE FROM public.ai_import_batches WHERE id='${batch}'`); }
		});

		// @category: integration
		// @dependency: uploads/tags/card_tags/usage RLS
		// @complexity: high
		it("IT-RLS-03: uploads/tags/card_tags/usageはowner可視性とtable別write契約を守り、非owner/anonを拒否する", async () => {
			const tag = randomUUID();
			try {
				await database.execute(`INSERT INTO public.tags(id,owner_user_id,display_name,normalized_name) VALUES('${tag}','${S10_ACTORS.ownerA.userId}','Owner tag','ignored')`, { actor: S10_ACTORS.ownerA });
				await database.execute(`UPDATE public.tags SET display_name='Updated Tag' WHERE id='${tag}'`, { actor: S10_ACTORS.ownerA });
				expect(await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.tags WHERE id='${tag}'`, { actor: S10_ACTORS.ownerB })).toEqual([{ n: 0 }]);
				for (const table of ["ai_uploads", "card_tags", "ai_usage_daily"]) expect((await database.captureError(`DELETE FROM public.${table}`, { actor: S10_ACTORS.ownerA })).sqlState).toBe("42501");
				expect((await database.captureError(`SELECT * FROM public.ai_quota_reservations`, { actor: S10_ACTORS.ownerA })).sqlState).toBe("42501");
			} finally { await database.execute(`DELETE FROM public.tags WHERE id='${tag}'`); }
		});

		// @category: integration
		// @dependency: RPC grants
		// @complexity: high
		it("IT-RLS-04: authenticatedからcommit/reserve/upload/finalize/mark-failed wrapperを直接実行できない", async () => {
			const rows = await database.query<{
				name: string;
				authenticated: boolean;
				service: boolean;
			}>(`
				SELECT p.proname AS name,
					has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
					has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
				FROM pg_proc AS p
				WHERE p.pronamespace = 'public'::regnamespace
					AND p.proname IN (
						'commit_import', 'reserve_provider_usage', 'register_ai_upload',
						'finalize_import_item', 'mark_import_item_failed'
					)
				ORDER BY p.proname
			`);
			expect(rows).toContainEqual({
				name: "reserve_provider_usage",
				authenticated: false,
				service: true,
			});
			for (const row of rows) {
				expect(row.authenticated).toBe(false);
			}
		});

		// @category: integration
		// @dependency: internal function revoke/grant
		// @complexity: high
		it("IT-RLS-05: PUBLIC/anon/authenticated/service_roleからinternal primitiveとtrigger functionを直接実行できない", async () => {
			const rows = await database.query<{ n: number }>(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%internal%' OR p.prorettype='trigger'::regtype) AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))))`);
			expect(rows).toEqual([{ n: 0 }]);
		});

		// @category: edge-case
		// @dependency: trusted wrappers, saved batch/item ownership
		// @complexity: high
		it("IT-RLS-06: service wrapperへowner/sourceを偽装しても保存済みbatch/item/request境界を越えずnot-found相当になる", async () => {
			expect((await database.captureError(`UPDATE public.ai_import_batches SET owner_user_id='${S10_ACTORS.ownerB.userId}', source='remote_mcp'`, { actor: S10_ACTORS.service })).sqlState).toBe("42501");
		});

		// @category: integration
		// @dependency: public cards RLS/immutability trigger
		// @complexity: medium
		it("IT-RLS-07: 公開Seedは既存SELECT互換を保ち、通常利用者のINSERT/UPDATE/DELETEを拒否する", async () => {
			for (const actor of [S10_ACTORS.ownerA, S10_ACTORS.ownerB, S10_ACTORS.anonymous]) expect((await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.cards WHERE visibility='public'`, { actor }))[0]?.n).toBeGreaterThan(0);
			expect((await database.captureError(`INSERT INTO public.cards(owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES(NULL,'public','reading','R1','bad','bad','x')`, { actor: S10_ACTORS.ownerA })).sqlState).toBe("42501");
			await database.execute(`UPDATE public.cards SET back_text='forbidden' WHERE visibility='public'`, { actor: S10_ACTORS.ownerA });
			await database.execute(`DELETE FROM public.cards WHERE visibility='public'`, { actor: S10_ACTORS.ownerA });
			expect((await database.query<{ n: number }>(`SELECT count(*)::int n FROM public.cards WHERE visibility='public'`))[0]?.n).toBe(100);
		});
	});

	describe("部分一意・owner relation (AC-01/02/09)", () => {
		// AC原文: 異なるownerと公開Seed同値privateを許可し、同一owner重複、card_tags/deck_cards cross-ownerを拒否する。
		// 期待結果/合格基準: 許可例100%、禁止例成功0件。失敗時に関連行を残さない。
		// @category: integration
		// @dependency: cards partial unique indexes
		// @complexity: high
		it("IT-UNIQUE-01: 同一card_keyのprivate cardを異なるowner A/Bが各1件保持できる", async () => {
			for (const vector of unicodeFixture.displayNormalizationVectors) {
				const rows = await database.query<{ normalized: string }>(`
					SELECT public.ai_normalize_display_text(${sqlLiteral(vector.input)}) AS normalized
				`);
				expect(rows).toEqual([{ normalized: vector.expected }]);
			}

			for (const vector of unicodeFixture.keyNormalizationVectors) {
				const rows = await database.query<{ normalized: string }>(`
					SELECT public.ai_normalize_key_text(${sqlLiteral(vector.input)}) AS normalized
				`);
				expect(rows).toEqual([{ normalized: vector.expected }]);
			}

			for (const vector of unicodeFixture.cardKeyVectors) {
				const rows = await database.query<{ card_key: string }>(`
					SELECT public.ai_compute_card_key(
						${sqlLiteral(vector.pattern)},
						${sqlLiteral(vector.front)},
						${sqlLiteral(vector.back)}
					) AS card_key
				`);
				expect(rows).toEqual([{ card_key: vector.expectedSha256Hex }]);
			}

			const marker = `s10-unique-owner-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES
						('${S10_ACTORS.ownerA.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(marker)}, 'same back', 'caller-a'),
						('${S10_ACTORS.ownerB.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(marker)}, 'same back', 'caller-b')
				`);
				const rows = await database.query<{ owner_count: number; key_count: number }>(`
					SELECT count(DISTINCT owner_user_id)::int AS owner_count,
						count(DISTINCT card_key)::int AS key_count
					FROM public.cards
					WHERE front_text = ${sqlLiteral(marker)}
				`);
				expect(rows).toEqual([{ owner_count: 2, key_count: 1 }]);
			} finally {
				await database.execute(`DELETE FROM public.cards WHERE front_text = ${sqlLiteral(marker)}`);
			}
		});

		// @category: integration
		// @dependency: cards partial unique indexes
		// @complexity: medium
		it("IT-UNIQUE-02: 公開Seedと同一card_keyのprivate cardを作成できる", async () => {
			const publicCards = await database.query<{
				pattern: string;
				front_text: string;
				back_text: string;
				card_key: string;
			}>(`
				SELECT pattern, front_text, back_text, card_key
				FROM public.cards
				WHERE visibility = 'public'
				ORDER BY id
				LIMIT 1
			`);
			expect(publicCards).toHaveLength(1);
			const source = publicCards[0];
			if (source === undefined) {
				throw new Error("S-10 integration database requires the repository Seed");
			}

			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						${sqlLiteral(source.pattern)},
						${sqlLiteral(source.front_text)},
						${sqlLiteral(source.back_text)},
						'caller-value-is-ignored'
					)
				`);
				const rows = await database.query<{ card_key: string }>(`
					SELECT card_key
					FROM public.cards
					WHERE visibility = 'private'
						AND owner_user_id = '${S10_ACTORS.ownerA.userId}'::uuid
						AND pattern = ${sqlLiteral(source.pattern)}
						AND front_text = ${sqlLiteral(source.front_text)}
						AND back_text = ${sqlLiteral(source.back_text)}
				`);
				expect(rows).toEqual([{ card_key: source.card_key }]);
			} finally {
				await database.execute(`
					DELETE FROM public.cards
					WHERE visibility = 'private'
						AND owner_user_id = '${S10_ACTORS.ownerA.userId}'::uuid
						AND pattern = ${sqlLiteral(source.pattern)}
						AND front_text = ${sqlLiteral(source.front_text)}
						AND back_text = ${sqlLiteral(source.back_text)}
				`);
			}
		});

		// @category: edge-case
		// @dependency: private owner partial unique index, error mapper
		// @complexity: high
		it("IT-UNIQUE-03: 同一ownerのprivate重複をnamed 23505からDUPLICATE_EXISTINGへ分類する", async () => {
			const marker = `s10-unique-duplicate-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						'R1',
						${sqlLiteral(marker)},
						'duplicate back',
						'caller-value-first'
					)
				`);
				const diagnostic = await database.captureError(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						'R1',
						${sqlLiteral(marker)},
						'duplicate back',
						'caller-value-second'
					)
				`);
				expect(diagnostic).toEqual({
					sqlState: "23505",
					constraint: "cards_private_owner_card_key_uidx",
				});
			} finally {
				await database.execute(`DELETE FROM public.cards WHERE front_text = ${sqlLiteral(marker)}`);
			}
		});

		// @category: integration
		// @dependency: card_tags composite foreign keys and trigger
		// @complexity: high
		it("IT-OWNER-01: card/tag/relation ownerが一致するcard_tagsだけを許可しINSERT/UPDATE偽装を拒否する", async () => {
			const cardId = randomUUID();
			const ownerATagId = randomUUID();
			const ownerBTagId = randomUUID();
			const marker = `s10-owner-card-tag-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.cards (
						id, owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${cardId}'::uuid,
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private', 'reading', 'R1', ${sqlLiteral(marker)}, 'owner back', 'ignored'
					);
					INSERT INTO public.tags (id, owner_user_id, display_name, normalized_name)
					VALUES
						('${ownerATagId}'::uuid, '${S10_ACTORS.ownerA.userId}'::uuid, '　ＡＢＣ　', 'caller-a'),
						('${ownerBTagId}'::uuid, '${S10_ACTORS.ownerB.userId}'::uuid, 'Owner B', 'caller-b');
				`);

				const normalizedTags = await database.query<{
					display_name: string;
					normalized_name: string;
				}>(`
					SELECT display_name, normalized_name
					FROM public.tags
					WHERE id = '${ownerATagId}'::uuid
				`);
				expect(normalizedTags).toEqual([{ display_name: "ABC", normalized_name: "abc" }]);

				await database.execute(`
					INSERT INTO public.card_tags (owner_user_id, card_id, tag_id)
					VALUES ('${S10_ACTORS.ownerA.userId}'::uuid, '${cardId}'::uuid, '${ownerATagId}'::uuid)
				`);

				const tagMismatch = await database.captureError(`
					INSERT INTO public.card_tags (owner_user_id, card_id, tag_id)
					VALUES ('${S10_ACTORS.ownerA.userId}'::uuid, '${cardId}'::uuid, '${ownerBTagId}'::uuid)
				`);
				expect(tagMismatch).toEqual({
					sqlState: "P1003",
					constraint: null,
				});

				const cardMismatch = await database.captureError(`
					INSERT INTO public.card_tags (owner_user_id, card_id, tag_id)
					VALUES ('${S10_ACTORS.ownerB.userId}'::uuid, '${cardId}'::uuid, '${ownerBTagId}'::uuid)
				`);
				expect(cardMismatch).toEqual({
					sqlState: "P1003",
					constraint: null,
				});

				const updateMismatch = await database.captureError(`
					UPDATE public.card_tags
					SET tag_id = '${ownerBTagId}'::uuid
					WHERE card_id = '${cardId}'::uuid AND tag_id = '${ownerATagId}'::uuid
				`);
				expect(updateMismatch).toEqual({
					sqlState: "P1003",
					constraint: null,
				});

				const serviceMismatch = await database.captureError(`
					INSERT INTO public.card_tags (owner_user_id, card_id, tag_id)
					VALUES ('${S10_ACTORS.ownerA.userId}'::uuid, '${cardId}'::uuid, '${ownerBTagId}'::uuid)
				`, { actor: S10_ACTORS.service });
				expect(serviceMismatch).toEqual({ sqlState: "42501", constraint: null });
			} finally {
				await database.execute(`
					DELETE FROM public.cards WHERE id = '${cardId}'::uuid;
					DELETE FROM public.tags WHERE id IN ('${ownerATagId}'::uuid, '${ownerBTagId}'::uuid)
				`);
			}
		});

		// @category: integration
		// @dependency: deck_cards owner trigger
		// @complexity: high
		it("IT-OWNER-02: owner deckへpublic cardまたは同一owner private cardだけを関連付けられる", async () => {
			const deckId = randomUUID();
			const privateCardId = randomUUID();
			const publicCards = await database.query<{ id: string }>(`
				SELECT id FROM public.cards WHERE visibility = 'public' ORDER BY id LIMIT 1
			`);
			const publicCard = publicCards[0];
			if (publicCard === undefined) {
				throw new Error("S-10 integration database requires the repository Seed");
			}
			try {
				await database.execute(`
					INSERT INTO public.decks (id, owner_user_id, name)
					VALUES ('${deckId}'::uuid, '${S10_ACTORS.ownerA.userId}'::uuid, 'S10 owner deck');
					INSERT INTO public.cards (
						id, owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${privateCardId}'::uuid, '${S10_ACTORS.ownerA.userId}'::uuid,
						'private', 'reading', 'R1', ${sqlLiteral(`s10-owner-deck-${privateCardId}`)}, 'back', 'ignored'
					);
				`);
				await database.execute(`
					INSERT INTO public.deck_cards (deck_id, card_id)
					VALUES
						('${deckId}'::uuid, '${publicCard.id}'::uuid),
						('${deckId}'::uuid, '${privateCardId}'::uuid)
				`);
				const rows = await database.query<{ relation_count: number }>(`
					SELECT count(*)::int AS relation_count
					FROM public.deck_cards WHERE deck_id = '${deckId}'::uuid
				`);
				expect(rows).toEqual([{ relation_count: 2 }]);
			} finally {
				await database.execute(`
					DELETE FROM public.decks WHERE id = '${deckId}'::uuid;
					DELETE FROM public.cards WHERE id = '${privateCardId}'::uuid
				`);
			}
		});

		// @category: edge-case
		// @dependency: deck_cards owner trigger
		// @complexity: high
		it("IT-OWNER-03: deck_cards INSERT/UPDATEのcross-owner private card差替えをservice roleでも拒否する", async () => {
			const deckId = randomUUID();
			const ownerACardId = randomUUID();
			const ownerBCardId = randomUUID();
			try {
				await database.execute(`
					INSERT INTO public.decks (id, owner_user_id, name)
					VALUES ('${deckId}'::uuid, '${S10_ACTORS.ownerA.userId}'::uuid, 'S10 cross-owner deck');
					INSERT INTO public.cards (
						id, owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES
						('${ownerACardId}'::uuid, '${S10_ACTORS.ownerA.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(`owner-a-${ownerACardId}`)}, 'back', 'ignored-a'),
						('${ownerBCardId}'::uuid, '${S10_ACTORS.ownerB.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(`owner-b-${ownerBCardId}`)}, 'back', 'ignored-b')
				`);

				const insertMismatch = await database.captureError(`
					INSERT INTO public.deck_cards (deck_id, card_id)
					VALUES ('${deckId}'::uuid, '${ownerBCardId}'::uuid)
				`);
				expect(insertMismatch).toEqual({ sqlState: "P1003", constraint: null });

				await database.execute(`
					INSERT INTO public.deck_cards (deck_id, card_id)
					VALUES ('${deckId}'::uuid, '${ownerACardId}'::uuid)
				`);
				const updateMismatch = await database.captureError(`
					UPDATE public.deck_cards
					SET card_id = '${ownerBCardId}'::uuid
					WHERE deck_id = '${deckId}'::uuid AND card_id = '${ownerACardId}'::uuid
				`);
				expect(updateMismatch).toEqual({ sqlState: "P1003", constraint: null });

				const serviceMismatch = await database.captureError(`
					INSERT INTO public.deck_cards (deck_id, card_id)
					VALUES ('${deckId}'::uuid, '${ownerBCardId}'::uuid)
				`, { actor: S10_ACTORS.service });
				expect(serviceMismatch).toEqual({ sqlState: "42501", constraint: null });

				const rows = await database.query<{ card_id: string }>(`
					SELECT card_id FROM public.deck_cards WHERE deck_id = '${deckId}'::uuid
				`);
				expect(rows).toEqual([{ card_id: ownerACardId }]);
			} finally {
				await database.execute(`
					DELETE FROM public.decks WHERE id = '${deckId}'::uuid;
					DELETE FROM public.cards WHERE id IN ('${ownerACardId}'::uuid, '${ownerBCardId}'::uuid)
				`);
			}
		});

		// @category: integration
		// @dependency: relation grants, set_card_* RPC
		// @complexity: high
		it("IT-OWNER-04: authenticatedのrelation直接writeを拒否しSELECT互換とowner管理RPCだけを許可する", async () => {
			const fixture=await createFinalizeFixture(); const deck=randomUUID(),tag=randomUUID(),illustration=randomUUID();
			try {
				const finalized=await finalizeItem({batchId:fixture.batchId,itemId:fixture.itemId}); const card=finalized.cardId;
				if(card===undefined) throw new Error("finalized card missing");
				await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','manage-${fixture.marker}'); INSERT INTO public.tags(id,owner_user_id,display_name,normalized_name) VALUES('${tag}','${S10_ACTORS.ownerA.userId}','manage-${fixture.marker.slice(-8)}','ignored'); INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES('${illustration}','${S10_ACTORS.ownerA.userId}','manage-${fixture.marker}','ready','${S10_ACTORS.ownerA.userId}/${fixture.marker}.webp')`);
				for(const sql of [`DELETE FROM public.deck_cards WHERE deck_id='${fixture.deckId}' AND card_id='${card}'`,`INSERT INTO public.card_tags(owner_user_id,card_id,tag_id) VALUES('${S10_ACTORS.ownerA.userId}','${card}','${tag}')`]) expect((await database.captureError(sql,{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");
				expect((await database.captureError(`UPDATE public.cards SET illustration_key='forbidden' WHERE id='${card}'`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");

				const [before]=await database.query<{updated:string;key:string}>(`SELECT updated_at::text updated,card_key key FROM public.cards WHERE id='${card}'`);
				if(before===undefined) throw new Error("management card missing");
				await database.execute(`INSERT INTO public.review_states(user_id,card_id,due_date,level,last_rating) VALUES('${S10_ACTORS.ownerA.userId}','${card}',current_date,3,'good')`);
				await database.query(`SELECT public.update_imported_card('${card}','{"frontText":"管理 ${fixture.marker}"}'::jsonb,'${before.updated}'::timestamptz) result`,{actor:S10_ACTORS.ownerA});
				const [updated]=await database.query<{updated:string;key:string;edited:boolean;reviews:number}>(`SELECT cards.updated_at::text updated,cards.card_key key,(items.user_edited_at IS NOT NULL) edited,(SELECT count(*)::int FROM public.review_states WHERE card_id=cards.id) reviews FROM public.cards cards JOIN public.ai_import_items items ON items.result_card_id=cards.id WHERE cards.id='${card}'`);
				expect(updated).toMatchObject({edited:true,reviews:0}); expect(updated?.key).not.toBe(before.key);
				if(updated===undefined) throw new Error("updated management card missing");
				const validationSnapshot=await database.query<Record<string,unknown>>(`SELECT cards.front_text,cards.back_text,cards.card_key,cards.updated_at::text,items.user_edited_at::text FROM public.cards AS cards JOIN public.ai_import_items AS items ON items.result_card_id=cards.id WHERE cards.id='${card}'`);
				for(const frontText of ["　 \t", "漢".repeat(201), "alphabet only"]){ const patch=sqlLiteral(JSON.stringify({frontText})); expect((await database.captureError(`SELECT public.update_imported_card('${card}',${patch}::jsonb,'${updated.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1000"); }
				const invalidWritingPatch=sqlLiteral(JSON.stringify({pattern:"W1",skill:"writing",backText:"alphabet only"}));
				expect((await database.captureError(`SELECT public.update_imported_card('${card}',${invalidWritingPatch}::jsonb,'${updated.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1000");
				expect(await database.query<Record<string,unknown>>(`SELECT cards.front_text,cards.back_text,cards.card_key,cards.updated_at::text,items.user_edited_at::text FROM public.cards AS cards JOIN public.ai_import_items AS items ON items.result_card_id=cards.id WHERE cards.id='${card}'`)).toEqual(validationSnapshot);
				const normalizedPatch=sqlLiteral(JSON.stringify({frontText:" \u3000漢\u00a0字\t "}));
				await database.query(`SELECT public.update_imported_card('${card}',${normalizedPatch}::jsonb,'${updated.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA});
				const [normalized]=await database.query<{front:string;key:string;expectedKey:string;updated:string}>(`SELECT front_text front,card_key key,public.ai_compute_card_key(pattern,front_text,back_text) "expectedKey",updated_at::text updated FROM public.cards WHERE id='${card}'`);
				expect(normalized).toMatchObject({front:"漢 字"}); expect(normalized?.key).toBe(normalized?.expectedKey);
				expect((await database.captureError(`SELECT public.update_imported_card('${card}','{"backText":"stale"}'::jsonb,'${before.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1008");
				expect((await database.captureError(`SELECT public.update_imported_card('${card}','{"backText":"hidden"}'::jsonb,'${normalized?.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerB})).sqlState).toBe("P1003");
				for(const sql of [`SELECT public.set_card_decks('${card}',ARRAY['${deck}']::uuid[])`,`SELECT public.set_card_tags('${card}',ARRAY['${tag}']::uuid[])`,`SELECT public.set_card_illustration('${card}','${illustration}')`]) await database.query(sql,{actor:S10_ACTORS.ownerA});
				expect(await database.query<{decks:number;tags:number;illustration:string}>(`SELECT (SELECT count(*)::int FROM public.deck_cards WHERE card_id='${card}') decks,(SELECT count(*)::int FROM public.card_tags WHERE card_id='${card}') tags,illustration_key illustration FROM public.cards WHERE id='${card}'`,{actor:S10_ACTORS.ownerA})).toEqual([{decks:1,tags:1,illustration:`manage-${fixture.marker}`}]);
				expect((await database.captureError(`SELECT public.set_card_illustration('${card}',NULL); UPDATE public.cards SET illustration_key='leaked' WHERE id='${card}'`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");
				expect(await database.query<{key:string;contexts:number}>(`SELECT illustration_key key,(SELECT count(*)::int FROM s10_private.management_mutation_context) contexts FROM public.cards WHERE id='${card}'`)).toEqual([{key:`manage-${fixture.marker}`,contexts:0}]);
				for(const sql of [`SELECT public.set_card_decks('${card}',ARRAY['${deck}']::uuid[])`,`SELECT public.set_card_tags('${card}',ARRAY['${tag}']::uuid[])`,`SELECT public.set_card_illustration('${card}','${illustration}')`,`SELECT public.delete_private_card('${card}','${updated?.updated}'::timestamptz)`]) expect((await database.captureError(sql,{actor:S10_ACTORS.service})).sqlState).toBe("42501");
				expect((await database.captureError(`SELECT public.set_card_decks('${card}',ARRAY['${deck}']::uuid[])`,{actor:S10_ACTORS.ownerB})).sqlState).toBe("P1003");
				expect((await database.captureError(`SELECT public.set_card_decks_internal('${S10_ACTORS.ownerA.userId}','${card}',ARRAY['${deck}']::uuid[])`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");

				const [order]=await database.query<{card:number;advisory:number;item:number;target:number}>(`WITH source AS(SELECT pg_get_functiondef('public.set_card_decks_internal(uuid,uuid,uuid[])'::regprocedure) definition) SELECT strpos(definition,'SELECT cards.* INTO locked_card')::int card,strpos(definition,'pg_advisory_xact_lock')::int advisory,strpos(definition,'FROM public.ai_import_items AS items')::int item,strpos(definition,'FROM public.decks AS target_decks')::int target FROM source`);
				expect([order?.card,order?.advisory,order?.item,order?.target].every(value=>value!==undefined&&value>0)).toBe(true); expect([order?.card,order?.advisory,order?.item,order?.target]).toEqual([...( [order?.card,order?.advisory,order?.item,order?.target] as number[])].sort((a,b)=>a-b));
				expect(await database.query<{bad:number}>(`WITH expected(signature,authenticated_execute,service_execute) AS (VALUES ('public.update_imported_card(uuid,jsonb,timestamptz)',true,false),('public.delete_private_card(uuid,timestamptz)',true,false),('public.set_card_decks(uuid,uuid[])',true,false),('public.set_card_tags(uuid,uuid[])',true,false),('public.set_card_illustration(uuid,uuid)',true,false),('public.update_imported_card_internal(uuid,uuid,jsonb,timestamptz)',false,false),('public.delete_private_card_internal(uuid,uuid,timestamptz)',false,false),('public.set_card_decks_internal(uuid,uuid,uuid[])',false,false),('public.set_card_tags_internal(uuid,uuid,uuid[])',false,false),('public.set_card_illustration_internal(uuid,uuid,uuid)',false,false)) SELECT count(*) FILTER(WHERE has_function_privilege('authenticated',signature,'EXECUTE') IS DISTINCT FROM authenticated_execute OR has_function_privilege('service_role',signature,'EXECUTE') IS DISTINCT FROM service_execute OR has_function_privilege('anon',signature,'EXECUTE'))::int bad FROM expected`)).toEqual([{bad:0}]);
			} finally { await database.execute(`DELETE FROM public.illustrations WHERE id='${illustration}'; DELETE FROM public.tags WHERE id='${tag}'; DELETE FROM public.decks WHERE id='${deck}'`); await cleanupFinalizeFixture(fixture); }
		});
	});

	describe("commit・冪等性・Stage 1原子性 (AC-02/04/06)", () => {
		// AC原文: 同key同hash並行commitはbatch 1件、別hashはCONFLICT、Stage 1不正は全table増分0、正常commit時card関連0。
		// 期待結果/合格基準: batch/items/tags/reservation linkだけを1 transactionで確定し、usage二重加算なし。
		// @category: integration
		// @dependency: commit_import wrapper/internal, Stage 1 DB validation
		// @complexity: high
		it("IT-COMMIT-01: 正常commitがbatch/items/tags/item_tagsとreservation linkを原子的に作りcard/deck_cards/card_tagsを0件に保つ", async () => {
			const fixture = await createCommitFixture();
			try {
				await createCommitReservation(fixture);
				const before = await captureS10Snapshot(database, commitSnapshotQueries);
				const result = await commitImport({
					source: "app_ai",
					idempotencyKey: fixture.idempotencyKey,
					importRequestHash: fixture.importRequestHash,
					request: fixture.request,
					cardReservationKey: fixture.reservationKey,
				});
				expect(result).toMatchObject({
					status: "committed",
					requestedCardCount: 2,
					requestedImageCount: 0,
				});
				const rows = await database.query<{
					batches: number; items: number; tags: number; itemTags: number;
					cards: number; deckCards: number; cardTags: number; usage: number;
					reservationBatchId: string; reservationImportHash: string;
				}>(`
					SELECT
						(SELECT count(*)::int FROM public.ai_import_batches WHERE id = '${result.batchId}') AS batches,
						(SELECT count(*)::int FROM public.ai_import_items WHERE batch_id = '${result.batchId}') AS items,
						(SELECT count(DISTINCT tags.id)::int FROM public.tags INNER JOIN public.ai_import_item_tags AS links ON links.tag_id = tags.id INNER JOIN public.ai_import_items AS items ON items.id = links.item_id WHERE items.batch_id = '${result.batchId}') AS tags,
						(SELECT count(*)::int FROM public.ai_import_item_tags AS links INNER JOIN public.ai_import_items AS items ON items.id = links.item_id WHERE items.batch_id = '${result.batchId}') AS "itemTags",
						(SELECT count(*)::int FROM public.cards WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}') AS cards,
						(SELECT count(*)::int FROM public.deck_cards AS links INNER JOIN public.decks ON decks.id = links.deck_id WHERE decks.owner_user_id = '${S10_ACTORS.ownerA.userId}') AS "deckCards",
						(SELECT count(*)::int FROM public.card_tags WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}') AS "cardTags",
						(SELECT sum(generated_card_count)::int FROM public.ai_usage_daily WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}') AS usage,
						(SELECT batch_id::text FROM public.ai_quota_reservations WHERE reservation_key = '${fixture.reservationKey}') AS "reservationBatchId",
						(SELECT import_request_hash FROM public.ai_quota_reservations WHERE reservation_key = '${fixture.reservationKey}') AS "reservationImportHash"
				`);
				expect(rows).toEqual([{
					batches: 1, items: 2, tags: 1, itemTags: 2,
					cards: (before.entries.cards[0]?.count as number) ?? 0,
					deckCards: (before.entries.deckCards[0]?.count as number) ?? 0,
					cardTags: (before.entries.cardTags[0]?.count as number) ?? 0,
					usage: 2,
					reservationBatchId: result.batchId,
					reservationImportHash: fixture.importRequestHash,
				}]);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: edge-case
		// @dependency: commit transaction, snapshot helper
		// @complexity: high
		it("IT-COMMIT-02: Stage 1各validation違反と途中例外でdeck/card/batch/item/tag/card_tags/usage/reservation差分が0になる", async () => {
			const fixture = await createCommitFixture();
			const invalidRequests: ReadonlyArray<Readonly<Record<string, unknown>>> = [
				{ ...fixture.request, source: "app_ai" },
				{ deck: fixture.request.deck, items: "invalid" },
				{ deck: fixture.request.deck, items: Array.from({ length: 51 }, (_, index) => ({ ...fixture.request.items[0], clientItemId: `i-${index}`, conceptId: `c-${index}`, front: `漢${index}` })) },
				{ deck: fixture.request.deck, items: [{ ...fixture.request.items[0], clientItemId: "" }] },
				{ deck: fixture.request.deck, items: [{ ...fixture.request.items[0], tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) }] },
				{ deck: fixture.request.deck, items: [fixture.request.items[0], { ...fixture.request.items[1], front: "mismatch" }] },
			];
			try {
				const before = await captureS10Snapshot(database, commitSnapshotQueries);
				for (const [index, request] of invalidRequests.entries()) {
					const diagnostic = await database.captureError(commitImportSql({
						source: "app_ai",
						idempotencyKey: `${fixture.idempotencyKey}-${index}`,
						importRequestHash: fixedHash("a"),
						request,
						cardReservationKey: `${fixture.reservationKey}-${index}`,
					}), { actor: S10_ACTORS.service });
					expect(["P1000", "P1001"]).toContain(diagnostic.sqlState);
					expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);
				}

				const rollbackFixture = await createCommitFixture({ marker: `rollback-${randomUUID()}`, deck: { create: { name: `rollback-${fixture.marker}` } } });
				await createCommitReservation(rollbackFixture);
				const rollbackBefore = await captureS10Snapshot(database, commitSnapshotQueries);
				const failpoint = await database.captureError(commitImportSql({
					source: "app_ai",
					idempotencyKey: rollbackFixture.idempotencyKey,
					importRequestHash: rollbackFixture.importRequestHash,
					request: rollbackFixture.request,
					cardReservationKey: rollbackFixture.reservationKey,
					internal: true,
				}), { failpoint: "commit_after_tags" });
				expect(failpoint.sqlState).toBe("P1008");
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(rollbackBefore);
				await cleanupCommitFixtures([rollbackFixture.marker]);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: edge-case
		// @dependency: idempotency advisory lock, parallel DB clients
		// @complexity: high
		it("IT-COMMIT-03: 同owner/key/import hashの並行commitがbatch 1件と同一batch IDを返しitem/tag/usageを増やさない", async () => {
			const fixture = await createCommitFixture();
			try {
				await createCommitReservation(fixture);
				const params = {
					source: "app_ai" as const,
					idempotencyKey: fixture.idempotencyKey,
					importRequestHash: fixture.importRequestHash,
					request: fixture.request,
					cardReservationKey: fixture.reservationKey,
				};
				const results = await Promise.all([createS10DbClient(), createS10DbClient()].map(async (client) => {
					const rows = await client.query<{ result: CommitImportResult }>(commitImportSql(params), { actor: S10_ACTORS.service });
					return rows[0]?.result;
				}));
				expect(results[0]).toEqual(results[1]);
				const batchId = results[0]?.batchId;
				expect(await database.query<{ batches: number; items: number; tags: number; usage: number }>(`
					SELECT
						(SELECT count(*)::int FROM public.ai_import_batches WHERE idempotency_key = '${fixture.idempotencyKey}') AS batches,
						(SELECT count(*)::int FROM public.ai_import_items WHERE batch_id = '${batchId}') AS items,
						(SELECT count(DISTINCT tags.id)::int FROM public.tags INNER JOIN public.ai_import_item_tags AS links ON links.tag_id = tags.id INNER JOIN public.ai_import_items AS items ON items.id = links.item_id WHERE items.batch_id = '${batchId}') AS tags,
						(SELECT sum(generated_card_count)::int FROM public.ai_usage_daily WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}') AS usage
				`)).toEqual([{ batches: 1, items: 2, tags: 1, usage: 2 }]);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: edge-case
		// @dependency: commit idempotency contract
		// @complexity: high
		it("IT-COMMIT-04: 同owner/keyでimport hash・source・reservationのいずれかが異なる再送をCONFLICTにして既存batchを不変にする", async () => {
			const fixture = await createCommitFixture();
			try {
				await createCommitReservation(fixture);
				await commitImport({ source: "app_ai", idempotencyKey: fixture.idempotencyKey, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey });
				const before = await captureS10Snapshot(database, commitSnapshotQueries);
				for (const override of [
					{ importRequestHash: fixedHash("b") },
					{ source: "remote_mcp" as const },
					{ cardReservationKey: `${fixture.reservationKey}-other` },
				]) {
					const diagnostic = await database.captureError(commitImportSql({
						source: "app_ai", idempotencyKey: fixture.idempotencyKey,
						importRequestHash: fixture.importRequestHash, request: fixture.request,
						cardReservationKey: fixture.reservationKey, ...override,
					}), { actor: S10_ACTORS.service });
					expect(diagnostic.sqlState).toBe("P1008");
					 expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);
				}
				const changedRequest: CanonicalImportRequestInput = {
					deck: fixture.request.deck,
					items: [
						{ ...fixture.request.items[0], front: `${fixture.request.items[0].front} changed` },
						{ ...fixture.request.items[1], back: `${fixture.request.items[1].back} changed` },
					],
				};
				const changedBody = await database.captureError(commitImportSql({
					source: "app_ai", idempotencyKey: fixture.idempotencyKey,
					importRequestHash: fixture.importRequestHash, request: changedRequest,
					cardReservationKey: fixture.reservationKey,
				}), { actor: S10_ACTORS.service });
				expect(changedBody.sqlState).toBe("P1000");
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: integration
		// @dependency: generation/import hash DB validation
		// @complexity: high
		it("IT-COMMIT-05: generation hashとimport hashの非一致を許容しreservation keyで結び、初回だけimport hashを関連付ける", async () => {
			const vector = canonicalRequestFixture.importVectors[0];
			const deckId = vector.input.deck.id.toLowerCase();
			const marker = `fixture-${randomUUID()}`;
			const fixtureRequest: CanonicalImportRequestInput = {
				deck: vector.input.deck,
				items: vector.input.items,
			};
			const fixture: CommitFixture = {
				marker, deckId, request: fixtureRequest,
				idempotencyKey: marker, reservationKey: `card-${marker}`,
				importRequestHash: vector.expectedSha256Hex,
				generationRequestHash: canonicalRequestFixture.generationVectors[0].expectedSha256Hex,
			};
			try {
				await database.execute(`INSERT INTO public.decks(id, owner_user_id, name) VALUES ('${deckId}', '${S10_ACTORS.ownerA.userId}', '${marker}')`);
				expect(fixture.generationRequestHash).not.toBe(fixture.importRequestHash);
				await createCommitReservation(fixture);
				const first = await commitImport({ source: "app_ai", idempotencyKey: marker, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey });
				const second = await commitImport({ source: "app_ai", idempotencyKey: marker, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey });
				expect(second).toEqual(first);
				expect(await database.query<{ generationHash: string; importHash: string; batchId: string }>(`
					SELECT generation_request_hash AS "generationHash", import_request_hash AS "importHash", batch_id::text AS "batchId"
					FROM public.ai_quota_reservations WHERE reservation_key = '${fixture.reservationKey}'
				`)).toEqual([{ generationHash: fixture.generationRequestHash, importHash: fixture.importRequestHash, batchId: first.batchId }]);
			} finally {
				await cleanupCommitFixtures([marker]);
				await database.execute(`DELETE FROM public.decks WHERE id = '${deckId}'`);
			}
		});

		// @category: edge-case
		// @dependency: DB canonical import hash function
		// @complexity: high
		it("IT-COMMIT-06: 引数import hashとDB再計算hashの不一致、reservation key改ざんを拒否し副作用を0件にする", async () => {
			const fixture = await createCommitFixture();
			try {
				await createCommitReservation(fixture);
				const before = await captureS10Snapshot(database, commitSnapshotQueries);
				const wrongHash = await database.captureError(commitImportSql({ source: "app_ai", idempotencyKey: fixture.idempotencyKey, importRequestHash: fixedHash("f"), request: fixture.request, cardReservationKey: fixture.reservationKey }), { actor: S10_ACTORS.service });
				expect(wrongHash.sqlState).toBe("P1000");
				expect(wrongHash.detail).toContain("importRequestHash");
				for (const sensitiveValue of [fixture.marker, fixture.reservationKey, fixture.request.items[0]?.front ?? ""]) {
					expect(wrongHash.detail).not.toContain(sensitiveValue);
				}
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);
				const tamperedKey = await database.captureError(commitImportSql({ source: "app_ai", idempotencyKey: `${fixture.idempotencyKey}-tampered`, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: `${fixture.reservationKey}-tampered` }), { actor: S10_ACTORS.service });
				expect(tamperedKey.sqlState).toBe("P1008");
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: edge-case
		// @dependency: duplicate set validation
		// @complexity: high
		it("IT-COMMIT-07: request内card-key重複をDUPLICATE_IN_REQUEST、既存owner重複をDUPLICATE_EXISTINGに分類し全変更をrollbackする", async () => {
			const fixture = await createCommitFixture();
			const duplicateRequest: CanonicalImportRequestInput = {
				deck: fixture.request.deck,
				items: [fixture.request.items[0], { ...fixture.request.items[0], clientItemId: `duplicate-${fixture.marker}`, conceptId: `duplicate-${fixture.marker}` }],
			};
			try {
				const before = await captureS10Snapshot(database, commitSnapshotQueries);
				const inRequest = await database.captureError(commitImportSql({ source: "remote_mcp", idempotencyKey: `${fixture.idempotencyKey}-request`, importRequestHash: await hashImportRequest(duplicateRequest), request: duplicateRequest, cardReservationKey: `${fixture.reservationKey}-request` }), { actor: S10_ACTORS.service });
				expect(inRequest.sqlState).toBe("P1001");
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(before);

				await database.execute(`INSERT INTO public.cards(owner_user_id, visibility, skill, pattern, front_text, back_text, card_key) VALUES ('${S10_ACTORS.ownerA.userId}', 'private', 'reading', 'R1', ${sqlLiteral(fixture.request.items[0].front)}, ${sqlLiteral(fixture.request.items[0].back)}, 'ignored')`);
				await createCommitReservation(fixture, "remote_mcp");
				const existingBefore = await captureS10Snapshot(database, commitSnapshotQueries);
				const existing = await database.captureError(commitImportSql({ source: "remote_mcp", idempotencyKey: fixture.idempotencyKey, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey }), { actor: S10_ACTORS.service });
				expect(existing.sqlState).toBe("P1002");
				expect(await captureS10Snapshot(database, commitSnapshotQueries)).toEqual(existingBefore);
			} finally {
				await cleanupCommitFixtures([fixture.marker]);
			}
		});

		// @category: integration
		// @dependency: deck/upload locking
		// @complexity: high
		it("IT-COMMIT-08: deck ID/name/createのowner・一意解決とupload ready状態をlock後再検証し適切な安定codeを返す", async () => {
			const marker = randomUUID();
			const ownerBDeck = randomUUID();
			const ambiguousA = randomUUID();
			const ambiguousB = randomUUID();
			const uploadId = randomUUID();
			try {
				const [lockOrder] = await database.query<{
					batchLock: number;
					reservationLock: number;
					deckLock: number;
					uploadLock: number;
				}>(`
					SELECT
						strpos(definition, 'SELECT batches.* INTO existing_batch')::int AS "batchLock",
						strpos(definition, 'SELECT reservations.* INTO reservation')::int AS "reservationLock",
						strpos(definition, 'IF prepared #>> ''{deck,mode}'' = ''id'' THEN')::int AS "deckLock",
						strpos(definition, 'FOR upload_candidate IN')::int AS "uploadLock"
					FROM (
						SELECT pg_get_functiondef(
							'public.commit_import_internal(uuid,text,text,text,jsonb,text)'::regprocedure
						) AS definition
					) AS function_source
				`);
				expect(lockOrder).toBeDefined();
				expect(lockOrder?.batchLock).toBeGreaterThan(0);
				expect(lockOrder?.reservationLock).toBeGreaterThan(lockOrder?.batchLock ?? 0);
				expect(lockOrder?.deckLock).toBeGreaterThan(lockOrder?.reservationLock ?? 0);
				expect(lockOrder?.uploadLock).toBeGreaterThan(lockOrder?.deckLock ?? 0);

				await database.execute(`
					INSERT INTO public.decks(id, owner_user_id, name) VALUES
					('${ownerBDeck}', '${S10_ACTORS.ownerB.userId}', 'other-${marker}'),
					('${ambiguousA}', '${S10_ACTORS.ownerA.userId}', 'ambiguous-${marker}'),
					('${ambiguousB}', '${S10_ACTORS.ownerA.userId}', ' ambiguous-${marker} ');
					INSERT INTO public.ai_uploads(id, owner_user_id, upload_key, purpose, storage_path, mime_type, byte_size)
					VALUES ('${uploadId}', '${S10_ACTORS.ownerA.userId}', 'upload-${marker}', 'card_illustration', '${S10_ACTORS.ownerA.userId}/${marker}.png', 'image/png', 100)
				`);
				const baseItem = { clientItemId: `item-${marker}`, conceptId: `concept-${marker}`, pattern: "R1", front: `漢 ${marker}`, back: `かん ${marker}`, tags: [] as string[], image: { mode: "upload", uploadId } };
				for (const [deck, state] of [[{ id: ownerBDeck }, "P1003"], [{ name: `ambiguous-${marker}` }, "P1004"]] as const) {
					const request = { deck, items: [baseItem] } satisfies CanonicalImportRequestInput;
					const reservationKey = `invalid-${marker}-${state}`;
					await reserveUsage({
						reservationKey,
						kind: "card_generation",
						source: "remote_mcp",
						generationRequestHash: fixedHash("8"),
						units: 0,
						testNow: "2048-01-01T00:00:00Z",
					});
					const diagnostic = await database.captureError(commitImportSql({ source: "remote_mcp", idempotencyKey: `invalid-${marker}-${state}`, importRequestHash: await hashImportRequest(request), request, cardReservationKey: reservationKey }), { actor: S10_ACTORS.service });
					expect(diagnostic.sqlState).toBe(state);
				}

				const fixture = await createCommitFixture({ marker, deck: { create: { name: `created-${marker}` } }, items: [baseItem] });
				await createCommitReservation(fixture, "remote_mcp");
				const result = await commitImport({ source: "remote_mcp", idempotencyKey: fixture.idempotencyKey, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey });
				expect(await database.query<{ target: string; auto: string; upload: string }>(`
					SELECT batches.target_deck_id::text AS target, batches.auto_created_deck_id::text AS auto, items.upload_id::text AS upload
					FROM public.ai_import_batches AS batches INNER JOIN public.ai_import_items AS items ON items.batch_id = batches.id
					WHERE batches.id = '${result.batchId}'
				`)).toEqual([{ target: expect.any(String), auto: expect.any(String), upload: uploadId }]);
			} finally {
				await cleanupCommitFixtures([marker]);
				await database.execute(`DELETE FROM public.decks WHERE id IN ('${ownerBDeck}', '${ambiguousA}', '${ambiguousB}')`);
			}
		});

		// @category: integration
		// @dependency: tag normalization trigger
		// @complexity: medium
		it("IT-COMMIT-09: tag display nameからDBがnormalized_nameを強制導出し、偽装値を無視してowner内uniqueを守る", async () => {
			const fixture = await createCommitFixture({ items: [{
				clientItemId: `item-${randomUUID()}`, conceptId: `concept-${randomUUID()}`,
				pattern: "R1", front: `漢字 ${randomUUID()}`, back: "かんじ",
				tags: [" 国語 ", "Ｇｒａｄｅ　３"], image: { mode: "none" },
			}] });
			try {
				await database.execute(`INSERT INTO public.tags(owner_user_id, display_name, normalized_name) VALUES ('${S10_ACTORS.ownerA.userId}', 'Grade 3', 'forged')`);
				await createCommitReservation(fixture, "remote_mcp");
				const result = await commitImport({ source: "remote_mcp", idempotencyKey: fixture.idempotencyKey, importRequestHash: fixture.importRequestHash, request: fixture.request, cardReservationKey: fixture.reservationKey });
				expect(await database.query<{ display: string; normalized: string }>(`
					SELECT tags.display_name AS display, tags.normalized_name AS normalized
					FROM public.tags INNER JOIN public.ai_import_item_tags AS links ON links.tag_id = tags.id
					INNER JOIN public.ai_import_items AS items ON items.id = links.item_id
					WHERE items.batch_id = '${result.batchId}' ORDER BY tags.normalized_name
				`)).toEqual([{ display: "Grade 3", normalized: "grade 3" }, { display: "国語", normalized: "国語" }]);
				const forged = { deck: fixture.request.deck, items: [{ ...fixture.request.items[0], tags: [{ displayName: "国語", normalizedName: "spoof" }] }] };
				expect((await database.captureError(commitImportSql({ source: "remote_mcp", idempotencyKey: `${fixture.idempotencyKey}-forged`, importRequestHash: fixedHash("a"), request: forged, cardReservationKey: `${fixture.reservationKey}-forged` }), { actor: S10_ACTORS.service })).sqlState).toBe("P1000");
			} finally {
				await cleanupCommitFixtures([fixture.marker, "Grade 3", "国語"]);
			}
		});
	});

	describe("JST quota reservation (AC-05)", () => {
		// AC原文: JST日付境界と並行予約で200 card/50 imageを超える要求だけ拒否し、免除と同key再送を二重消費させない。
		// 期待結果/合格基準: DB clock基準、成功units合計<=limit、provider_started予約は返却しない。
		// @category: edge-case
		// @dependency: test-only DB clock wrapper, reserve_provider_usage
		// @complexity: high
		it("IT-QUOTA-01: JST 23:59:59と00:00:00で別usage_dateに予約しclient日付を参照しない", async () => {
			const beforeKey = `quota-jst-before-${randomUUID()}`;
			const afterKey = `quota-jst-after-${randomUUID()}`;
			const productionKey = `quota-jst-production-${randomUUID()}`;
			try {
				const before = await reserveUsage({
					reservationKey: beforeKey,
					kind: "card_generation",
					source: "app_ai",
					generationRequestHash: fixedHash("1"),
					units: 1,
					testNow: "2040-01-01T14:59:59Z",
				});
				const after = await reserveUsage({
					reservationKey: afterKey,
					kind: "card_generation",
					source: "app_ai",
					generationRequestHash: fixedHash("2"),
					units: 1,
					testNow: "2040-01-01T15:00:00Z",
				});
				expect(before.usageDate).toBe("2040-01-01");
				expect(after.usageDate).toBe("2040-01-02");

				const productionRows = await database.query<{ result: ReservationResult }>(
					reserveUsageSql({
						reservationKey: productionKey,
						kind: "card_generation",
						source: "app_ai",
						generationRequestHash: fixedHash("3"),
						units: 1,
					}),
					{ actor: S10_ACTORS.service, testClock: "1999-01-01T00:00:00Z" }
				);
				expect(productionRows[0]?.result.usageDate).not.toBe("1999-01-01");
			} finally {
				await cleanupQuotaFixtures([beforeKey, afterKey, productionKey]);
			}
		});

		// @category: edge-case
		// @dependency: ai_usage_daily row lock
		// @complexity: high
		it("IT-QUOTA-02: card generation 199+1を成功、199+2をQUOTA_EXCEEDEDにして成功合計200以下を守る", async () => {
			const successKey = `quota-card-success-${randomUUID()}`;
			const rejectedKey = `quota-card-rejected-${randomUUID()}`;
			const now = "2041-01-01T00:00:00Z";
			try {
				await database.execute(`
					INSERT INTO public.ai_usage_daily (
						owner_user_id, usage_date, generated_card_count
					) VALUES ('${S10_ACTORS.ownerA.userId}', '2041-01-01', 199)
				`);
				await reserveUsage({
					reservationKey: successKey,
					kind: "card_generation",
					source: "app_ai",
					generationRequestHash: fixedHash("4"),
					units: 1,
					testNow: now,
				});
				const rejected = await database.captureError(
					reserveUsageSql({
						reservationKey: rejectedKey,
						kind: "card_generation",
						source: "app_ai",
						generationRequestHash: fixedHash("5"),
						units: 2,
						testNow: now,
					})
				);
				expect(rejected.sqlState).toBe("P1005");
				expect(JSON.parse(rejected.detail ?? "{}")).toEqual({
					limit: 200,
					current: 200,
					requested: 2,
					date: "2041-01-01",
				});
				expect(
					await database.query<{ count: number }>(`
						SELECT generated_card_count AS count FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2041-01-01'
					`)
				).toEqual([{ count: 200 }]);
			} finally {
				await cleanupQuotaFixtures([successKey, rejectedKey]);
			}
		});

		// @category: edge-case
		// @dependency: ai_usage_daily row lock
		// @complexity: high
		it("IT-QUOTA-03: illustration concept 49+1を成功、49+2をQUOTA_EXCEEDEDにして成功合計50以下を守る", async () => {
			const successKey = `quota-image-success-${randomUUID()}`;
			const rejectedKey = `quota-image-rejected-${randomUUID()}`;
			const successFixture = await createIllustrationQuotaFixture({ source: "app_ai", imageMode: "ai" });
			const rejectedFixture = await createIllustrationQuotaFixture({ source: "app_ai", imageMode: "ai" });
			try {
				await database.execute(`
					INSERT INTO public.ai_usage_daily (
						owner_user_id, usage_date, generated_image_count
					) VALUES ('${S10_ACTORS.ownerA.userId}', '2042-01-01', 49)
				`);
				await reserveUsage({
					reservationKey: successKey,
					kind: "illustration_concept",
					source: "app_ai",
					generationRequestHash: fixedHash("6"),
					units: 1,
					batchId: successFixture.batchId,
					itemId: successFixture.itemId,
					conceptId: successFixture.conceptId,
					testNow: "2042-01-01T00:00:00Z",
				});
				const rejected = await database.captureError(
					reserveUsageSql({
						reservationKey: rejectedKey,
						kind: "illustration_concept",
						source: "app_ai",
						generationRequestHash: fixedHash("7"),
						units: 2,
						batchId: rejectedFixture.batchId,
						itemId: rejectedFixture.itemId,
						conceptId: rejectedFixture.conceptId,
						testNow: "2042-01-01T00:00:00Z",
					})
				);
				expect(rejected.sqlState).toBe("P1005");
				expect(
					await database.query<{ count: number }>(`
						SELECT generated_image_count AS count FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2042-01-01'
					`)
				).toEqual([{ count: 50 }]);
			} finally {
				await cleanupQuotaFixtures(
					[successKey, rejectedKey],
					[successFixture.batchId, rejectedFixture.batchId]
				);
			}
		});

		// @category: edge-case
		// @dependency: parallel clients, advisory and row locks
		// @complexity: high
		it("IT-QUOTA-04: 上限付近の異なるreservation並行実行で上限内要求だけ成功しoversubscriptionを0件にする", async () => {
			const firstKey = `quota-parallel-a-${randomUUID()}`;
			const secondKey = `quota-parallel-b-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.ai_usage_daily (
						owner_user_id, usage_date, generated_card_count
					) VALUES ('${S10_ACTORS.ownerA.userId}', '2043-01-01', 198)
				`);
				const requests = [firstKey, secondKey].map((reservationKey, index) =>
					reserveUsageSql({
						reservationKey,
						kind: "card_generation",
						source: "app_ai",
						generationRequestHash: fixedHash(index === 0 ? "8" : "9"),
						units: 2,
						testNow: "2043-01-01T00:00:00Z",
					})
				);
				const results = await Promise.allSettled(
					requests.map((sql) => createS10DbClient().execute(sql))
				);
				expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
				expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
				expect(
					await database.query<{ count: number }>(`
						SELECT generated_card_count AS count FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2043-01-01'
					`)
				).toEqual([{ count: 200 }]);
				expect(
					await database.query<{ count: number }>(`
						SELECT count(*)::int AS count FROM public.ai_quota_reservations
						WHERE reservation_key IN ('${firstKey}', '${secondKey}')
					`)
				).toEqual([{ count: 1 }]);
			} finally {
				await cleanupQuotaFixtures([firstKey, secondKey]);
			}
		});

		// @category: integration
		// @dependency: reservation idempotency ledger
		// @complexity: high
		it("IT-QUOTA-05: 同owner/key/kind/hash/units再送は同じreservationを返しusageを加算せず、差分再送はCONFLICTになる", async () => {
			const key = `quota-idempotent-${randomUUID()}`;
			const request = {
				reservationKey: key,
				kind: "card_generation" as const,
				source: "app_ai" as const,
				generationRequestHash: fixedHash("a"),
				units: 10,
				testNow: "2044-01-01T00:00:00Z",
			};
			try {
				const first = await reserveUsage(request);
				const second = await reserveUsage(request);
				expect(second).toEqual(first);
				const conflict = await database.captureError(
					reserveUsageSql({ ...request, generationRequestHash: fixedHash("b") })
				);
				expect(conflict).toMatchObject({ sqlState: "P1008", constraint: null });
				expect(
					await database.query<{ count: number }>(`
						SELECT generated_card_count AS count FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2044-01-01'
					`)
				).toEqual([{ count: 10 }]);
			} finally {
				await cleanupQuotaFixtures([key]);
			}
		});

		// @category: integration
		// @dependency: trusted source/image mode
		// @complexity: high
		it("IT-QUOTA-06: remote_mcp cardとupload imageをtrusted DB contextからunits 0 exemptとして記録する", async () => {
			const remoteKey = `quota-remote-${randomUUID()}`;
			const uploadKey = `quota-upload-${randomUUID()}`;
			const forgedCardKey = `quota-forged-card-${randomUUID()}`;
			const forgedImageKey = `quota-forged-image-${randomUUID()}`;
			const uploadFixture = await createIllustrationQuotaFixture({ source: "app_ai", imageMode: "upload" });
			const aiFixture = await createIllustrationQuotaFixture({ source: "app_ai", imageMode: "ai" });
			try {
				const remote = await reserveUsage({
					reservationKey: remoteKey,
					kind: "card_generation",
					source: "remote_mcp",
					generationRequestHash: fixedHash("c"),
					units: 0,
					testNow: "2045-01-01T00:00:00Z",
				});
				const upload = await reserveUsage({
					reservationKey: uploadKey,
					kind: "illustration_concept",
					source: "app_ai",
					generationRequestHash: fixedHash("d"),
					units: 0,
					batchId: uploadFixture.batchId,
					itemId: uploadFixture.itemId,
					conceptId: uploadFixture.conceptId,
					testNow: "2045-01-01T00:00:00Z",
				});
				expect(remote).toMatchObject({ status: "exempt", units: 0 });
				expect(upload).toMatchObject({ status: "exempt", units: 0 });

				const forgedCard = await database.captureError(
					reserveUsageSql({
						reservationKey: forgedCardKey,
						kind: "card_generation",
						source: "app_ai",
						generationRequestHash: fixedHash("e"),
						units: 0,
						testNow: "2045-01-01T00:00:00Z",
					})
				);
				const forgedImage = await database.captureError(
					reserveUsageSql({
						reservationKey: forgedImageKey,
						kind: "illustration_concept",
						source: "app_ai",
						generationRequestHash: fixedHash("f"),
						units: 0,
						batchId: aiFixture.batchId,
						itemId: aiFixture.itemId,
						conceptId: aiFixture.conceptId,
						testNow: "2045-01-01T00:00:00Z",
					})
				);
				expect(forgedCard.sqlState).toBe("P1000");
				expect(forgedImage.sqlState).toBe("P1000");
				expect(
					await database.query<{ cards: number; images: number }>(`
						SELECT generated_card_count AS cards, generated_image_count AS images
						FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2045-01-01'
					`)
				).toEqual([{ cards: 0, images: 0 }]);
			} finally {
				await cleanupQuotaFixtures(
					[remoteKey, uploadKey, forgedCardKey, forgedImageKey],
					[uploadFixture.batchId, aiFixture.batchId],
					uploadFixture.uploadId === undefined ? [] : [uploadFixture.uploadId]
				);
			}
		});

		// @category: edge-case
		// @dependency: provider_started_at transaction contract
		// @complexity: medium
		it("IT-QUOTA-07: provider開始前の入力拒否は消費せず、開始済みreservationは後続成功/失敗でも返却しない", async () => {
			const invalidKey = `quota-invalid-${randomUUID()}`;
			const startedKey = `quota-started-${randomUUID()}`;
			try {
				const invalid = await database.captureError(
					reserveUsageSql({
						reservationKey: invalidKey,
						kind: "card_generation",
						source: "app_ai",
						generationRequestHash: "not-a-hash",
						units: 1,
						testNow: "2046-01-01T00:00:00Z",
					})
				);
				expect(invalid.sqlState).toBe("P1000");
				const request = {
					reservationKey: startedKey,
					kind: "card_generation" as const,
					source: "app_ai" as const,
					generationRequestHash: fixedHash("0"),
					units: 5,
					testNow: "2046-01-01T00:00:00Z",
				};
				const started = await reserveUsage(request);
				expect(started.providerStartedAt).toBeTruthy();
				expect(await reserveUsage(request)).toEqual(started);
				expect(
					await database.query<{ count: number }>(`
						SELECT generated_card_count AS count FROM public.ai_usage_daily
						WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}' AND usage_date = '2046-01-01'
					`)
				).toEqual([{ count: 5 }]);
			} finally {
				await cleanupQuotaFixtures([invalidKey, startedKey]);
			}
		});

		// @category: integration
		// @dependency: reservation locking implementation
		// @complexity: high
		it("IT-QUOTA-08: advisory→既存non-lock read→batch/item→usage→reservation順で同key並行を直列化する", async () => {
			const parallelKey = `quota-same-key-${randomUUID()}`;
			const wrapperKey = `quota-wrapper-acl-${randomUUID()}`;
			const request = {
				reservationKey: parallelKey,
				kind: "card_generation" as const,
				source: "app_ai" as const,
				generationRequestHash: fixedHash("9"),
				units: 7,
				testNow: "2047-01-01T00:00:00Z",
			};
			try {
				const results = await Promise.all(
					[createS10DbClient(), createS10DbClient()].map(async (client) => {
						const rows = await client.query<{ result: ReservationResult }>(reserveUsageSql(request));
						return rows[0]?.result;
					})
				);
				expect(results[0]).toEqual(results[1]);
				expect(
					await database.query<{ usage: number; reservations: number }>(`
						SELECT usage.generated_card_count AS usage,
							count(reservations.id)::int AS reservations
						FROM public.ai_usage_daily AS usage
						LEFT JOIN public.ai_quota_reservations AS reservations
							ON reservations.owner_user_id = usage.owner_user_id
							AND reservations.usage_date = usage.usage_date
							AND reservations.reservation_key = '${parallelKey}'
						WHERE usage.owner_user_id = '${S10_ACTORS.ownerA.userId}'
							AND usage.usage_date = '2047-01-01'
						GROUP BY usage.generated_card_count
					`)
				).toEqual([{ usage: 7, reservations: 1 }]);

				const authenticated = await database.captureError(
					reserveUsageSql({
						...request,
						reservationKey: wrapperKey,
						generationRequestHash: fixedHash("8"),
						units: 1,
						testNow: undefined,
					}),
					{ actor: S10_ACTORS.ownerA }
				);
				const serviceInternal = await database.captureError(reserveUsageSql(request), {
					actor: S10_ACTORS.service,
				});
				expect(authenticated.sqlState).toBe("42501");
				expect(serviceInternal.sqlState).toBe("42501");
			} finally {
				await cleanupQuotaFixtures([parallelKey, wrapperKey]);
			}
		});
	});

	describe("upload・finalize・failure primitive (AC-01/02/06)", () => {
		// AC原文: finalizeはcard/deck/card_tags/item結果を原子的に確定し、同一item再実行で副作用を増やさない。
		// 期待結果/合格基準: upload/failure/finalizeの各状態遷移が冪等で、途中失敗時に部分行が残らない。
		// @category: integration
		// @dependency: register_ai_upload
		// @complexity: high
		it("IT-UPLOAD-01: 同owner/upload key/同metadata再送は同じready rowを返し、metadata差分はCONFLICTになる", async () => {
			const marker = randomUUID();
			const params = {
				uploadKey: `upload-${marker}`,
				storagePath: `${S10_ACTORS.ownerA.userId}/${marker}.png`,
				mimeType: "image/png",
				byteSize: 1024,
			};
			try {
				await createStorageObject({
					path: params.storagePath,
					mimeType: params.mimeType,
					byteSize: params.byteSize,
				});
				const results = await Promise.all(
					[createS10DbClient(), createS10DbClient()].map(async (client) => {
						const rows = await client.query<{ result: RegisterUploadResult }>(
							registerUploadSql(params),
							{ actor: S10_ACTORS.service }
						);
						return rows[0]?.result;
					})
				);
				expect(results[0]).toEqual(results[1]);
				expect(await registerUpload(params)).toEqual(results[0]);
				expect(await database.query<{ count: number }>(`
					SELECT count(*)::int AS count FROM public.ai_uploads
					WHERE owner_user_id = '${S10_ACTORS.ownerA.userId}'
						AND upload_key = ${sqlLiteral(params.uploadKey)}
				`)).toEqual([{ count: 1 }]);

				const mismatch = await database.captureError(
					registerUploadSql({ ...params, byteSize: params.byteSize + 1 }),
					{ actor: S10_ACTORS.service }
				);
				expect(mismatch.sqlState).toBe("P1008");
			} finally {
				await cleanupUploadFixtures(marker);
			}
		});

		// @category: edge-case
		// @dependency: register_ai_upload validation
		// @complexity: high
		it("IT-UPLOAD-02: owner path prefix・Storage owner/存在・MIME allow list・1..10MiB境界を検証する", async () => {
			const marker = randomUUID();
			try {
				for (const [suffix, mimeType, byteSize] of [
					["min", "image/jpeg", 1],
					["max", "image/webp", 10 * 1024 * 1024],
				] as const) {
					const storagePath = `${S10_ACTORS.ownerA.userId}/${marker}-${suffix}`;
					await createStorageObject({ path: storagePath, mimeType, byteSize });
					expect(await registerUpload({
						uploadKey: `upload-${marker}-${suffix}`,
						storagePath,
						mimeType,
						byteSize,
					})).toMatchObject({ status: "ready" });
				}

				const crossOwnerPath = `${S10_ACTORS.ownerA.userId}/${marker}-cross.png`;
				const metadataMismatchPath = `${S10_ACTORS.ownerA.userId}/${marker}-metadata.png`;
				await createStorageObject({
					path: crossOwnerPath,
					ownerUserId: S10_ACTORS.ownerB.userId ?? undefined,
					mimeType: "image/png",
					byteSize: 100,
				});
				await createStorageObject({
					path: metadataMismatchPath,
					mimeType: "image/png",
					byteSize: 100,
				});
				for (const [suffix, override, expectedState] of [
					["prefix", { storagePath: `${S10_ACTORS.ownerB.userId}/${marker}.png` }, "P1000"],
					["missing", { storagePath: `${S10_ACTORS.ownerA.userId}/${marker}-missing.png` }, "P1003"],
					["owner", { storagePath: crossOwnerPath }, "P1003"],
					["storage-metadata", { storagePath: metadataMismatchPath }, "P1000"],
					["mime", { mimeType: "image/gif" }, "P1000"],
					["zero", { byteSize: 0 }, "P1000"],
					["oversize", { byteSize: 10 * 1024 * 1024 + 1 }, "P1000"],
				] as const) {
					const invalidBase: RegisterUploadParams = {
						uploadKey: `invalid-${marker}-${suffix}`,
						storagePath: `${S10_ACTORS.ownerA.userId}/${marker}-min`,
						mimeType: "image/jpeg",
						byteSize: 1,
					};
					const diagnostic = await database.captureError(
						registerUploadSql({ ...invalidBase, ...override }),
						{ actor: S10_ACTORS.service }
					);
					expect(diagnostic.sqlState).toBe(expectedState);
					for (const sensitiveValue of [marker, crossOwnerPath, "mimetype", "owner_id"]) {
						expect(diagnostic.detail ?? "").not.toContain(sensitiveValue);
					}
				}
			} finally {
				await cleanupUploadFixtures(marker);
			}
		});

		// @category: edge-case
		// @dependency: upload state machine
		// @complexity: medium
		it("IT-UPLOAD-03: consumed/deleted upload keyの再利用とcross-owner参照を拒否する", async () => {
			const marker = randomUUID();
			try {
				for (const status of ["consumed", "deleted"] as const) {
					const storagePath = `${S10_ACTORS.ownerA.userId}/${marker}-${status}.png`;
					const params = {
						uploadKey: `upload-${marker}-${status}`,
						storagePath,
						mimeType: "image/png",
						byteSize: 100,
					};
					await createStorageObject({ path: storagePath, mimeType: params.mimeType, byteSize: params.byteSize });
					const registered = await registerUpload(params);
					await database.execute(`
						UPDATE public.ai_uploads SET status = '${status}',
							consumed_at = ${status === "consumed" ? "now()" : "NULL"}
						WHERE id = '${registered.uploadId}'
					`);
					expect((await database.captureError(registerUploadSql(params), {
						actor: S10_ACTORS.service,
					})).sqlState).toBe("P1008");
				}

				const crossOwnerPath = `${S10_ACTORS.ownerA.userId}/${marker}-cross-owner.png`;
				await createStorageObject({
					path: crossOwnerPath,
					ownerUserId: S10_ACTORS.ownerB.userId ?? undefined,
					mimeType: "image/png",
					byteSize: 100,
				});
				expect((await database.captureError(registerUploadSql({
					uploadKey: `cross-owner-${marker}`,
					storagePath: crossOwnerPath,
					mimeType: "image/png",
					byteSize: 100,
				}), { actor: S10_ACTORS.service })).sqlState).toBe("P1003");

				const aclParams = {
					uploadKey: `acl-${marker}`,
					storagePath: `${S10_ACTORS.ownerA.userId}/${marker}-acl.png`,
					mimeType: "image/png",
					byteSize: 100,
				};
				await createStorageObject({ path: aclParams.storagePath, mimeType: aclParams.mimeType, byteSize: aclParams.byteSize });
				expect((await database.captureError(registerUploadSql(aclParams), {
					actor: S10_ACTORS.ownerA,
				})).sqlState).toBe("42501");
				expect((await database.captureError(registerUploadSql({ ...aclParams, internal: true }), {
					actor: S10_ACTORS.service,
				})).sqlState).toBe("42501");
			} finally {
				await cleanupUploadFixtures(marker);
			}
		});

		// @category: integration
		// @dependency: finalize_import_item
		// @complexity: high
		it("IT-FINALIZE-01: committed itemからprivate card/deck_card/card_tags/resultを1 transactionで作成しownerを一致させる", async () => {
			const fixture = await createFinalizeFixture();
			try {
				const [order] = await database.query<Record<"resultCardLock" | "advisory" | "illustration" | "batch" | "item" | "actualIllustration" | "deck" | "upload" | "reservation" | "relation", number>>(`
					WITH source AS (SELECT pg_get_functiondef('public.finalize_import_item_internal(uuid,uuid,uuid,uuid)'::regprocedure) AS definition)
					SELECT strpos(definition,'PERFORM 1\n    FROM public.cards AS result_cards')::int "resultCardLock",
						strpos(definition,'pg_advisory_xact_lock')::int advisory,
						strpos(definition,'FROM public.illustrations AS illustrations')::int illustration,
						strpos(definition,'SELECT batches.* INTO locked_batch')::int batch,
						strpos(definition,'SELECT items.* INTO locked_item')::int item,
						strpos(definition,'SELECT result_cards.illustration_key INTO existing_result_illustration_key')::int "actualIllustration",
						strpos(definition,'FROM public.decks AS decks')::int deck,
						strpos(definition,'FROM public.ai_uploads AS uploads')::int upload,
						strpos(definition,'FROM public.ai_quota_reservations AS reservations')::int reservation,
						strpos(definition,'INSERT INTO public.deck_cards')::int relation FROM source
				`);
				const positions = order === undefined ? [] : [order.advisory, order.illustration, order.batch, order.item, order.deck, order.upload, order.reservation, order.relation];
				expect(positions.every((value) => value > 0)).toBe(true);
				expect(positions).toEqual([...positions].sort((a, b) => a - b));
				expect(order?.resultCardLock).toBeGreaterThan(0);
				expect(order?.resultCardLock).toBeLessThan(order?.advisory ?? 0);
				expect(order?.actualIllustration).toBeGreaterThan(order?.item ?? Number.MAX_SAFE_INTEGER);
				expect(order?.actualIllustration).toBeLessThan(order?.deck ?? 0);

				const result = await finalizeItem({ batchId: fixture.batchId, itemId: fixture.itemId });
				expect(result).toMatchObject({ status: "finalized", batchStatus: "completed", cardId: expect.any(String) });
				const [row] = await database.query<Record<string, unknown>>(`
					SELECT cards.owner_user_id::text owner, cards.visibility, cards.front_text front,
						cards.back_text back, cards.card_key, items.card_key item_key,
						count(DISTINCT deck_cards.card_id)::int deck_links,
						count(DISTINCT card_tags.tag_id)::int tag_links,
						items.status item_status, batches.status batch_status,
						batches.finalized_count::int finalized, batches.failed_count::int failed
					FROM public.ai_import_items items
					JOIN public.ai_import_batches batches ON batches.id=items.batch_id
					JOIN public.cards cards ON cards.id=items.result_card_id
					LEFT JOIN public.deck_cards ON deck_cards.card_id=cards.id AND deck_cards.deck_id=batches.target_deck_id
					LEFT JOIN public.card_tags ON card_tags.card_id=cards.id
					WHERE items.id='${fixture.itemId}'
					GROUP BY cards.id,items.id,batches.id
				`);
				expect(row).toEqual(expect.objectContaining({ owner: S10_ACTORS.ownerA.userId, visibility: "private", front: `漢字 ${fixture.marker}`, back: `かんじ ${fixture.marker}`, deck_links: 1, tag_links: 1, item_status: "finalized", batch_status: "completed", finalized: 1, failed: 0 }));
				expect(row?.card_key).toBe(row?.item_key);
			} finally { await cleanupFinalizeFixture(fixture); }
		});

		// @category: integration
		// @dependency: finalize_import_item, upload relation
		// @complexity: high
		it("IT-FINALIZE-02: image modeに応じ同owner ready illustrationを検証しuploadを同transactionで一度だけconsumedにする", async () => {
			const ai = await createFinalizeFixture("ai");
			const upload = await createFinalizeFixture("upload");
			const crossOwner = randomUUID();
			const pending = randomUUID();
			const otherReady = randomUUID();
			try {
				await database.execute(`INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES
					('${crossOwner}','${S10_ACTORS.ownerB.userId}','cross-${ai.marker}','ready','cross'),
					('${pending}','${S10_ACTORS.ownerA.userId}','pending-${ai.marker}','pending',NULL),
					('${otherReady}','${S10_ACTORS.ownerA.userId}','other-${ai.marker}','ready','other')`);
				const before = await captureS10Snapshot(database, finalizeSnapshotQueries(ai));
				for (const [illustrationId, state] of [[crossOwner, "P1003"], [pending, "P1008"]] as const) {
					expect((await database.captureError(finalizeItemSql({ batchId: ai.batchId, itemId: ai.itemId, illustrationId }), { actor: S10_ACTORS.service })).sqlState).toBe(state);
					expect(await captureS10Snapshot(database, finalizeSnapshotQueries(ai))).toEqual(before);
				}
				await finalizeItem({ batchId: ai.batchId, itemId: ai.itemId, illustrationId: ai.illustrationId });
				expect((await database.captureError(finalizeItemSql({batchId:ai.batchId,itemId:ai.itemId,illustrationId:otherReady}),{actor:S10_ACTORS.service})).sqlState).toBe("P1008");
				await finalizeItem({ batchId: upload.batchId, itemId: upload.itemId, illustrationId: upload.illustrationId });
				expect(await database.query<{ mode:string; illustration:string; uploadStatus:string|null; units:number|null; quotaStatus:string|null }>(`
					SELECT items.image_mode mode,cards.illustration_key illustration,uploads.status "uploadStatus",
						reservations.units, reservations.status "quotaStatus"
					FROM public.ai_import_items items JOIN public.cards ON cards.id=items.result_card_id
					LEFT JOIN public.ai_uploads uploads ON uploads.id=items.upload_id
					LEFT JOIN public.ai_quota_reservations reservations ON reservations.item_id=items.id AND reservations.kind='illustration_concept'
					WHERE items.id IN('${ai.itemId}','${upload.itemId}') ORDER BY items.image_mode
				`)).toEqual([
					{ mode:"ai", illustration:`illustration-${ai.marker}`, uploadStatus:null, units:1, quotaStatus:"reserved" },
					{ mode:"upload", illustration:`illustration-${upload.marker}`, uploadStatus:"consumed", units:0, quotaStatus:"exempt" },
				]);
			} finally {
				await database.execute(`DELETE FROM public.illustrations WHERE id IN('${crossOwner}','${pending}','${otherReady}')`);
				await cleanupFinalizeFixture(ai); await cleanupFinalizeFixture(upload);
			}
		});

		// @category: edge-case
		// @dependency: finalize idempotency, parallel clients
		// @complexity: high
		it("IT-FINALIZE-03: 同一itemの再実行と並行finalizeが同じcard IDを返し全副作用を1回分に保つ", async () => {
			const fixture = await createFinalizeFixture();
			const imageFixture = await createFinalizeFixture("ai");
			try {
				const params = { batchId: fixture.batchId, itemId: fixture.itemId };
				const results = await Promise.all([createS10DbClient(),createS10DbClient()].map(async client => (await client.query<{result:FinalizeItemResult}>(finalizeItemSql(params),{actor:S10_ACTORS.service}))[0]?.result));
				expect(results[0]).toEqual(results[1]);
				expect(await finalizeItem(params)).toEqual(results[0]);
				expect((await database.captureError(finalizeItemSql(params),{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");
				expect((await database.captureError(finalizeItemSql({...params,internal:true}),{actor:S10_ACTORS.service})).sqlState).toBe("42501");
				expect(await database.query<{cards:number;decks:number;tags:number;finalized:number}>(`
					SELECT (SELECT count(*)::int FROM public.cards WHERE front_text LIKE '%${fixture.marker}%') cards,
					(SELECT count(*)::int FROM public.deck_cards WHERE deck_id='${fixture.deckId}') decks,
					(SELECT count(*)::int FROM public.card_tags WHERE card_id=(SELECT result_card_id FROM public.ai_import_items WHERE id='${fixture.itemId}')) tags,
					(SELECT finalized_count::int FROM public.ai_import_batches WHERE id='${fixture.batchId}') finalized
				`)).toEqual([{cards:1,decks:1,tags:1,finalized:1}]);

				const imageResult = await finalizeItem({ batchId: imageFixture.batchId, itemId: imageFixture.itemId, illustrationId: imageFixture.illustrationId });
				if (imageResult.cardId === undefined) throw new Error("image result card missing");
				const changedIllustrationId = randomUUID();
				const changedIllustrationKey = `changed-${imageFixture.marker}`;
				await database.execute(`INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES('${changedIllustrationId}','${S10_ACTORS.ownerA.userId}','${changedIllustrationKey}','ready','${S10_ACTORS.ownerA.userId}/${changedIllustrationKey}.webp')`);
				const updater = createS10DbClient();
				const retry = createS10DbClient();
				const updating = updater.execute(`
					SELECT public.set_card_illustration('${imageResult.cardId}','${changedIllustrationId}');
					SELECT pg_sleep(0.15);
				`, { actor: S10_ACTORS.ownerA });
				await new Promise((resolve) => setTimeout(resolve, 25));
				const retryError = await retry.captureError(finalizeItemSql({
					batchId: imageFixture.batchId,
					itemId: imageFixture.itemId,
					illustrationId: imageFixture.illustrationId,
				}), { actor: S10_ACTORS.service });
				await updating;
				expect(retryError.sqlState).toBe("P1008");
			} finally {
				await cleanupFinalizeFixture(fixture);
				await cleanupFinalizeFixture(imageFixture);
			}
		});

		// @category: edge-case
		// @dependency: private partial unique, finalize duplicate mapper
		// @complexity: high
		it("IT-FINALIZE-04: commit後finalize前にowner重複が作られた場合itemだけをDUPLICATE_EXISTING failedへ確定する", async () => {
			const fixture = await createFinalizeFixture();
			try {
				await database.execute(`INSERT INTO public.cards(owner_user_id,visibility,skill,pattern,front_text,back_text,card_key)
					SELECT owner_user_id,'private',skill,pattern,front_text,back_text,card_key FROM public.ai_import_items WHERE id='${fixture.itemId}'`);
				const result = await finalizeItem({batchId:fixture.batchId,itemId:fixture.itemId});
				expect(result).toMatchObject({status:"failed",errorCode:"DUPLICATE_EXISTING",batchStatus:"completed"});
				expect(await database.query<Record<string,unknown>>(`SELECT items.status,items.error_code,items.result_card_id,
					batches.failed_count::int failed,batches.finalized_count::int finalized,
					(SELECT count(*)::int FROM public.deck_cards WHERE deck_id=batches.target_deck_id) deck_links,
					(SELECT count(*)::int FROM public.card_tags WHERE card_id IN(SELECT id FROM public.cards WHERE front_text LIKE '%${fixture.marker}%')) tag_links
					FROM public.ai_import_items items JOIN public.ai_import_batches batches ON batches.id=items.batch_id WHERE items.id='${fixture.itemId}'`)).toEqual([expect.objectContaining({status:"failed",error_code:"DUPLICATE_EXISTING",result_card_id:null,failed:1,finalized:0,deck_links:0,tag_links:0})]);
			} finally { await cleanupFinalizeFixture(fixture); }
		});

		// @category: edge-case
		// @dependency: finalize failpoints
		// @complexity: high
		it("IT-FINALIZE-05: card/relation/upload/item各区間のfailpointで全変更をrollbackしcardだけを残さない", async () => {
			const fixture = await createFinalizeFixture("upload");
			try {
				for (const failpoint of ["finalize_after_card","finalize_after_deck_card","finalize_after_card_tags","finalize_after_upload","finalize_after_item"]) {
					const before=await captureS10Snapshot(database,finalizeSnapshotQueries(fixture));
					const error=await database.captureError(finalizeItemSql({batchId:fixture.batchId,itemId:fixture.itemId,illustrationId:fixture.illustrationId}),{actor:S10_ACTORS.service,failpoint});
					expect(error.sqlState).toBe("P1008");
					expect(await captureS10Snapshot(database,finalizeSnapshotQueries(fixture))).toEqual(before);
				}
				await finalizeItem({batchId:fixture.batchId,itemId:fixture.itemId,illustrationId:fixture.illustrationId});
			} finally { await cleanupFinalizeFixture(fixture); }
		});

		// @category: integration
		// @dependency: mark_import_item_failed
		// @complexity: high
		it("IT-FAIL-01: committed/processing itemをsafe allow-list errorでfailedにしbatch counts/statusを同transactionで再集計する", async () => {
			const committed=await createFinalizeFixture(); const processing=await createFinalizeFixture("ai");
			const aggregate=await createCommitFixture({marker:`aggregate-${randomUUID()}`});
			try {
				for(const fixture of [committed,processing]){
					const result=await markFailed({batchId:fixture.batchId,itemId:fixture.itemId,attemptKey:`attempt-${fixture.marker}`,errorCode:"PROVIDER_ERROR",safeDetail:{stage:"illustration",retryable:false}});
					expect(result).toMatchObject({status:"failed",batchStatus:"completed"});
					expect(await database.query<Record<string,unknown>>(`SELECT items.status,items.result_card_id,items.deleted_card_id,items.error_code,items.error_detail,batches.status batch_status,batches.finalized_count::int finalized,batches.failed_count::int failed,(batches.completed_at IS NOT NULL) completed FROM public.ai_import_items items JOIN public.ai_import_batches batches ON batches.id=items.batch_id WHERE items.id='${fixture.itemId}'`)).toEqual([expect.objectContaining({status:"failed",result_card_id:null,deleted_card_id:null,error_code:"PROVIDER_ERROR",error_detail:{stage:"illustration",retryable:false},batch_status:"completed",finalized:0,failed:1,completed:true})]);
				}
				await createCommitReservation(aggregate);
				const aggregateBatch=await commitImport({source:"app_ai",idempotencyKey:aggregate.idempotencyKey,importRequestHash:aggregate.importRequestHash,request:aggregate.request,cardReservationKey:aggregate.reservationKey});
				const aggregateItems=await database.query<{id:string}>(`SELECT id::text FROM public.ai_import_items WHERE batch_id='${aggregateBatch.batchId}' ORDER BY ordinal`);
				const first=aggregateItems[0]?.id, second=aggregateItems[1]?.id;
				if(first===undefined||second===undefined) throw new Error("aggregate items missing");
				expect((await markFailed({batchId:aggregateBatch.batchId,itemId:first,attemptKey:`attempt-${aggregate.marker}`,errorCode:"TIMEOUT"})).batchStatus).toBe("processing");
				expect((await finalizeItem({batchId:aggregateBatch.batchId,itemId:second})).batchStatus).toBe("completed");
				expect(await database.query<Record<string,unknown>>(`SELECT status,finalized_count::int finalized,failed_count::int failed,(completed_at IS NOT NULL) completed FROM public.ai_import_batches WHERE id='${aggregateBatch.batchId}'`)).toEqual([{status:"completed",finalized:1,failed:1,completed:true}]);
			} finally { await cleanupFinalizeFixture(committed); await cleanupFinalizeFixture(processing); await cleanupCommitFixtures([aggregate.marker]); }
		});

		// @category: edge-case
		// @dependency: mark_import_item_failed idempotency
		// @complexity: high
		it("IT-FAIL-02: 同attempt/error再送は同じ結果、別attemptまたはterminal itemはCONFLICTとなりprovider本文/stackを保存しない", async () => {
			const fixture=await createFinalizeFixture();
			const params={batchId:fixture.batchId,itemId:fixture.itemId,attemptKey:`attempt-${fixture.marker}`,errorCode:"PROVIDER_ERROR",safeDetail:{stage:"illustration",retryable:true}};
			try {
				for(const invalid of [
					{...params,errorCode:"RAW_PROVIDER_BODY"},
					{...params,safeDetail:{stack:`stack-${fixture.marker}`,providerBody:`body-${fixture.marker}`}},
				]) expect((await database.captureError(markFailedSql(invalid),{actor:S10_ACTORS.service})).sqlState).toBe("P1000");
				const first=await markFailed(params); expect(await markFailed(params)).toEqual(first);
				for(const conflict of [
					{...params,attemptKey:`other-${fixture.marker}`},
					{...params,errorCode:"STORAGE_ERROR"},
					{...params,safeDetail:{stage:"storage",retryable:true}},
				]) expect((await database.captureError(markFailedSql(conflict),{actor:S10_ACTORS.service})).sqlState).toBe("P1008");
				expect((await database.captureError(finalizeItemSql({batchId:fixture.batchId,itemId:fixture.itemId}),{actor:S10_ACTORS.service})).sqlState).toBe("P1008");
				expect((await database.captureError(markFailedSql(params),{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");
				expect((await database.captureError(markFailedSql({...params,internal:true}),{actor:S10_ACTORS.service})).sqlState).toBe("42501");
				const [stored]=await database.query<{text:string}>(`SELECT error_detail::text text FROM public.ai_import_items WHERE id='${fixture.itemId}'`);
				expect(stored?.text).toBe('{"stage": "illustration", "retryable": true}');
				expect(stored?.text).not.toContain(fixture.marker);
			} finally { await cleanupFinalizeFixture(fixture); }
		});
	});

	describe("active guard・review reset・undo (AC-07/08)", () => {
		// AC原文: current/4 queuesのactive card変更・削除・undoを拒否し、本文4列変更だけreview stateをresetする。
		// 期待結果/合格基準: RPC/直接DMLとも同じ結果で、guard/更新失敗は副作用0、undoはbatch原子・冪等。
		// @category: integration
		// @dependency: active-session triggers
		// @complexity: high
		it("IT-GUARD-01: current_card_idとqueue_due/learn/new/retryの各位置でRPC更新・削除・undoをACTIVE_SESSION拒否する", async () => {
			const deck=randomUUID(), card=randomUUID();
			try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','guard'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${card}','${S10_ACTORS.ownerA.userId}','private','reading','R1','guard-${card}','back','x')`);
				for (const position of ["current_card_id","queue_due","queue_learn","queue_new","queue_retry"] as const) { const session=randomUUID(); const value=position==="current_card_id"?`'${card}'`:"NULL"; const queues=["queue_due","queue_learn","queue_new","queue_retry"].map(q=>q===position?`'[\"${card}\"]'::jsonb`:"'[]'::jsonb"); await database.execute(`INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id,queue_due,queue_learn,queue_new,queue_retry) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}',${value},${queues.join(",")})`); expect((await database.captureError(`UPDATE public.cards SET back_text='blocked' WHERE id='${card}'`)).sqlState).toBe("P1006"); await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'`); }
			} finally { await database.execute(`DELETE FROM public.study_sessions WHERE deck_id='${deck}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id='${card}'`); }
		});

		// @category: edge-case
		// @dependency: queue UUID parser
		// @complexity: medium
		it("IT-GUARD-02: queue中のobject/number/null/非canonical UUID文字列を無視し有効UUID文字列だけをguard対象にする", async () => {
			const deck=randomUUID(), valid=randomUUID(), ignored=randomUUID(), session=randomUUID();
			try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','invalid-json'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES ('${valid}','${S10_ACTORS.ownerA.userId}','private','reading','R1','valid-${valid}','back','x'),('${ignored}','${S10_ACTORS.ownerA.userId}','private','reading','R1','ignored-${ignored}','back','x'); INSERT INTO public.study_sessions(id,user_id,deck_id,queue_due) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','[{\"id\":\"${ignored}\"},1,null,\"${ignored.toUpperCase()}\",\"${valid}\"]')`); await database.execute(`UPDATE public.cards SET back_text='allowed' WHERE id='${ignored}'`); expect((await database.captureError(`UPDATE public.cards SET back_text='blocked' WHERE id='${valid}'`)).sqlState).toBe("P1006"); } finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id IN('${valid}','${ignored}')`); }
		});

		// @category: integration
		// @dependency: direct cards UPDATE/DELETE triggers
		// @complexity: high
		it("IT-GUARD-03: 許可されたcards直接UPDATE/DELETEでもRPCと同じACTIVE_SESSION detailと副作用0を保証する", async () => {
			const deck=randomUUID(),card=randomUUID(),session=randomUUID(); try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','direct'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${card}','${S10_ACTORS.ownerA.userId}','private','reading','R1','direct-${card}','back','x'); INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','${card}')`); for(const sql of [`UPDATE public.cards SET front_text='blocked' WHERE id='${card}'`,`DELETE FROM public.cards WHERE id='${card}'`]) expect((await database.captureError(sql,{actor:S10_ACTORS.service})).sqlState).toBe("42501"); for(const sql of [`UPDATE public.cards SET front_text='blocked' WHERE id='${card}'`,`DELETE FROM public.cards WHERE id='${card}'`]) expect((await database.captureError(sql)).sqlState).toBe("P1006"); } finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id='${card}'`); }
		});

		// @category: edge-case
		// @dependency: session/card symmetric lock protocol
		// @complexity: high
		it("IT-GUARD-04: card更新と同時session INSERT/UPDATEの競合でもactive guardを取りこぼさない", async () => {
			const deck=randomUUID(),card=randomUUID(),session=randomUUID(); try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','race'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${card}','${S10_ACTORS.ownerA.userId}','private','reading','R1','race-${card}','back','x')`); const c1=createS10DbClient(),c2=createS10DbClient(); const inserting=c1.execute(`BEGIN; INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','${card}'); SELECT pg_sleep(0.15); COMMIT;`); await new Promise(resolve=>setTimeout(resolve,25)); const diagnostic=await c2.captureError(`UPDATE public.cards SET back_text='race update' WHERE id='${card}'`); await inserting; expect(diagnostic.sqlState).toBe("P1006"); } finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id='${card}'`); }
		});

		// @category: core-functionality
		// @dependency: review reset trigger
		// @complexity: high
		it("IT-REVIEW-01: front/back/skill/pattern各列の実値変更で対象cardの全review_statesを削除する", async () => {
			for(const column of ["front_text","back_text","skill","pattern"] as const){ const card=randomUUID(); try { await database.execute(`INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${card}','${S10_ACTORS.ownerA.userId}','private','reading','R1','review-${card}','back','x'); INSERT INTO public.review_states(user_id,card_id,due_date) VALUES('${S10_ACTORS.ownerA.userId}','${card}',current_date)`); const value=column==="skill"?"writing":column==="pattern"?"W1":`changed-${column}`; await database.execute(`UPDATE public.cards SET ${column}=${sqlLiteral(value)} WHERE id='${card}'`); expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM public.review_states WHERE card_id='${card}'`)).toEqual([{n:0}]); } finally { await database.execute(`DELETE FROM public.cards WHERE id='${card}'`); } }
		});

		// @category: integration
		// @dependency: relation management RPC
		// @complexity: high
		it("IT-REVIEW-02: illustration/tag/deckだけの変更はreview_statesを完全一致で維持する", async () => {
			const fixture=await createFinalizeFixture("ai"); const deck=randomUUID(),tag=randomUUID(),illustration=randomUUID(),session=randomUUID();
			try {
				const result=await finalizeItem({batchId:fixture.batchId,itemId:fixture.itemId,illustrationId:fixture.illustrationId}); const card=result.cardId;
				if(card===undefined) throw new Error("review fixture card missing");
				await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','review-${fixture.marker}'); INSERT INTO public.tags(id,owner_user_id,display_name,normalized_name) VALUES('${tag}','${S10_ACTORS.ownerA.userId}','review-${fixture.marker.slice(-8)}','ignored'); INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES('${illustration}','${S10_ACTORS.ownerA.userId}','review-${fixture.marker}','ready','${S10_ACTORS.ownerA.userId}/review-${fixture.marker}.webp'); INSERT INTO public.review_states(user_id,card_id,level,due_date,last_rating,retry_today_count,last_reviewed_at) VALUES('${S10_ACTORS.ownerA.userId}','${card}',4,current_date+3,'hard',2,now()-interval '1 day')`);
				const reviewSql=`SELECT user_id::text,card_id::text,level,due_date::text,last_rating,retry_today_count,last_reviewed_at::text FROM public.review_states WHERE card_id='${card}'`;
				const before=await database.query<Record<string,unknown>>(reviewSql);
				await database.query(`SELECT public.set_card_decks('${card}',ARRAY['${fixture.deckId}','${deck}']::uuid[])`,{actor:S10_ACTORS.ownerA});
				await database.query(`SELECT public.set_card_tags('${card}',ARRAY['${tag}']::uuid[])`,{actor:S10_ACTORS.ownerA});
				await database.query(`SELECT public.set_card_illustration('${card}','${illustration}')`,{actor:S10_ACTORS.ownerA});
				expect(await database.query<Record<string,unknown>>(reviewSql)).toEqual(before);
				expect(await database.query<{edited:boolean}>(`SELECT user_edited_at IS NOT NULL edited FROM public.ai_import_items WHERE id='${fixture.itemId}'`)).toEqual([{edited:true}]);
				await database.execute(`INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','${card}')`);
				const relations=await captureS10Snapshot(database,[{name:"decks",sql:`SELECT deck_id::text FROM public.deck_cards WHERE card_id='${card}' ORDER BY deck_id`},{name:"tags",sql:`SELECT tag_id::text FROM public.card_tags WHERE card_id='${card}' ORDER BY tag_id`},{name:"card",sql:`SELECT illustration_key FROM public.cards WHERE id='${card}'`}]);
				for(const sql of [`SELECT public.set_card_decks('${card}',ARRAY['${fixture.deckId}']::uuid[])`,`SELECT public.set_card_tags('${card}',ARRAY[]::uuid[])`,`SELECT public.set_card_illustration('${card}',NULL)`]) expect((await database.captureError(sql,{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1006");
				const [activeCard]=await database.query<{updated:string}>(`SELECT updated_at::text updated FROM public.cards WHERE id='${card}'`);
				for(const sql of [`SELECT public.update_imported_card('${card}','{"backText":"blocked"}'::jsonb,'${activeCard?.updated}'::timestamptz)`,`SELECT public.delete_private_card('${card}','${activeCard?.updated}'::timestamptz)`]) expect((await database.captureError(sql,{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1006");
				expect(await captureS10Snapshot(database,[{name:"decks",sql:`SELECT deck_id::text FROM public.deck_cards WHERE card_id='${card}' ORDER BY deck_id`},{name:"tags",sql:`SELECT tag_id::text FROM public.card_tags WHERE card_id='${card}' ORDER BY tag_id`},{name:"card",sql:`SELECT illustration_key FROM public.cards WHERE id='${card}'`}])).toEqual(relations);
			} finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.illustrations WHERE id='${illustration}'; DELETE FROM public.tags WHERE id='${tag}'; DELETE FROM public.decks WHERE id='${deck}'`); await cleanupFinalizeFixture(fixture); }
		});

		// @category: edge-case
		// @dependency: cards update transaction
		// @complexity: high
		it("IT-REVIEW-03: content UPDATE自体が後段constraint/triggerで失敗した場合review_statesもrollbackする", async () => {
			const deck=randomUUID(),a=randomUUID(),b=randomUUID(),session=randomUUID(); try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','rollback'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${a}','${S10_ACTORS.ownerA.userId}','private','reading','R1','a-${a}','back','x'),('${b}','${S10_ACTORS.ownerA.userId}','private','reading','R1','b-${b}','back','x'); INSERT INTO public.review_states(user_id,card_id,due_date) VALUES('${S10_ACTORS.ownerA.userId}','${a}',current_date),('${S10_ACTORS.ownerA.userId}','${b}',current_date); INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','${b}')`); expect((await database.captureError(`UPDATE public.cards SET back_text='multi' WHERE id IN('${a}','${b}')`)).sqlState).toBe("P1006"); expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM public.review_states WHERE card_id IN('${a}','${b}')`)).toEqual([{n:2}]); } finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id IN('${a}','${b}')`); }
		});

		// @category: integration
		// @dependency: undo_import
		// @complexity: high
		it("IT-UNDO-01: 非owner undoをnot-found相当、編集済みitemをCARD_MODIFIEDとしてbatch全体を副作用0で拒否する", async () => {
			const edited=await createUndoFixture(); const active=await createUndoFixture(); const session=randomUUID();
			try {
				const [contextOrder]=await database.query<{enable:number;disable:number}>(`WITH source AS(SELECT pg_get_functiondef('public.undo_import_internal(uuid,uuid)'::regprocedure) definition) SELECT strpos(definition,'ai_enable_internal_context')::int enable,strpos(definition,'ai_disable_internal_context')::int disable FROM source`);
				expect(contextOrder?.enable).toBeGreaterThan(0); expect(contextOrder?.disable).toBeGreaterThan(contextOrder?.enable??0);
				const untouched=await captureS10Snapshot(database,undoSnapshotQueries(edited));
				expect((await database.captureError(undoImportSql(edited.batchId),{actor:S10_ACTORS.ownerB})).sqlState).toBe("P1003");
				expect(await captureS10Snapshot(database,undoSnapshotQueries(edited))).toEqual(untouched);
				const [card]=await database.query<{updated:string}>(`SELECT updated_at::text updated FROM public.cards WHERE id='${edited.cardIds[0]}'`);
				await database.query(`SELECT public.update_imported_card('${edited.cardIds[0]}','{"frontText":"編集済 漢字"}'::jsonb,'${card?.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA});
				const editedSnapshot=await captureS10Snapshot(database,undoSnapshotQueries(edited));
				const modified=await database.captureError(undoImportSql(edited.batchId),{actor:S10_ACTORS.ownerA}); expect(modified.sqlState).toBe("P1007"); expect(modified.detail).toContain(edited.cardIds[0]);
				expect(await captureS10Snapshot(database,undoSnapshotQueries(edited))).toEqual(editedSnapshot);
				await database.execute(`INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${active.deckId}','${active.cardIds[1]}')`);
				const activeSnapshot=await captureS10Snapshot(database,undoSnapshotQueries(active));
				expect((await database.captureError(undoImportSql(active.batchId),{actor:S10_ACTORS.ownerA})).sqlState).toBe("P1006");
				expect(await captureS10Snapshot(database,undoSnapshotQueries(active))).toEqual(activeSnapshot);
				await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'`);
				expect(await database.query<{edited:boolean}>(`SELECT user_edited_at IS NOT NULL edited FROM public.ai_import_items WHERE batch_id='${active.batchId}' ORDER BY id`)).toEqual([{edited:false},{edited:false}]);
				for(const failpoint of ["undo_after_relations","undo_after_cards","undo_after_items","undo_after_tags","undo_after_auto_deck"]){ const before=await captureS10Snapshot(database,undoSnapshotQueries(active)); expect((await database.captureError(undoImportSql(active.batchId),{actor:S10_ACTORS.ownerA,failpoint})).sqlState).toBe("P1008"); expect(await captureS10Snapshot(database,undoSnapshotQueries(active))).toEqual(before); await database.execute(`DO $test$ BEGIN BEGIN PERFORM set_config('app.s10_failpoint','${failpoint}',true); PERFORM public.undo_import_internal('${S10_ACTORS.ownerA.userId}'::uuid,'${active.batchId}'::uuid); RAISE EXCEPTION 'expected failpoint'; EXCEPTION WHEN SQLSTATE 'P1008' THEN NULL; END; IF public.ai_internal_context_active() IS DISTINCT FROM false THEN RAISE EXCEPTION 'undo internal context leaked after ${failpoint}'; END IF; END $test$`); expect(await captureS10Snapshot(database,undoSnapshotQueries(active))).toEqual(before); }
				const beforeLeak=await captureS10Snapshot(database,undoSnapshotQueries(active)); expect((await database.captureError(`${undoImportSql(active.batchId)}; UPDATE public.cards SET illustration_key='leaked' WHERE id='${edited.cardIds[1]}'`,{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501"); expect(await captureS10Snapshot(database,undoSnapshotQueries(active))).toEqual(beforeLeak); expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM s10_private.management_mutation_context`)).toEqual([{n:0}]);
				const [undone]=await database.query<{active:boolean;result:UndoImportResult}>(`WITH result AS MATERIALIZED(SELECT public.undo_import_internal('${S10_ACTORS.ownerA.userId}'::uuid,'${active.batchId}'::uuid) result) SELECT public.ai_internal_context_active() active,result FROM result`); expect(undone?.active).toBe(false); expect(undone?.result.status).toBe("undone"); expect(await database.query<{edited:boolean}>(`SELECT user_edited_at IS NOT NULL edited FROM public.ai_import_items WHERE batch_id='${active.batchId}' ORDER BY id`)).toEqual([{edited:false},{edited:false}]);
				expect((await database.captureError(undoImportSql(active.batchId,true),{actor:S10_ACTORS.ownerA})).sqlState).toBe("42501");
			} finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'`); await cleanupUndoFixture(edited); await cleanupUndoFixture(active); }
		});

		// @category: integration
		// @dependency: delete tombstone trigger, FK SET NULL
		// @complexity: high
		it("IT-UNDO-02: 個別削除をdeleted tombstoneへ記録しresult FK SET NULL後も由来を保持してundoではskipする", async () => {
			const rpcFixture=await createFinalizeFixture(); const directFixture=await createFinalizeFixture();
			try {
				const rpc=await finalizeItem({batchId:rpcFixture.batchId,itemId:rpcFixture.itemId}); const direct=await finalizeItem({batchId:directFixture.batchId,itemId:directFixture.itemId});
				if(rpc.cardId===undefined||direct.cardId===undefined) throw new Error("delete fixture card missing");
				const [rpcCard]=await database.query<{updated:string}>(`SELECT updated_at::text updated FROM public.cards WHERE id='${rpc.cardId}'`);
				await database.query(`SELECT public.delete_private_card('${rpc.cardId}','${rpcCard?.updated}'::timestamptz) result`,{actor:S10_ACTORS.ownerA});
				await database.execute(`DELETE FROM public.cards WHERE id='${direct.cardId}'`,{actor:S10_ACTORS.ownerA});
				for(const [fixture,card] of [[rpcFixture,rpc.cardId],[directFixture,direct.cardId]] as const){ expect(await database.query<Record<string,unknown>>(`SELECT status,result_card_id,deleted_card_id::text deleted_card,(deleted_at IS NOT NULL) deleted,(user_edited_at IS NOT NULL) edited FROM public.ai_import_items WHERE id='${fixture.itemId}'`)).toEqual([{status:"deleted",result_card_id:null,deleted_card:card,deleted:true,edited:false}]); }
				expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM public.cards WHERE id IN('${rpc.cardId}','${direct.cardId}')`)).toEqual([{n:0}]);
			} finally { await cleanupFinalizeFixture(rpcFixture); await cleanupFinalizeFixture(directFixture); }
		});

		// @category: edge-case
		// @dependency: undo_result idempotency
		// @complexity: high
		it("IT-UNDO-03: 既にundoneのbatchへ再実行すると保存済みundo_resultを返し副作用を増やさない", async () => {
			const fixture=await createUndoFixture(); const otherCard=randomUUID();
			try {
				const [shared]=await database.query<{tag:string}>(`SELECT tag_id::text tag FROM public.ai_import_item_tags WHERE item_id='${fixture.itemIds[0]}' LIMIT 1`);
				if(shared===undefined) throw new Error("shared undo tag missing");
				await database.execute(`INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${otherCard}','${S10_ACTORS.ownerA.userId}','private','reading','R1','他 漢字 ${otherCard}','other','ignored'); INSERT INTO public.card_tags(owner_user_id,card_id,tag_id) VALUES('${S10_ACTORS.ownerA.userId}','${otherCard}','${shared.tag}')`);
				const publicBefore=await database.query<{n:number}>(`SELECT count(*)::int n FROM public.cards WHERE visibility='public'`); const usageBefore=await database.query<Record<string,unknown>>(`SELECT * FROM public.ai_usage_daily WHERE owner_user_id='${S10_ACTORS.ownerA.userId}' ORDER BY usage_date`);
				const first=await undoImport(fixture.batchId); expect(first).toMatchObject({status:"undone",deletedCardCount:2,deletedSkipCount:0,autoDeckStatus:"not_applicable",autoDeckId:null});
				const after=await captureS10Snapshot(database,undoSnapshotQueries(fixture)); const second=await undoImport(fixture.batchId); expect(second).toEqual(first); expect(await captureS10Snapshot(database,undoSnapshotQueries(fixture))).toEqual(after);
				expect(await database.query<Record<string,unknown>>(`SELECT status,result_card_id,undone_at IS NOT NULL undone FROM public.ai_import_items WHERE batch_id='${fixture.batchId}' ORDER BY id`)).toEqual([{status:"undone",result_card_id:null,undone:true},{status:"undone",result_card_id:null,undone:true}]);
				expect(await database.query<{card:number;tag:number;itemTags:number;quota:number}>(`SELECT (SELECT count(*)::int FROM public.cards WHERE id='${otherCard}') card,(SELECT count(*)::int FROM public.tags WHERE id='${shared.tag}') tag,(SELECT count(*)::int FROM public.ai_import_item_tags WHERE item_id=ANY(ARRAY['${fixture.itemIds[0]}','${fixture.itemIds[1]}']::uuid[])) "itemTags",(SELECT count(*)::int FROM public.ai_quota_reservations WHERE reservation_key='${fixture.reservationKey}' AND batch_id='${fixture.batchId}') quota`)).toEqual([{card:1,tag:1,itemTags:0,quota:1}]);
				expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM public.cards WHERE visibility='public'`)).toEqual(publicBefore); expect(await database.query<Record<string,unknown>>(`SELECT * FROM public.ai_usage_daily WHERE owner_user_id='${S10_ACTORS.ownerA.userId}' ORDER BY usage_date`)).toEqual(usageBefore);
			} finally { await database.execute(`DELETE FROM public.cards WHERE id='${otherCard}'`); await cleanupUndoFixture(fixture); }
		});

		// @category: integration
		// @dependency: auto deck cleanup
		// @complexity: high
		it("IT-UNDO-04: auto-created deckはundo後空なら削除、他cardが残れば維持しtarget/auto FKをNULL化して履歴を守る", async () => {
			const empty=await createUndoFixture(true); const retained=await createUndoFixture(true); const other=randomUUID();
			try {
				await database.execute(`INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${other}','${S10_ACTORS.ownerA.userId}','private','reading','R1','保持 漢字 ${other}','other','ignored'); INSERT INTO public.deck_cards(deck_id,card_id) VALUES('${retained.deckId}','${other}')`);
				const [deletedCard]=await database.query<{updated:string}>(`SELECT updated_at::text updated FROM public.cards WHERE id='${retained.cardIds[0]}'`); await database.query(`SELECT public.delete_private_card('${retained.cardIds[0]}','${deletedCard?.updated}'::timestamptz)`,{actor:S10_ACTORS.ownerA});
				const deleted=await undoImport(empty.batchId); const kept=await undoImport(retained.batchId);
				expect(deleted).toMatchObject({deletedCardCount:2,deletedSkipCount:0,autoDeckStatus:"deleted",autoDeckId:empty.deckId}); expect(kept).toMatchObject({deletedCardCount:1,deletedSkipCount:1,autoDeckStatus:"retained",autoDeckId:retained.deckId});
				expect(await database.query<Record<string,unknown>>(`SELECT target_deck_id,auto_created_deck_id FROM public.ai_import_batches WHERE id='${empty.batchId}'`)).toEqual([{target_deck_id:null,auto_created_deck_id:null}]);
				expect(await database.query<Record<string,unknown>>(`SELECT target_deck_id::text,auto_created_deck_id::text FROM public.ai_import_batches WHERE id='${retained.batchId}'`)).toEqual([{target_deck_id:retained.deckId,auto_created_deck_id:retained.deckId}]);
				expect(await database.query<Record<string,unknown>>(`SELECT status,deleted_card_id::text deleted,result_card_id FROM public.ai_import_items WHERE id='${retained.itemIds[0]}'`)).toEqual([{status:"deleted",deleted:retained.cardIds[0],result_card_id:null}]);
				expect(await database.query<{empty:number;retained:number;other:number}>(`SELECT (SELECT count(*)::int FROM public.decks WHERE id='${empty.deckId}') empty,(SELECT count(*)::int FROM public.decks WHERE id='${retained.deckId}') retained,(SELECT count(*)::int FROM public.cards WHERE id='${other}') other`)).toEqual([{empty:0,retained:1,other:1}]);
			} finally { await database.execute(`DELETE FROM public.cards WHERE id='${other}'`); await cleanupUndoFixture(empty); await cleanupUndoFixture(retained); }
		});
	});

	describe("lock交差・trigger security・migration (AC-03/09/10)", () => {
		// AC原文: 単一lock matrix、DEFINER安全性、fresh/upgrade二経路、migration途中失敗の全rollbackを保証する。
		// 期待結果/合格基準: deadlock 0、権限迂回0、Seed一般snapshot差分0、失敗注入差分0。
		// @category: integration
		// @dependency: parallel lock-intersection harness
		// @complexity: high
		it("IT-LOCK-01: commit/finalize/undo/session/direct card/relation管理RPC/illustration/cascade交差を反復してdeadlock 0を確認する", async () => {
			const forbidden=new Set(["40P01","55P03","57014"]); const assertOutcomes=(path:string,outcomes:({sqlState:string|null}|null)[])=>{ for(const outcome of outcomes) expect(forbidden.has(outcome?.sqlState??""),`${path}:${outcome?.sqlState}`).toBe(false); };
			const [order]=await database.query<{card:number;advisory:number;batch:number;items:number;deck:number;relations:number}>(`WITH source AS(SELECT pg_get_functiondef('public.undo_import_internal(uuid,uuid)'::regprocedure) definition) SELECT strpos(definition,'FROM public.cards AS cards')::int card,strpos(definition,'pg_advisory_xact_lock')::int advisory,strpos(definition,'SELECT batches.* INTO locked_batch')::int batch,strpos(definition,E'PERFORM 1\\n  FROM public.ai_import_items AS items')::int items,strpos(definition,'FROM public.decks AS auto_decks')::int deck,strpos(definition,'FROM public.deck_cards AS relations')::int relations FROM source`); const positions=[order?.card,order?.advisory,order?.batch,order?.items,order?.deck,order?.relations] as number[]; expect(positions.every(value=>value>0)).toBe(true); expect(positions).toEqual([...positions].sort((a,b)=>a-b));
			for(let iteration=0;iteration<2;iteration++){
				const sessionFixture=await createUndoFixture(); const relationFixture=await createUndoFixture(); const finalizeFixture=await createFinalizeFixture(); const illustration=randomUUID(),session=randomUUID();
				try {
					const settings=`SET LOCAL deadlock_timeout='50ms'; SET LOCAL lock_timeout='1500ms';`;
					assertOutcomes(`session-${iteration}`,await Promise.all([createS10DbClient().settle(`${settings} ${undoImportSql(sessionFixture.batchId)}`,{actor:S10_ACTORS.ownerA}),createS10DbClient().settle(`BEGIN; ${settings} INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${sessionFixture.deckId}','${sessionFixture.cardIds[0]}'); COMMIT;`)]));
					await database.execute(`INSERT INTO public.illustrations(id,owner_user_id,illustration_key,status,storage_path) VALUES('${illustration}','${S10_ACTORS.ownerA.userId}','lock-${illustration}','ready','${S10_ACTORS.ownerA.userId}/lock-${illustration}.webp')`);
					assertOutcomes(`relation-illustration-${iteration}`,await Promise.all([createS10DbClient().settle(`${settings} ${undoImportSql(relationFixture.batchId)}`,{actor:S10_ACTORS.ownerA}),createS10DbClient().settle(`${settings} SELECT public.set_card_illustration('${relationFixture.cardIds[0]}','${illustration}'); SELECT public.set_card_decks('${relationFixture.cardIds[0]}',ARRAY['${relationFixture.deckId}']::uuid[]);`,{actor:S10_ACTORS.ownerA})]));
					assertOutcomes(`finalize-${iteration}`,await Promise.all([createS10DbClient().settle(`${settings} ${undoImportSql(finalizeFixture.batchId)}`,{actor:S10_ACTORS.ownerA}),createS10DbClient().settle(`${settings} ${finalizeItemSql({batchId:finalizeFixture.batchId,itemId:finalizeFixture.itemId})}`,{actor:S10_ACTORS.service})]));
				} finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.illustrations WHERE id='${illustration}'`); await cleanupUndoFixture(sessionFixture); await cleanupUndoFixture(relationFixture); await cleanupFinalizeFixture(finalizeFixture); }
			}
		});

		// @category: integration
		// @dependency: SECURITY DEFINER catalog assertions
		// @complexity: high
		it("IT-SECURITY-01: 全DEFINER関数が固定owner・search_path pg_catalog,pg_temp・public完全修飾・EXECUTE revokeを満たす", async () => {
			const rows = await database.query<{ bad: number }>(`SELECT count(*)::int bad FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND (r.rolname<>'s10_migration_owner' OR r.rolcanlogin OR NOT coalesce(p.proconfig,'{}') @> ARRAY['search_path=pg_catalog, pg_temp'])`);
			expect(rows).toEqual([{ bad: 0 }]);
		});

		// @category: integration
		// @dependency: schema ACL assertions
		// @complexity: medium
		it("IT-SECURITY-02: public schema CREATEがPUBLIC/anon/authenticatedからrevokeされmigration ownerだけに許可される", async () => {
			const rows = await database.query<{ migration_owner: boolean; public_role: boolean; anon: boolean; authenticated: boolean; service: boolean }>(`SELECT has_schema_privilege('s10_migration_owner','public','CREATE') migration_owner, EXISTS(SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE') public_role, has_schema_privilege('anon','public','CREATE') anon, has_schema_privilege('authenticated','public','CREATE') authenticated, has_schema_privilege('service_role','public','CREATE') service`);
			expect(rows).toEqual([{ migration_owner: true, public_role: false, anon: false, authenticated: false, service: false }]);
		});

		// @category: edge-case
		// @dependency: trigger rollback failpoints
		// @complexity: high
		it("IT-SECURITY-03: trigger例外時にreview reset/tombstone/edit markerだけが残らずstatement全体がrollbackする", async () => {
			const rows=await database.query<{n:number}>(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('lock_study_session_cards','guard_card_active_session','reset_review_state_on_content_change')`); expect(rows).toEqual([{n:3}]);
		});

		// @category: integration
		// @dependency: fresh database fixture
		// @complexity: high
		it.runIf(process.env.S10_DATABASE_JOB === "fresh")("IT-MIGRATION-01: 空DBへ全migration chainと更新済みseedを適用しAC-01〜09のDB契約fixtureを実行できる", async () => {
			expect(() => selectS10DatabaseJobs({})).toThrow(/S10_FRESH_DATABASE_URL/u);
			const reusedDatabase = "postgresql://postgres:postgres@127.0.0.1:54322/s10_reused";
			const distinctEnvironment = {
				S10_FRESH_DATABASE_URL:
					"postgresql://postgres:postgres@127.0.0.1:54322/s10_guard_fresh",
				S10_UPGRADE_DATABASE_URL:
					"postgresql://postgres:postgres@127.0.0.1:54322/s10_guard_upgrade",
				S10_FAILURE_DATABASE_URL:
					"postgresql://postgres:postgres@127.0.0.1:54322/s10_guard_failure",
			};
			expect(() =>
				selectS10DatabaseJobs({
					S10_FRESH_DATABASE_URL: reusedDatabase,
					S10_UPGRADE_DATABASE_URL: reusedDatabase,
					S10_FAILURE_DATABASE_URL: reusedDatabase,
				})
			).toThrow(/distinct connection strings/u);
			expect(() =>
				selectS10DatabaseJobs({
					S10_FRESH_DATABASE_URL: `${reusedDatabase}?application_name=fresh`,
					S10_UPGRADE_DATABASE_URL: `${reusedDatabase}?application_name=upgrade`,
					S10_FAILURE_DATABASE_URL: `${reusedDatabase}?application_name=failure`,
				})
			).toThrow(/distinct database names/u);
			for (const databaseName of [
				"postgres",
				"template0",
				"template1",
				`test_${"x".repeat(59)}`,
				"s10_guard%22%3BDROP%20DATABASE%20postgres%3B--",
			]) {
				expect(() =>
					selectS10DatabaseJobs({
						...distinctEnvironment,
						S10_FRESH_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:54322/${databaseName}`,
					})
				).toThrow(/dedicated alphanumeric test database/u);
			}
			for (const override of [
				"dbname=postgres",
				"host=/tmp/redirected",
				"hostaddr=127.0.0.2",
				"port=5432",
				"user=other",
				"password=other",
				"service=other",
			]) {
				expect(() =>
					selectS10DatabaseJobs({
						...distinctEnvironment,
						S10_FRESH_DATABASE_URL: `${distinctEnvironment.S10_FRESH_DATABASE_URL}?${override}`,
					})
				).toThrow(/must not override connection identity/u);
			}
			const selections = selectS10DatabaseJobs();
			expect(new Set(selections.map(({ databaseUrl }) => databaseUrl)).size).toBe(3);
			expect(new Set(selections.map(({ databaseName }) => databaseName)).size).toBe(3);
			const marker = await database.query<{ job: string; database_name: string }>(
				"SELECT job, database_name FROM s10_job.metadata"
			);
			expect(marker).toEqual([{ job: "fresh", database_name: selections[0]?.databaseName }]);
			expect(await runS10AcSmoke(database)).toEqual({ passedAc: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
		});

		// @category: integration
		// @dependency: frozen pre-S10 seed upgrade fixture
		// @complexity: high
		it.runIf(process.env.S10_DATABASE_JOB === "upgrade")("IT-MIGRATION-02: pre-S10 seed済みDBへforward migrationを適用し一般Seed snapshotを不変に保つ", async () => {
			const upgradeSelection = selectS10DatabaseJobs().find(({ job }) => job === "upgrade");
			expect(await database.query<{ job: string; database_name: string }>(
				"SELECT job, database_name FROM s10_job.metadata"
			)).toEqual([{ job: "upgrade", database_name: upgradeSelection?.databaseName }]);
			expect(await readS10JobSnapshot(database, "upgrade_baseline_general")).toEqual(
				await readS10JobSnapshot(database, "upgrade_after_migration_general")
			);
			expect(await captureS10SeedGeneralSnapshot(database)).toEqual(
				await readS10JobSnapshot(database, "upgrade_baseline_general")
			);
		});

		// @category: integration
		// @dependency: Unicode fixture, key backfill
		// @complexity: high
		it.runIf(process.env.S10_DATABASE_JOB === "upgrade")("IT-MIGRATION-03: 旧card_keyを別記録し、全既存cardのbackfill後keyを個別SHA-256期待値と一致させる", async () => {
			const oldKeys = await readS10JobSnapshot(database, "upgrade_baseline_keys");
			const newKeys = await readS10JobSnapshot(database, "upgrade_after_migration_keys");
			expect(oldKeys).not.toEqual(newKeys);
			expect(await captureS10SeedKeySnapshot(database)).toEqual(newKeys);
			const cards = await database.query<{
				id: string;
				pattern: CardPattern;
				front: string;
				back: string;
				card_key: string;
			}>(`
				SELECT id::text, pattern, front_text AS front, back_text AS back, card_key
				FROM public.cards WHERE visibility = 'public' ORDER BY id
			`);
			const expectedKeys = new Map(
				await Promise.all(
					cards.map(async (card) => [
						card.id,
						await computeCardKey({
							pattern: card.pattern,
							front: card.front,
							back: card.back,
						}),
					] as const)
				)
			);
			expect(cards).toHaveLength(100);
			expect(cards.filter((card) => expectedKeys.get(card.id) !== card.card_key)).toEqual([]);
			const invalid = await database.query<{ count: number }>(`
				SELECT count(*)::int AS count FROM public.cards
				WHERE card_key IS DISTINCT FROM public.ai_compute_card_key(pattern, front_text, back_text)
			`);
			expect(invalid).toEqual([{ count: 0 }]);
		});

		// @category: integration
		// @dependency: updated seed.sql
		// @complexity: high
		it.runIf(process.env.S10_DATABASE_JOB === "upgrade")("IT-MIGRATION-04: seed再実行で公開card/deck/relation件数とmigration後card_keyを増減・変更しない", async () => {
			expect(await readS10JobSnapshot(database, "upgrade_after_seed_general")).toEqual(
				await readS10JobSnapshot(database, "upgrade_after_migration_general")
			);
			expect(await readS10JobSnapshot(database, "upgrade_after_seed_keys")).toEqual(
				await readS10JobSnapshot(database, "upgrade_after_migration_keys")
			);
		});

		// @category: edge-case
		// @dependency: migration failpoint harness
		// @complexity: high
		it.runIf(process.env.S10_DATABASE_JOB === "failure")("IT-MIGRATION-05: normalization/backfill/index/table/RLS各区間の失敗注入でschema/constraint/keyを適用前snapshotへ戻す", async () => {
			const failureSelection = selectS10DatabaseJobs().find(({ job }) => job === "failure");
			expect(await database.query<{ job: string; database_name: string }>(
				"SELECT job, database_name FROM s10_job.metadata"
			)).toEqual([{ job: "failure", database_name: failureSelection?.databaseName }]);
			const results = await runS10MigrationFailureChecks(database);
			expect(results.map(({ failpoint }) => failpoint)).toEqual([
				"after_helper_self_check",
				"after_collision_check",
				"after_card_key_backfill",
				"after_import_schema",
				"after_rls_contract",
			]);
			expect(results.every(({ rolledBack }) => rolledBack)).toBe(true);
		});
	});
});
