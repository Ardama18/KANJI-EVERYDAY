// S-10 契約E2Eテストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: End-to-End Contract Test（DB primitive / migration chain）
// 実装タイミング: S-10のshared domain・migration・RPC完成後
//
// 分類根拠:
// Issue #10はUI、Route Handler、Remote MCP transport、Queue、worker、provider、Storage処理を対象外とする。
// そのためブラウザE2Eは作らず、信頼済みadapter相当の入力からDB最終状態までを通す契約E2Eとする。
// Queue/providerはstubさえ起動せず、commit/finalize/fail primitiveを直接境界として検証する。

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
	captureS10SeedGeneralSnapshot,
	captureS10SeedKeySnapshot,
	createS10DbClient,
	ensureS10ActorFixtures,
	runWithS10Connections,
	S10_ACTORS,
	sqlLiteral,
} from "./helpers/s10-db-testkit";
import {
	buildS10ContractItems,
	captureS10ContractSnapshot,
	cleanupS10ContractMarker,
	commitS10ContractWorkflow,
	createS10ContractUpload,
	finalizeS10ContractItem,
	prepareS10ContractWorkflow,
	reserveS10ContractUsage,
	runS10ContractWorkflow,
	undoS10ContractWorkflow,
	verifyS10ContractPreview,
} from "./helpers/s10-contract-workflow";
import {
	readS10JobSnapshot,
	runS10AcSmoke,
	runS10MigrationFailureChecks,
	selectS10DatabaseJobs,
} from "./helpers/s10-db-jobs";

const database = createS10DbClient();

beforeAll(async () => {
	await ensureS10ActorFixtures(database);
});

