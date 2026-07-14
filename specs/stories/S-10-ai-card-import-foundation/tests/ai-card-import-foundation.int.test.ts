// S-10 DB統合テストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: Integration Test（実PostgreSQL/Supabase契約）
// 実装タイミング: migration / RPC / trigger実装と同時
//
// TODO(test-executor): S-02のDB testkitをS-10用に拡張し、各todoを独立transaction、
// actor fixture、固定DB clock、parallel connection、failpoint fixtureで実装する。

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import unicodeFixture from "../fixtures/unicode-card-key.json";
import {
	createS10DbClient,
	ensureS10ActorFixtures,
	S10_ACTORS,
	sqlLiteral,
} from "./helpers/s10-db-testkit";

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
					sqlState: "23503",
					constraint: "card_tags_tag_owner_fkey",
				});

				const cardMismatch = await database.captureError(`
					INSERT INTO public.card_tags (owner_user_id, card_id, tag_id)
					VALUES ('${S10_ACTORS.ownerB.userId}'::uuid, '${cardId}'::uuid, '${ownerBTagId}'::uuid)
				`);
				expect(cardMismatch).toEqual({
					sqlState: "23503",
					constraint: "card_tags_card_owner_fkey",
				});

				const updateMismatch = await database.captureError(`
					UPDATE public.card_tags
					SET tag_id = '${ownerBTagId}'::uuid
					WHERE card_id = '${cardId}'::uuid AND tag_id = '${ownerATagId}'::uuid
				`);
				expect(updateMismatch).toEqual({
					sqlState: "23503",
					constraint: "card_tags_tag_owner_fkey",
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
		it.todo("IT-OWNER-04: authenticatedのrelation直接writeを拒否しSELECT互換とowner管理RPCだけを許可する");
	});

	describe("commit・冪等性・Stage 1原子性 (AC-02/04/06)", () => {
		// AC原文: 同key同hash並行commitはbatch 1件、別hashはCONFLICT、Stage 1不正は全table増分0、正常commit時card関連0。
		// 期待結果/合格基準: batch/items/tags/reservation linkだけを1 transactionで確定し、usage二重加算なし。
		// @category: integration
		// @dependency: commit_import wrapper/internal, Stage 1 DB validation
		// @complexity: high
		it.todo("IT-COMMIT-01: 正常commitがbatch/items/tags/item_tagsとreservation linkを原子的に作りcard/deck_cards/card_tagsを0件に保つ");

		// @category: edge-case
		// @dependency: commit transaction, snapshot helper
		// @complexity: high
		it.todo("IT-COMMIT-02: Stage 1各validation違反と途中例外でdeck/card/batch/item/tag/card_tags/usage/reservation差分が0になる");

		// @category: edge-case
		// @dependency: idempotency advisory lock, parallel DB clients
		// @complexity: high
		it.todo("IT-COMMIT-03: 同owner/key/import hashの並行commitがbatch 1件と同一batch IDを返しitem/tag/usageを増やさない");

		// @category: edge-case
		// @dependency: commit idempotency contract
		// @complexity: high
		it.todo("IT-COMMIT-04: 同owner/keyでimport hash・source・reservationのいずれかが異なる再送をCONFLICTにして既存batchを不変にする");

		// @category: integration
		// @dependency: generation/import hash DB validation
		// @complexity: high
		it.todo("IT-COMMIT-05: generation hashとimport hashの非一致を許容しreservation keyで結び、初回だけimport hashを関連付ける");

		// @category: edge-case
		// @dependency: DB canonical import hash function
		// @complexity: high
		it.todo("IT-COMMIT-06: 引数import hashとDB再計算hashの不一致、reservation key改ざんを拒否し副作用を0件にする");

		// @category: edge-case
		// @dependency: duplicate set validation
		// @complexity: high
		it.todo("IT-COMMIT-07: request内card-key重複をDUPLICATE_IN_REQUEST、既存owner重複をDUPLICATE_EXISTINGに分類し全変更をrollbackする");

		// @category: integration
		// @dependency: deck/upload locking
		// @complexity: high
		it.todo("IT-COMMIT-08: deck ID/name/createのowner・一意解決とupload ready状態をlock後再検証し適切な安定codeを返す");

		// @category: integration
		// @dependency: tag normalization trigger
		// @complexity: medium
		it.todo("IT-COMMIT-09: tag display nameからDBがnormalized_nameを強制導出し、偽装値を無視してowner内uniqueを守る");
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
		it.todo("IT-UPLOAD-01: 同owner/upload key/同metadata再送は同じready rowを返し、metadata差分はCONFLICTになる");

		// @category: edge-case
		// @dependency: register_ai_upload validation
		// @complexity: high
		it.todo("IT-UPLOAD-02: owner path prefix・Storage owner/存在・MIME allow list・1..10MiB境界を検証する");

		// @category: edge-case
		// @dependency: upload state machine
		// @complexity: medium
		it.todo("IT-UPLOAD-03: consumed/deleted upload keyの再利用とcross-owner参照を拒否する");

		// @category: integration
		// @dependency: finalize_import_item
		// @complexity: high
		it.todo("IT-FINALIZE-01: committed itemからprivate card/deck_card/card_tags/resultを1 transactionで作成しownerを一致させる");

		// @category: integration
		// @dependency: finalize_import_item, upload relation
		// @complexity: high
		it.todo("IT-FINALIZE-02: image modeに応じ同owner ready illustrationを検証しuploadを同transactionで一度だけconsumedにする");

		// @category: edge-case
		// @dependency: finalize idempotency, parallel clients
		// @complexity: high
		it.todo("IT-FINALIZE-03: 同一itemの再実行と並行finalizeが同じcard IDを返し全副作用を1回分に保つ");

		// @category: edge-case
		// @dependency: private partial unique, finalize duplicate mapper
		// @complexity: high
		it.todo("IT-FINALIZE-04: commit後finalize前にowner重複が作られた場合itemだけをDUPLICATE_EXISTING failedへ確定する");

		// @category: edge-case
		// @dependency: finalize failpoints
		// @complexity: high
		it.todo("IT-FINALIZE-05: card/relation/upload/item各区間のfailpointで全変更をrollbackしcardだけを残さない");

		// @category: integration
		// @dependency: mark_import_item_failed
		// @complexity: high
		it.todo("IT-FAIL-01: committed/processing itemをsafe allow-list errorでfailedにしbatch counts/statusを同transactionで再集計する");

		// @category: edge-case
		// @dependency: mark_import_item_failed idempotency
		// @complexity: high
		it.todo("IT-FAIL-02: 同attempt/error再送は同じ結果、別attemptまたはterminal itemはCONFLICTとなりprovider本文/stackを保存しない");
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
		it.todo("IT-REVIEW-02: illustration/tag/deckだけの変更はreview_statesを完全一致で維持する");

		// @category: edge-case
		// @dependency: cards update transaction
		// @complexity: high
		it("IT-REVIEW-03: content UPDATE自体が後段constraint/triggerで失敗した場合review_statesもrollbackする", async () => {
			const deck=randomUUID(),a=randomUUID(),b=randomUUID(),session=randomUUID(); try { await database.execute(`INSERT INTO public.decks(id,owner_user_id,name) VALUES('${deck}','${S10_ACTORS.ownerA.userId}','rollback'); INSERT INTO public.cards(id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key) VALUES('${a}','${S10_ACTORS.ownerA.userId}','private','reading','R1','a-${a}','back','x'),('${b}','${S10_ACTORS.ownerA.userId}','private','reading','R1','b-${b}','back','x'); INSERT INTO public.review_states(user_id,card_id,due_date) VALUES('${S10_ACTORS.ownerA.userId}','${a}',current_date),('${S10_ACTORS.ownerA.userId}','${b}',current_date); INSERT INTO public.study_sessions(id,user_id,deck_id,current_card_id) VALUES('${session}','${S10_ACTORS.ownerA.userId}','${deck}','${b}')`); expect((await database.captureError(`UPDATE public.cards SET back_text='multi' WHERE id IN('${a}','${b}')`)).sqlState).toBe("P1006"); expect(await database.query<{n:number}>(`SELECT count(*)::int n FROM public.review_states WHERE card_id IN('${a}','${b}')`)).toEqual([{n:2}]); } finally { await database.execute(`DELETE FROM public.study_sessions WHERE id='${session}'; DELETE FROM public.decks WHERE id='${deck}'; DELETE FROM public.cards WHERE id IN('${a}','${b}')`); }
		});

		// @category: integration
		// @dependency: undo_import
		// @complexity: high
		it.todo("IT-UNDO-01: 非owner undoをnot-found相当、編集済みitemをCARD_MODIFIEDとしてbatch全体を副作用0で拒否する");

		// @category: integration
		// @dependency: delete tombstone trigger, FK SET NULL
		// @complexity: high
		it.todo("IT-UNDO-02: 個別削除をdeleted tombstoneへ記録しresult FK SET NULL後も由来を保持してundoではskipする");

		// @category: edge-case
		// @dependency: undo_result idempotency
		// @complexity: high
		it.todo("IT-UNDO-03: 既にundoneのbatchへ再実行すると保存済みundo_resultを返し副作用を増やさない");

		// @category: integration
		// @dependency: auto deck cleanup
		// @complexity: high
		it.todo("IT-UNDO-04: auto-created deckはundo後空なら削除、他cardが残れば維持しtarget/auto FKをNULL化して履歴を守る");
	});

	describe("lock交差・trigger security・migration (AC-03/09/10)", () => {
		// AC原文: 単一lock matrix、DEFINER安全性、fresh/upgrade二経路、migration途中失敗の全rollbackを保証する。
		// 期待結果/合格基準: deadlock 0、権限迂回0、Seed一般snapshot差分0、失敗注入差分0。
		// @category: integration
		// @dependency: parallel lock-intersection harness
		// @complexity: high
		it.todo("IT-LOCK-01: commit/finalize/undo/session/direct card/relation管理RPC/illustration/cascade交差を反復してdeadlock 0を確認する");

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
		it.todo("IT-MIGRATION-01: 空DBへ全migration chainと更新済みseedを適用しAC-01〜09のDB契約fixtureを実行できる");

		// @category: integration
		// @dependency: frozen pre-S10 seed upgrade fixture
		// @complexity: high
		it.todo("IT-MIGRATION-02: pre-S10 seed済みDBへforward migrationを適用し一般Seed snapshotを不変に保つ");

		// @category: integration
		// @dependency: Unicode fixture, key backfill
		// @complexity: high
		it.todo("IT-MIGRATION-03: 旧card_keyを別記録し、全既存cardのbackfill後keyを個別SHA-256期待値と一致させる");

		// @category: integration
		// @dependency: updated seed.sql
		// @complexity: high
		it.todo("IT-MIGRATION-04: seed再実行で公開card/deck/relation件数とmigration後card_keyを増減・変更しない");

		// @category: edge-case
		// @dependency: migration failpoint harness
		// @complexity: high
		it.todo("IT-MIGRATION-05: normalization/backfill/index/table/RLS各区間の失敗注入でschema/constraint/keyを適用前snapshotへ戻す");
	});
});