describe("S-10 AIカード登録基盤 契約E2E", () => {
	// AC原文 (AC-01/06): 異なるownerの同内容private cardをcommit/finalizeでき、owner関連と二段階境界が一致する。
	// 検証: Stage 1 -> preview署名/検証 -> quota予約 -> commit -> finalize -> DB readback。
	// 期待結果/合格基準: ownerごとにcard 1件、batch/item/tag関連は整合、各段階の副作用は設計どおり。
	// @category: e2e
	// @dependency: full S-10 shared contract + DB primitives
	// @complexity: high
	it("E2E-CONTRACT-01: owner A/Bが同じR1/W1案をpreview・commit・finalizeし各private cardとowner関連を取得できる", async () => {
		const marker = `e2e-owner-${randomUUID()}`;
		try {
			const items = buildS10ContractItems(marker);
			const [ownerA, ownerB] = await Promise.all([
				runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "remote_mcp", items }),
				runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerB, source: "remote_mcp", items }),
			]);
			expect(ownerA.snapshot.cards).toHaveLength(2);
			expect(ownerB.snapshot.cards).toHaveLength(2);
			expect(ownerA.snapshot.cards.every(({ ownerUserId }) => ownerUserId === S10_ACTORS.ownerA.userId)).toBe(true);
			expect(ownerB.snapshot.cards.every(({ ownerUserId }) => ownerUserId === S10_ACTORS.ownerB.userId)).toBe(true);
			expect(ownerA.snapshot.deckCards).toHaveLength(2);
			expect(ownerB.snapshot.deckCards).toHaveLength(2);
			expect(ownerA.snapshot.decks).toHaveLength(1);
			expect(ownerB.snapshot.decks).toHaveLength(1);
			expect(ownerA.snapshot.tags).toHaveLength(2);
			expect(ownerB.snapshot.tags).toHaveLength(2);
			expect(await database.query<{ count: number }>(
				`SELECT count(*)::int AS count FROM public.cards WHERE id = ANY(ARRAY[${ownerA.snapshot.cards.map(({ id }) => `${sqlLiteral(id)}::uuid`).join(",")}])`,
				{ actor: S10_ACTORS.ownerA }
			)).toEqual([{ count: 2 }]);
			expect(await database.query<{ count: number }>(
				`SELECT count(*)::int AS count FROM public.cards WHERE id = ANY(ARRAY[${ownerA.snapshot.cards.map(({ id }) => `${sqlLiteral(id)}::uuid`).join(",")}])`,
				{ actor: S10_ACTORS.ownerB }
			)).toEqual([{ count: 0 }]);
			expect(await database.query<{ count: number }>(
				`SELECT count(*)::int AS count FROM public.cards WHERE id = ANY(ARRAY[${ownerA.snapshot.cards.map(({ id }) => `${sqlLiteral(id)}::uuid`).join(",")}])`,
				{ actor: S10_ACTORS.anonymous }
			)).toEqual([{ count: 0 }]);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// @category: e2e
	// @dependency: public seed, private partial unique, finalize_import_item
	// @complexity: high
	it("E2E-CONTRACT-02: 公開Seed同値private案をcommit/finalizeして公開Seed不変のままowner cardを作成できる", async () => {
		const marker = `e2e-seed-${randomUUID()}`;
		try {
			const publicSeedBefore = await database.query<{ card: Record<string, unknown> }>(
				"SELECT to_jsonb(cards) AS card FROM public.cards AS cards WHERE visibility='public' ORDER BY id"
			);
			const publicSeedKeysBefore = await captureS10SeedKeySnapshot(database);
			const seedSql = `SELECT id::text,pattern,front_text AS front,back_text AS back,card_key AS "cardKey",illustration_key AS "illustrationKey" FROM public.cards WHERE visibility='public' ORDER BY id LIMIT 1`;
			const [seed] = await database.query<{ id: string; pattern: "R1" | "W1"; front: string; back: string; cardKey: string; illustrationKey: string | null }>(
				seedSql
			);
			if (seed === undefined) throw new Error("public Seed card is required");
			const result = await runS10ContractWorkflow(database, {
				marker,
				owner: S10_ACTORS.ownerA,
				source: "remote_mcp",
				items: [{ clientItemId: `seed-${marker}`, conceptId: `seed-${marker}`, pattern: seed.pattern, front: seed.front, back: seed.back, tags: [marker.slice(-20)], image: { mode: "none" } }],
			});
			expect(result.snapshot.cards).toHaveLength(1);
			expect(result.snapshot.cards[0]?.cardKey).toBe(seed.cardKey);
			expect(await database.query(seedSql)).toEqual([seed]);
			expect(await database.query<{ card: Record<string, unknown> }>(
				"SELECT to_jsonb(cards) AS card FROM public.cards AS cards WHERE visibility='public' ORDER BY id"
			)).toEqual(publicSeedBefore);
			expect(await captureS10SeedKeySnapshot(database)).toEqual(publicSeedKeysBefore);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// AC原文 (AC-04/05): token・reservation・commitの冪等境界が改ざん、再送、並行に耐える。
	// 検証: app_ai reservationとpreview payloadを束縛し、同key並行commit後にfinalizeを再送する。
	// 期待結果/合格基準: batch/cardは各1件、usageは1回分、全応答IDが一致。
	// @category: e2e
	// @dependency: HMAC, reserve_provider_usage, commit_import, finalize_import_item
	// @complexity: high
	it("E2E-CONTRACT-03: app_aiの予約・preview・並行commit・finalize再送を通してbatch/card/usageを各1回分に保つ", async () => {
		const marker = `e2e-idempotent-${randomUUID()}`;
		try {
			const prepared = await prepareS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "app_ai" });
			const sideEffectCounts = async () => await database.query<Record<string, number>>(`
				SELECT
					(SELECT count(*)::int FROM public.ai_import_batches WHERE idempotency_key=${sqlLiteral(prepared.idempotencyKey)}) AS batches,
					(SELECT count(*)::int FROM public.ai_import_items AS items JOIN public.ai_import_batches AS batches ON batches.id=items.batch_id WHERE batches.idempotency_key=${sqlLiteral(prepared.idempotencyKey)}) AS items,
					(SELECT count(*)::int FROM public.decks WHERE name=${sqlLiteral(marker)}) AS decks,
					(SELECT count(*)::int FROM public.cards WHERE visibility='private' AND (front_text LIKE ${sqlLiteral(`%${marker}%`)} OR back_text LIKE ${sqlLiteral(`%${marker}%`)})) AS cards,
					(SELECT count(*)::int FROM public.tags WHERE display_name LIKE ${sqlLiteral(`%${marker.slice(-20)}%`)}) AS tags,
					(SELECT count(*)::int FROM public.ai_quota_reservations WHERE reservation_key=${sqlLiteral(prepared.cardReservationKey)}) AS reservations,
					(SELECT coalesce(sum(units),0)::int FROM public.ai_quota_reservations WHERE reservation_key=${sqlLiteral(prepared.cardReservationKey)}) AS "reservedUnits",
					(SELECT coalesce(sum(generated_card_count),0)::int FROM public.ai_usage_daily WHERE owner_user_id=${sqlLiteral(prepared.owner.userId)}::uuid) AS "cardUsage"
			`);
			const beforeTamper = await sideEffectCounts();
			await expect(
				verifyS10ContractPreview(prepared, `${prepared.previewToken}tampered`)
			).rejects.toThrow();
			await expect(commitS10ContractWorkflow(database, {
				...prepared,
				importRequestHash: "0".repeat(64),
			})).rejects.toThrow();
			await expect(commitS10ContractWorkflow(database, {
				...prepared,
				cardReservationKey: `wrong-${marker}`,
			})).rejects.toThrow();
			expect(await sideEffectCounts()).toEqual(beforeTamper);
			const commits = await runWithS10Connections(4, (client) => commitS10ContractWorkflow(client, prepared));
			expect(new Set(commits.map(({ batchId }) => batchId)).size).toBe(1);
			const batchId = commits[0]?.batchId;
			if (batchId === undefined) throw new Error("commit batch is required");
			const itemRows = await database.query<{ id: string }>(`SELECT id::text FROM public.ai_import_items WHERE batch_id=${sqlLiteral(batchId)}::uuid ORDER BY ordinal`);
			const finalized = await Promise.all(itemRows.map(({ id }) =>
				Promise.all([finalizeS10ContractItem(database, prepared.owner, batchId, id), finalizeS10ContractItem(database, prepared.owner, batchId, id)])));
			expect(finalized.every(([left, right]) => left.cardId === right.cardId)).toBe(true);
			const snapshot = await captureS10ContractSnapshot(database, batchId);
			expect(snapshot.batches).toHaveLength(1);
			expect(snapshot.items).toHaveLength(2);
			expect(snapshot.cards).toHaveLength(2);
			expect(snapshot.decks).toHaveLength(1);
			expect(snapshot.tags).toHaveLength(2);
			expect(snapshot.reservations).toHaveLength(1);
			expect(snapshot.usage.reduce((sum, row) => sum + row.generatedCardCount, 0)).toBe(2);
			expect(await database.query<Record<string, unknown>>(`
				SELECT batches.idempotency_key AS "idempotencyKey",
					batches.import_request_hash AS "importRequestHash",
					batches.card_reservation_key AS "reservationKey",
					reservations.generation_request_hash AS "generationRequestHash",
					reservations.import_request_hash AS "reservationImportHash",
					reservations.batch_id::text AS "reservationBatchId"
				FROM public.ai_import_batches AS batches
				JOIN public.ai_quota_reservations AS reservations
					ON reservations.reservation_key=batches.card_reservation_key
				WHERE batches.id=${sqlLiteral(batchId)}::uuid
			`)).toEqual([{
				idempotencyKey: prepared.idempotencyKey,
				importRequestHash: prepared.importRequestHash,
				reservationKey: prepared.cardReservationKey,
				generationRequestHash: prepared.generationRequestHash,
				reservationImportHash: prepared.importRequestHash,
				reservationBatchId: batchId,
			}]);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// @category: e2e
	// @dependency: remote_mcp trusted context, exempt reservation
	// @complexity: high
	it("E2E-CONTRACT-04: remote_mcp生成済みcardをexempt予約からcommit/finalizeしcard生成quotaを消費しない", async () => {
		const marker = `e2e-mcp-${randomUUID()}`;
		try {
			const result = await runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "remote_mcp" });
			expect(result.snapshot.cards).toHaveLength(2);
			expect(result.snapshot.reservations).toEqual([
				expect.objectContaining({ status: "exempt", units: 0, source: "remote_mcp" }),
			]);
			expect(result.snapshot.usage.reduce((sum, row) => sum + row.generatedCardCount, 0)).toBe(0);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// @category: e2e
	// @dependency: register_ai_upload, upload-mode import, finalize_import_item
	// @complexity: high
	it("E2E-CONTRACT-05: owner upload登録からupload画像itemのcommit/finalizeまで通し画像quota 0・upload consumed 1回を確認する", async () => {
		const marker = `e2e-upload-${randomUUID()}`;
		try {
			const upload = await createS10ContractUpload(database, S10_ACTORS.ownerA, marker);
			const items = [buildS10ContractItems(marker)[0] ?? (() => { throw new Error("contract item missing"); })()];
			items[0] = { ...items[0], image: { mode: "upload", uploadId: upload.uploadId } };
			const result = await runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "app_ai", items });
			expect(result.snapshot.uploads).toEqual([expect.objectContaining({ id: upload.uploadId, status: "consumed" })]);
			expect(result.snapshot.illustrations).toHaveLength(1);
			expect(result.snapshot.usage.reduce((sum, row) => sum + row.generatedImageCount, 0)).toBe(0);
			expect(result.snapshot.reservations.some(({ kind, status, units }) => kind === "illustration_concept" && status === "exempt" && units === 0)).toBe(true);
			expect(result.snapshot.cards.every(({ ownerUserId }) => ownerUserId === S10_ACTORS.ownerA.userId)).toBe(true);
			expect(await database.query<Record<string, unknown>>(`
				SELECT uploads.owner_user_id::text AS "uploadOwner",
					uploads.status AS "uploadStatus",
					illustrations.owner_user_id::text AS "illustrationOwner",
					objects.owner::text AS "storageOwner"
				FROM public.ai_uploads AS uploads
				JOIN public.ai_import_items AS items ON items.upload_id=uploads.id
				JOIN public.cards AS cards ON cards.id=items.result_card_id
				JOIN public.illustrations AS illustrations ON illustrations.illustration_key=cards.illustration_key
				JOIN storage.objects AS objects ON objects.name=uploads.storage_path
				WHERE uploads.id=${sqlLiteral(upload.uploadId)}::uuid
			`)).toEqual([{
				uploadOwner: S10_ACTORS.ownerA.userId,
				uploadStatus: "consumed",
				illustrationOwner: S10_ACTORS.ownerA.userId,
				storageOwner: S10_ACTORS.ownerA.userId,
			}]);
			expect(await database.query<{ count: number }>(
				`SELECT count(*)::int AS count FROM public.ai_uploads WHERE id=${sqlLiteral(upload.uploadId)}::uuid`,
				{ actor: S10_ACTORS.ownerB }
			)).toEqual([{ count: 0 }]);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// AC原文 (AC-02): commit後・finalize前のowner重複はitemを重複errorへ確定しcard関連を増やさない。
	// 検証: commit後に競合cardを挿入してからfinalizeし、安定errorとbatch集計をreadbackする。
	// 期待結果/合格基準: item failed/DUPLICATE_EXISTING、追加card/deck_card/card_tags各0。
	// @category: e2e
	// @dependency: duplicate race fixture, partial unique index
	// @complexity: high
	it("E2E-CONTRACT-06: commit-finalize間duplicate競合を安全なitem failureへ収束させ部分永続化を残さない", async () => {
		const marker = `e2e-duplicate-${randomUUID()}`;
		try {
			const prepared = await prepareS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "app_ai", items: [buildS10ContractItems(marker)[0] ?? (() => { throw new Error("contract item missing"); })()] });
			const committed = await commitS10ContractWorkflow(database, prepared);
			const [item] = await database.query<{ id: string; front: string; back: string; pattern: string; skill: string }>(`SELECT id::text,front_text AS front,back_text AS back,pattern,skill FROM public.ai_import_items WHERE batch_id=${sqlLiteral(committed.batchId)}::uuid`);
			if (item === undefined) throw new Error("committed item missing");
			await database.execute(`INSERT INTO public.cards(owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES(${sqlLiteral(prepared.owner.userId)}::uuid,'private',${sqlLiteral(item.skill)},${sqlLiteral(item.pattern)},${sqlLiteral(item.front)},${sqlLiteral(item.back)},'ignored')`);
			const failed = await finalizeS10ContractItem(database, prepared.owner, committed.batchId, item.id);
			expect(failed).toMatchObject({ status: "failed", errorCode: "DUPLICATE_EXISTING" });
			const snapshot = await captureS10ContractSnapshot(database, committed.batchId);
			expect(snapshot.batches).toEqual([
				expect.objectContaining({ status: "completed", finalizedCount: 0, failedCount: 1 }),
			]);
			expect(snapshot.items).toEqual([
				expect.objectContaining({ id: item.id, status: "failed" }),
			]);
			expect(snapshot.cards).toHaveLength(0);
			expect(snapshot.deckCards).toHaveLength(0);
			expect(snapshot.cardTags).toHaveLength(0);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// AC原文 (AC-05): JST境界と並行予約で上限超過要求だけを拒否し、成功合計が上限を超えない。
	// 検証: test clockを日付境界へ固定し、複数connectionからcard/image予約を実行する。
	// 期待結果/合格基準: 日付別200/50以下、再送二重消費0、超過だけQUOTA_EXCEEDED。
	// @category: e2e
	// @dependency: test-only clock wrapper, parallel database clients
	// @complexity: high
	it("E2E-CONTRACT-07: JST日付境界と上限付近の並行予約をworkflow単位で通しcard 200/image 50を越えない", async () => {
		const marker = `e2e-quota-${randomUUID()}`;
		const dateOffset = Number.parseInt(marker.replaceAll("-", "").slice(-8), 16) % 1_000_000;
		const quotaBoundary = new Date(Date.UTC(3_000, 0, dateOffset + 1));
		const quotaDayOne = quotaBoundary.toISOString().slice(0, 10);
		const quotaDayTwo = new Date(quotaBoundary.getTime() + 86_400_000).toISOString().slice(0, 10);
		const beforeJstMidnight = `${quotaDayOne}T14:59:59Z`;
		const afterJstMidnight = `${quotaDayOne}T15:00:00Z`;
		try {
			const prepared = await prepareS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "remote_mcp" });
			await commitS10ContractWorkflow(database, prepared);
			const beforeReservation = await reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-before`, units: 199, testNow: beforeJstMidnight });
			expect(await reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-before`, units: 199, testNow: beforeJstMidnight })).toEqual(beforeReservation);
			const outcomes = await Promise.all([
				createS10DbClient().settle(reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-one`, units: 1, testNow: beforeJstMidnight, sqlOnly: true })),
				createS10DbClient().settle(reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-two`, units: 2, testNow: beforeJstMidnight, sqlOnly: true })),
			]);
			expect(outcomes.filter((result) => result === null)).toHaveLength(1);
			expect(outcomes.some((result) => result?.sqlState === "P1005")).toBe(true);
			const nextDayReservation = await reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-next-day`, units: 200, testNow: afterJstMidnight });
			expect(await reserveS10ContractUsage(database, { owner: prepared.owner, marker: `${marker}-next-day`, units: 200, testNow: afterJstMidnight })).toEqual(nextDayReservation);
			const usage = await database.query<{ date: string; cards: number }>(`SELECT usage_date::text AS date,generated_card_count AS cards FROM public.ai_usage_daily WHERE owner_user_id=${sqlLiteral(prepared.owner.userId)}::uuid AND usage_date BETWEEN ${sqlLiteral(quotaDayOne)}::date AND ${sqlLiteral(quotaDayTwo)}::date ORDER BY usage_date`);
			expect(usage).toEqual([{ date: quotaDayOne, cards: 200 }, { date: quotaDayTwo, cards: 200 }]);

			const imageItems = Array.from({ length: 3 }, (_, index) => {
				const item = buildS10ContractItems(`${marker}-image-${index}`)[0];
				if (item === undefined) throw new Error("image quota item missing");
				return { ...item, image: { mode: "ai" } as const };
			});
			const imagePrepared = await prepareS10ContractWorkflow(database, {
				marker: `${marker}-images`, owner: S10_ACTORS.ownerA, source: "app_ai", items: imageItems,
			});
			const imageBatch = await commitS10ContractWorkflow(database, imagePrepared);
			const imageRows = await database.query<{ id: string; conceptId: string }>(`SELECT id::text,concept_id AS "conceptId" FROM public.ai_import_items WHERE batch_id=${sqlLiteral(imageBatch.batchId)}::uuid ORDER BY ordinal`);
			const illustrationReservationSql = (index: number, units: number, key: string) => {
				const item = imageRows[index];
				if (item === undefined) throw new Error("committed image quota item missing");
				return `SELECT public.reserve_provider_usage_internal(${sqlLiteral(imagePrepared.owner.userId)}::uuid,${sqlLiteral(key)},'illustration_concept','app_ai',${sqlLiteral(imagePrepared.generationRequestHash)},${units},${sqlLiteral(imageBatch.batchId)}::uuid,${sqlLiteral(item.id)}::uuid,${sqlLiteral(item.conceptId)},${sqlLiteral(beforeJstMidnight)}::timestamptz) AS result`;
			};
			const image49 = await database.query(illustrationReservationSql(0, 49, `${marker}-image-49`));
			expect(await database.query(illustrationReservationSql(0, 49, `${marker}-image-49`))).toEqual(image49);
			const imageOutcomes = await Promise.all([
				createS10DbClient().settle(illustrationReservationSql(1, 1, `${marker}-image-one`)),
				createS10DbClient().settle(illustrationReservationSql(2, 2, `${marker}-image-two`)),
			]);
			expect(imageOutcomes.filter((outcome) => outcome === null)).toHaveLength(1);
			expect(imageOutcomes.some((outcome) => outcome?.sqlState === "P1005")).toBe(true);
			expect(await database.query<{ images: number }>(`SELECT generated_image_count AS images FROM public.ai_usage_daily WHERE owner_user_id=${sqlLiteral(imagePrepared.owner.userId)}::uuid AND usage_date=${sqlLiteral(quotaDayOne)}::date`)).toEqual([{ images: 50 }]);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// AC原文 (AC-07/08): active session中の編集/削除/undoを拒否し、本文変更だけreview stateをresetする。
	// 検証: finalize済みcardを学習sessionへ入れ、管理RPC/直接DML/undoを試し、session完了後に再実行する。
	// 期待結果/合格基準: active時変更0、完了後content editはreview reset、relation editはreview keep。
	// @category: e2e
	// @dependency: finalize, study session, management RPC and triggers
	// @complexity: high
	it("E2E-CONTRACT-08: finalize済みcardの学習中guardからsession完了後の編集・review reset/keepまで一連で確認する", async () => {
		const marker = `e2e-study-${randomUUID()}`;
		const sessionId = randomUUID();
		const tagId = randomUUID();
		try {
			const result = await runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "remote_mcp", items: [buildS10ContractItems(marker)[0] ?? (() => { throw new Error("contract item missing"); })()] });
			const card = result.snapshot.cards[0];
			if (card === undefined) throw new Error("finalized card missing");
			await database.execute(`INSERT INTO public.review_states(user_id,card_id,level,due_date) VALUES(${sqlLiteral(card.ownerUserId)}::uuid,${sqlLiteral(card.id)}::uuid,3,current_date+2); INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES(${sqlLiteral(sessionId)}::uuid,${sqlLiteral(card.ownerUserId)}::uuid,${sqlLiteral(result.prepared.deckId)}::uuid,${sqlLiteral(card.id)}::uuid)`);
			const before = await captureS10ContractSnapshot(database, result.prepared.batchId);
			const [activeCard] = await database.query<{ card: Record<string, unknown>; updated: string }>(`SELECT to_jsonb(cards) AS card,updated_at::text AS updated FROM public.cards AS cards WHERE id=${sqlLiteral(card.id)}::uuid`);
			if (activeCard === undefined) throw new Error("active card missing");
			const activeGuardSql = [
				`UPDATE public.cards SET back_text='blocked' WHERE id=${sqlLiteral(card.id)}::uuid`,
				`DELETE FROM public.cards WHERE id=${sqlLiteral(card.id)}::uuid`,
				`SELECT public.update_imported_card(${sqlLiteral(card.id)}::uuid,'{"backText":"blocked rpc"}'::jsonb,${sqlLiteral(activeCard.updated)}::timestamptz)`,
				`SELECT public.delete_private_card(${sqlLiteral(card.id)}::uuid,${sqlLiteral(activeCard.updated)}::timestamptz)`,
				`SELECT public.set_card_decks(${sqlLiteral(card.id)}::uuid,ARRAY[${sqlLiteral(result.prepared.deckId)}::uuid])`,
				`SELECT public.set_card_tags(${sqlLiteral(card.id)}::uuid,ARRAY[]::uuid[])`,
				`SELECT public.set_card_illustration(${sqlLiteral(card.id)}::uuid,NULL)`,
				`SELECT public.undo_import(${sqlLiteral(result.prepared.batchId)}::uuid)`,
			];
			const activeGuardErrors = [];
			for (const statement of activeGuardSql) {
				activeGuardErrors.push(await database.captureError(statement, { actor: S10_ACTORS.ownerA }));
			}
			expect(activeGuardErrors.map(({ sqlState }) => sqlState)).toEqual(Array.from({ length: activeGuardSql.length }, () => "P1006"));
			expect(await captureS10ContractSnapshot(database, result.prepared.batchId)).toEqual(before);
			expect(await database.query<{ card: Record<string, unknown> }>(`SELECT to_jsonb(cards) AS card FROM public.cards AS cards WHERE id=${sqlLiteral(card.id)}::uuid`)).toEqual([{ card: activeCard.card }]);
			await database.execute(`UPDATE public.study_sessions SET finished_at=now() WHERE id=${sqlLiteral(sessionId)}::uuid`);
			await database.execute(`INSERT INTO public.tags(id,owner_user_id,display_name,normalized_name) VALUES(${sqlLiteral(tagId)}::uuid,${sqlLiteral(card.ownerUserId)}::uuid,${sqlLiteral(`study-${marker.slice(-20)}`)},'ignored')`);
			await database.query(`SELECT public.set_card_tags(${sqlLiteral(card.id)}::uuid,ARRAY[${sqlLiteral(tagId)}::uuid])`, { actor: S10_ACTORS.ownerA });
			expect(await database.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.card_tags WHERE card_id=${sqlLiteral(card.id)}::uuid AND tag_id=${sqlLiteral(tagId)}::uuid`)).toEqual([{ count: 1 }]);
			expect(await database.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.review_states WHERE card_id=${sqlLiteral(card.id)}::uuid`)).toEqual([{ count: 1 }]);
			const [current] = await database.query<{ updated: string }>(`SELECT updated_at::text AS updated FROM public.cards WHERE id=${sqlLiteral(card.id)}::uuid`);
			if (current === undefined) throw new Error("editable card missing");
			await database.query(`SELECT public.update_imported_card(${sqlLiteral(card.id)}::uuid,'{"backText":"変更後 かんじ"}'::jsonb,${sqlLiteral(current.updated)}::timestamptz)`, { actor: S10_ACTORS.ownerA });
			expect(await database.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.review_states WHERE card_id=${sqlLiteral(card.id)}::uuid`)).toEqual([{ count: 0 }]);
		} finally {
			await database.execute(`DELETE FROM public.study_sessions WHERE id=${sqlLiteral(sessionId)}::uuid; DELETE FROM public.tags WHERE id=${sqlLiteral(tagId)}::uuid`);
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// @category: e2e
	// @dependency: delete tombstone, undo_import
	// @complexity: high
	it("E2E-CONTRACT-09: batch内個別削除tombstoneを含むundoと再undoを通し由来履歴・skip数・auto deck結果を維持する", async () => {
		const marker = `e2e-undo-${randomUUID()}`;
		try {
			const result = await runS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "remote_mcp", deck: { create: { name: marker } } });
			const [deleted] = result.snapshot.cards;
			if (deleted === undefined) throw new Error("delete candidate missing");
			const [current] = await database.query<{ updated: string }>(`SELECT updated_at::text AS updated FROM public.cards WHERE id=${sqlLiteral(deleted.id)}::uuid`);
			if (current === undefined) throw new Error("delete candidate readback missing");
			await database.query(`SELECT public.delete_private_card(${sqlLiteral(deleted.id)}::uuid,${sqlLiteral(current.updated)}::timestamptz)`, { actor: S10_ACTORS.ownerA });
			const first = await undoS10ContractWorkflow(database, S10_ACTORS.ownerA, result.prepared.batchId);
			const after = await captureS10ContractSnapshot(database, result.prepared.batchId);
			const second = await undoS10ContractWorkflow(database, S10_ACTORS.ownerA, result.prepared.batchId);
			expect(first).toEqual(second);
			expect(first).toMatchObject({ status: "undone", deletedCardCount: 1, deletedSkipCount: 1, autoDeckStatus: "deleted" });
			expect(await captureS10ContractSnapshot(database, result.prepared.batchId)).toEqual(after);
			expect(after.items.some(({ status, deletedCardId }) => status === "deleted" && deletedCardId === deleted.id)).toBe(true);
			expect(after.cards).toHaveLength(0);
			expect(after.decks).toHaveLength(0);
			expect(after.deckCards).toHaveLength(0);
			expect(after.cardTags).toHaveLength(0);
			expect(after.itemTags).toHaveLength(0);
			expect(after.reservations).toHaveLength(1);
			expect(after.batches).toEqual([expect.objectContaining({ status: "undone", deckId: null, autoCreatedDeckId: null })]);
			await cleanupS10ContractMarker(database, marker);
			await cleanupS10ContractMarker(database, marker);
			expect(await database.query<{ batch: number; reservation: number; card: number; deck: number; tag: number; illustration: number; upload: number; object: number }>(`
				SELECT
					(SELECT count(*)::int FROM public.ai_import_batches WHERE idempotency_key LIKE ${sqlLiteral(`%${marker}%`)}) AS batch,
					(SELECT count(*)::int FROM public.ai_quota_reservations WHERE reservation_key LIKE ${sqlLiteral(`%${marker}%`)}) AS reservation,
					(SELECT count(*)::int FROM public.cards WHERE front_text LIKE ${sqlLiteral(`%${marker}%`)} OR back_text LIKE ${sqlLiteral(`%${marker}%`)}) AS card,
					(SELECT count(*)::int FROM public.decks WHERE name LIKE ${sqlLiteral(`%${marker}%`)}) AS deck,
					(SELECT count(*)::int FROM public.tags WHERE display_name LIKE ${sqlLiteral(`%${marker}%`)}) AS tag,
					(SELECT count(*)::int FROM public.illustrations WHERE illustration_key LIKE ${sqlLiteral(`%${marker}%`)} OR storage_path LIKE ${sqlLiteral(`%${marker}%`)}) AS illustration,
					(SELECT count(*)::int FROM public.ai_uploads WHERE upload_key LIKE ${sqlLiteral(`%${marker}%`)} OR storage_path LIKE ${sqlLiteral(`%${marker}%`)}) AS upload,
					(SELECT count(*)::int FROM storage.objects WHERE bucket_id='illustrations' AND name LIKE ${sqlLiteral(`%${marker}%`)}) AS object
			`)).toEqual([{ batch: 0, reservation: 0, card: 0, deck: 0, tag: 0, illustration: 0, upload: 0, object: 0 }]);
		} finally {
			await cleanupS10ContractMarker(database, marker);
		}
	});

	// AC原文 (AC-10): freshとupgradeの両経路でAC-01〜09のDB契約を満たす。
	// 検証: 独立DB jobで空DBからmigration chain+seed+smoke contractを実行する。
	// 期待結果/合格基準: chain成功、公開Seed一般snapshot一致、主要RPC smoke成功。
	// @category: e2e
	// @dependency: isolated fresh database job
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "fresh")("E2E-MIGRATION-01: fresh DBへ全migrationと更新seedを適用しAC-01〜09の契約smokeを完走する", async () => {
		const selections = selectS10DatabaseJobs();
		expect(new Set(selections.map(({ databaseUrl }) => databaseUrl)).size).toBe(3);
		expect(new Set(selections.map(({ databaseName }) => databaseName)).size).toBe(3);
		expect(await runS10AcSmoke(database)).toEqual({ passedAc: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
	});

	// @category: e2e
	// @dependency: frozen pre-S10 seed, isolated upgrade database job
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "upgrade")("E2E-MIGRATION-02: pre-S10 seed済みDBをupgradeしkey backfill・部分unique・seed再実行・契約smokeを完走する", async () => {
		expect(await captureS10SeedGeneralSnapshot(database)).toEqual(
			await readS10JobSnapshot(database, "upgrade_baseline_general")
		);
		expect(await captureS10SeedKeySnapshot(database)).toEqual(
			await readS10JobSnapshot(database, "upgrade_after_migration_keys")
		);
		expect(await runS10AcSmoke(database)).toEqual({ passedAc: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
	});

	// AC原文 (AC-10b): migration途中へ失敗を注入すると追加schema、制約、backfill dataが適用前へ戻る。
	// 検証: DDL/backfill区間ごとのfailpointでmigrationを中断しbaseline snapshotと比較する。
	// 期待結果/合格基準: schema/constraint/key/data差分0、既存アプリread契約維持。
	// @category: edge-case
	// @dependency: migration failure-injection harness
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "failure")("E2E-MIGRATION-03: 各migration failpointでtransaction rollback後のDB全snapshotを適用前と一致させる", async () => {
		const results = await runS10MigrationFailureChecks(database);
		expect(results).toHaveLength(5);
		expect(results.every(({ rolledBack }) => rolledBack)).toBe(true);
	});

	// @category: e2e
	// @dependency: parallel lock-intersection harness, full S-10 primitives
	// @complexity: high
	it("E2E-CONTRACT-10: commit/finalize/undo/session/direct DML/relation RPCを並行交差しdeadlock 0と最終不変条件を確認する", async () => {
		const marker = `e2e-lock-${randomUUID()}`;
		const sessionId = randomUUID();
		const lockSettings = "SET LOCAL lock_timeout='10s';";
		try {
			const prepared = await prepareS10ContractWorkflow(database, { marker, owner: S10_ACTORS.ownerA, source: "app_ai" });
			const commits = await runWithS10Connections(3, (client) => commitS10ContractWorkflow(client, prepared));
			const batchId = commits[0]?.batchId;
			if (batchId === undefined) throw new Error("lock batch missing");
			const items = await database.query<{ id: string }>(`SELECT id::text FROM public.ai_import_items WHERE batch_id=${sqlLiteral(batchId)}::uuid ORDER BY ordinal`);
			const outcomes = await Promise.all(items.flatMap(({ id }) => [
				createS10DbClient().settle(`${lockSettings} ${finalizeS10ContractItem(database, prepared.owner, batchId, id, { sqlOnly: true })}`, { actor: S10_ACTORS.service }),
				createS10DbClient().settle(`${lockSettings} ${finalizeS10ContractItem(database, prepared.owner, batchId, id, { sqlOnly: true })}`, { actor: S10_ACTORS.service }),
			]));
			expect(outcomes, JSON.stringify(outcomes)).toEqual(Array.from({ length: items.length * 2 }, () => null));
			const snapshot = await captureS10ContractSnapshot(database, batchId);
			expect(snapshot.batches).toEqual([expect.objectContaining({ status: "completed", finalizedCount: items.length, failedCount: 0 })]);
			expect(snapshot.cards).toHaveLength(items.length);
			expect(new Set(snapshot.cards.map(({ id }) => id)).size).toBe(items.length);
			expect(snapshot.items.every(({ status }) => status === "finalized")).toBe(true);
			expect(snapshot.deckCards).toHaveLength(items.length);
			expect(snapshot.cardTags).toHaveLength(items.length);
			expect(snapshot.itemTags).toHaveLength(items.length);
			expect(snapshot.tags).toHaveLength(items.length);
			const guardedCard = snapshot.cards[0];
			if (guardedCard === undefined) throw new Error("guarded lock card missing");
			const [batch] = await database.query<{ deckId: string }>(`SELECT target_deck_id::text AS "deckId" FROM public.ai_import_batches WHERE id=${sqlLiteral(batchId)}::uuid`);
			if (batch === undefined) throw new Error("guarded lock deck missing");
			await database.execute(`INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES(${sqlLiteral(sessionId)}::uuid,${sqlLiteral(prepared.owner.userId)}::uuid,${sqlLiteral(batch.deckId)}::uuid,${sqlLiteral(guardedCard.id)}::uuid)`);
			const guardOutcomes = await Promise.all([
				createS10DbClient().captureError(`${lockSettings} SELECT public.undo_import(${sqlLiteral(batchId)}::uuid)`, { actor: prepared.owner }),
				createS10DbClient().captureError(`${lockSettings} UPDATE public.cards SET back_text='blocked' WHERE id=${sqlLiteral(guardedCard.id)}::uuid`, { actor: prepared.owner }),
				createS10DbClient().captureError(`${lockSettings} SELECT public.set_card_decks(${sqlLiteral(guardedCard.id)}::uuid,ARRAY[${sqlLiteral(batch.deckId)}::uuid])`, { actor: prepared.owner }),
			]);
			expect(guardOutcomes.map(({ sqlState }) => sqlState)).toEqual(["P1006", "P1006", "P1006"]);
			expect(await captureS10ContractSnapshot(database, batchId)).toEqual(snapshot);
		} finally {
			await database.execute(`DELETE FROM public.study_sessions WHERE id=${sqlLiteral(sessionId)}::uuid`);
			await cleanupS10ContractMarker(database, marker);
		}
	});
});
