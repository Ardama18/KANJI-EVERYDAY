// S-02 E2Eテスト - Design Doc: database-schema-rls
// 生成日: 2026-02-23
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Design AC）:
// - Scenario 1: AC-01, AC-02, AC-03, AC-04, AC-11
// - Scenario 2: AC-05
// - Scenario 3: AC-06, AC-09
// - Scenario 4: AC-07, AC-08, AC-10
// - Scenario 5: AC-12

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createRlsFixture } from "./helpers/rls-actors";
import {
	assertSchemaContract,
	hasUniqueIllustrationKeyConstraint,
} from "./helpers/schema-assertions";
import {
	createAuthUserFixture,
	queryRows,
	runSql,
	sqlLiteral,
} from "./helpers/s02-db-testkit";
import {
	ILLUSTRATIONS_STORAGE_BUCKET,
	buildIllustrationsStorageObjectName,
	createStorageBoundaryFixture,
} from "./helpers/storage-actors";

interface CountRow {
	count: number;
}

interface ExtensionRow {
	extname: string;
}

interface IdRow {
	id: string;
}

interface RlsStatusRow {
	table_name: string;
	row_security_enabled: boolean;
}

interface StorageBucketRow {
	id: string;
	is_public: boolean;
}

interface StorageObjectRow {
	id: string;
	name: string;
}

interface TableNameRow {
	table_name: string;
}

interface TriggerRow {
	table_name: string;
	trigger_name: string;
	trigger_definition: string;
}

interface UpdatedAtRow {
	updated_at: string;
}

function expectRlsDenied(operation: () => void): void {
	expect(operation).toThrow(/row-level security|permission denied/iu);
}

function assertUpdatedAtAdvanced({
	selectSql,
	updateSql,
}: {
	selectSql: string;
	updateSql: string;
}): void {
	const beforeRow = queryRows<UpdatedAtRow>(selectSql)[0];
	expect(beforeRow).toBeDefined();

	runSql("SELECT pg_sleep(0.02)");

	const afterRow = queryRows<UpdatedAtRow>(updateSql)[0];
	expect(afterRow).toBeDefined();
	expect(new Date(afterRow?.updated_at ?? 0).getTime()).toBeGreaterThan(
		new Date(beforeRow?.updated_at ?? 0).getTime()
	);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDatabaseTypePath = path.resolve(__dirname, "../../../../frontend/src/types/database.ts");
const frontendServerClientPath = path.resolve(__dirname, "../../../../frontend/src/lib/supabase/server.ts");
const frontendBrowserClientPath = path.resolve(__dirname, "../../../../frontend/src/lib/supabase/client.ts");
const expectedPublicTables = [
	"users_profile",
	"decks",
	"cards",
	"deck_cards",
	"review_states",
	"illustrations",
	"study_sessions",
] as const;

describe("database-schema-rls E2Eテスト", () => {
	// 実行順序: Scenario 1 - migration bootstrap

	// AC原文トレース: AC-01, AC-02, AC-03, AC-04, AC-11
	// AC解釈: migration適用直後にDDL/RLS/trigger/非UNIQUE制約要件が一体で成立している必要がある。
	// 検証: ローカルSupabaseを初期化し、migration適用後にschema・RLS・trigger・constraintを通しで検証する。
	// 期待結果: DB基盤要件が一括で充足する。
	// 合格基準: schema/extension/trigger/RLS/constraint検証が全件成功。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-01: migration適用後に7テーブル契約・pgcrypto・updated_atトリガー・RLS・illustration_key非UNIQUEが成立する", () => {
		assertSchemaContract();

		const extensionRows = queryRows<ExtensionRow>(`
      SELECT extname
      FROM pg_extension
      WHERE extname = 'pgcrypto'
    `);
		expect(extensionRows).toEqual([{ extname: "pgcrypto" }]);

		const rlsRows = queryRows<RlsStatusRow>(`
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS row_security_enabled
      FROM pg_class AS c
      INNER JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'users_profile',
          'decks',
          'cards',
          'deck_cards',
          'review_states',
          'illustrations',
          'study_sessions'
        )
      ORDER BY c.relname
    `);
		expect(rlsRows).toHaveLength(7);
		for (const row of rlsRows) {
			expect(row.row_security_enabled).toBe(true);
		}

		const triggerRows = queryRows<TriggerRow>(`
      SELECT
        c.relname AS table_name,
        t.tgname AS trigger_name,
        pg_get_triggerdef(t.oid, TRUE) AS trigger_definition
      FROM pg_trigger AS t
      INNER JOIN pg_class AS c
        ON c.oid = t.tgrelid
      INNER JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('users_profile', 'decks', 'illustrations')
        AND NOT t.tgisinternal
      ORDER BY c.relname
    `);
		expect(triggerRows).toHaveLength(3);
		for (const row of triggerRows) {
			expect(row.trigger_name).toContain("set_");
			expect(row.trigger_definition).toContain("BEFORE UPDATE");
			expect(row.trigger_definition).toContain("update_updated_at_column()");
		}

		const { userId } = createAuthUserFixture("e2e01");
		const duplicatedIllustrationKey = `e2e01-duplicate-${Date.now()}`;

		try {
			runSql(`
        INSERT INTO public.users_profile (user_id, display_name)
        VALUES (${sqlLiteral(userId)}::uuid, 'e2e01-owner')
      `);

			const deckRows = queryRows<IdRow>(`
        INSERT INTO public.decks (owner_user_id, name)
        VALUES (${sqlLiteral(userId)}::uuid, 'e2e01-deck')
        RETURNING id::text AS id
      `);
			const deckId = deckRows[0]?.id;
			expect(deckId).toBeDefined();
			if (deckId === undefined) {
				throw new Error("deck id is required");
			}

			runSql(`
        INSERT INTO public.illustrations (owner_user_id, illustration_key, status)
        VALUES (${sqlLiteral(userId)}::uuid, ${sqlLiteral(`e2e01-trigger-${Date.now()}`)}, 'pending')
      `);

			assertUpdatedAtAdvanced({
				selectSql: `
          SELECT updated_at::text AS updated_at
          FROM public.users_profile
          WHERE user_id = ${sqlLiteral(userId)}::uuid
        `,
				updateSql: `
          UPDATE public.users_profile
          SET display_name = 'e2e01-owner-updated'
          WHERE user_id = ${sqlLiteral(userId)}::uuid
          RETURNING updated_at::text AS updated_at
        `,
			});

			assertUpdatedAtAdvanced({
				selectSql: `
          SELECT updated_at::text AS updated_at
          FROM public.decks
          WHERE id = ${sqlLiteral(deckId)}::uuid
        `,
				updateSql: `
          UPDATE public.decks
          SET name = 'e2e01-deck-updated'
          WHERE id = ${sqlLiteral(deckId)}::uuid
          RETURNING updated_at::text AS updated_at
        `,
			});

			assertUpdatedAtAdvanced({
				selectSql: `
          SELECT updated_at::text AS updated_at
          FROM public.illustrations
          WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
          ORDER BY created_at DESC
          LIMIT 1
        `,
				updateSql: `
          UPDATE public.illustrations
          SET status = 'ready'
          WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
          RETURNING updated_at::text AS updated_at
        `,
			});

			expect(hasUniqueIllustrationKeyConstraint()).toBe(false);

			runSql(`
        INSERT INTO public.illustrations (owner_user_id, illustration_key, status)
        VALUES
          (${sqlLiteral(userId)}::uuid, ${sqlLiteral(duplicatedIllustrationKey)}, 'pending'),
          (${sqlLiteral(userId)}::uuid, ${sqlLiteral(duplicatedIllustrationKey)}, 'ready')
      `);

			const duplicatedRows = queryRows<CountRow>(`
        SELECT COUNT(*)::int AS count
        FROM public.illustrations
        WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
          AND illustration_key = ${sqlLiteral(duplicatedIllustrationKey)}
      `);
			expect(duplicatedRows[0]?.count).toBe(2);
		} finally {
			runSql(`
        DELETE FROM auth.users
        WHERE id = ${sqlLiteral(userId)}::uuid
      `);
		}
	});

	// 実行順序: Scenario 2 - anonymous public card access

	// AC原文トレース: AC-05
	// AC解釈: 未認証ユーザーはcardsのpublic行を読めるが、変更操作はできない必要がある。
	// 検証: anonymousセッションでpublic cardへのSELECT/INSERT/UPDATE/DELETEを順に試行する。
	// 期待結果: SELECT成功、書き込み系はすべて拒否。
	// 合格基準: public read-only境界を100%再現。
	// @category: e2e
	// @dependency: full-system
	// @complexity: medium
	it("E2E-02: anonymousユーザーはcards public行を参照できるが書き込みは拒否される", () => {
		const fixture = createRlsFixture("e2e02");
		const nowSuffix = Date.now();

		try {
			const { actors, ownerUserId, nonOwnerUserId, publicCardId } = fixture;

			const anonymousSelectedRows = actors.anonymous.queryRows<IdRow>(`
        SELECT id::text AS id
        FROM public.cards
        WHERE id = ${sqlLiteral(publicCardId)}::uuid
      `);
			expect(anonymousSelectedRows).toEqual([{ id: publicCardId }]);

			expectRlsDenied(() => {
				actors.owner.runSql(`
          INSERT INTO public.cards (
            owner_user_id,
            visibility,
            skill,
            pattern,
            front_text,
            back_text,
            card_key
          ) VALUES (
            ${sqlLiteral(ownerUserId)}::uuid,
            'public',
            'reading',
            'R1',
            'e2e02-owner-public-front',
            'e2e02-owner-public-back',
            ${sqlLiteral(`e2e02-owner-public-${nowSuffix}`)}
          )
        `);
			});

			expectRlsDenied(() => {
				actors.nonOwner.runSql(`
          INSERT INTO public.cards (
            owner_user_id,
            visibility,
            skill,
            pattern,
            front_text,
            back_text,
            card_key
          ) VALUES (
            ${sqlLiteral(nonOwnerUserId)}::uuid,
            'public',
            'reading',
            'R1',
            'e2e02-non-owner-public-front',
            'e2e02-non-owner-public-back',
            ${sqlLiteral(`e2e02-non-owner-public-${nowSuffix}`)}
          )
        `);
			});

			expectRlsDenied(() => {
				actors.anonymous.runSql(`
          INSERT INTO public.cards (
            visibility,
            skill,
            pattern,
            front_text,
            back_text,
            card_key
          ) VALUES (
            'public',
            'reading',
            'R1',
            'e2e02-anonymous-public-front',
            'e2e02-anonymous-public-back',
            ${sqlLiteral(`e2e02-anonymous-public-${nowSuffix}`)}
          )
        `);
			});

			for (const actor of [actors.owner, actors.nonOwner, actors.anonymous]) {
				const updatedRows = actor.queryRows<IdRow>(`
          UPDATE public.cards
          SET back_text = ${sqlLiteral(`e2e02-updated-by-${actor.role}`)}
          WHERE id = ${sqlLiteral(publicCardId)}::uuid
          RETURNING id::text AS id
        `);
				expect(updatedRows).toHaveLength(0);

				const deletedRows = actor.queryRows<IdRow>(`
          DELETE FROM public.cards
          WHERE id = ${sqlLiteral(publicCardId)}::uuid
          RETURNING id::text AS id
        `);
				expect(deletedRows).toHaveLength(0);
			}

			const remainedRows = queryRows<CountRow>(`
        SELECT COUNT(*)::int AS count
        FROM public.cards
        WHERE id = ${sqlLiteral(publicCardId)}::uuid
      `);
			expect(remainedRows[0]?.count).toBe(1);
		} finally {
			fixture.cleanup();
		}
	});

	// 実行順序: Scenario 3 - private card write/delete boundary

	// AC原文トレース: AC-06, AC-09
	// AC解釈: cards private行の変更・削除はownerのみ許可され、未明示DELETEは拒否される必要がある。
	// 検証: owner/non-ownerでprivate cardのINSERT/UPDATE/DELETEを比較し、他テーブルDELETE拒否も合わせて確認する。
	// 期待結果: owner以外のprivate書き込み拒否 + default deny DELETE成立。
	// 合格基準: allow-list外DELETE拒否率100%。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-03: cards private行はownerのみ更新/削除でき、未明示DELETEはdefault denyで拒否される", () => {
		const fixture = createRlsFixture("e2e03");
		const nowSuffix = Date.now();

		try {
			const { actors, ownerUserId, ownerDeckId, privateCardId } = fixture;

			const ownerInsertedRows = actors.owner.queryRows<IdRow>(`
        INSERT INTO public.cards (
          owner_user_id,
          visibility,
          skill,
          pattern,
          front_text,
          back_text,
          card_key
        ) VALUES (
          ${sqlLiteral(ownerUserId)}::uuid,
          'private',
          'reading',
          'R2',
          'e2e03-owner-private-front',
          'e2e03-owner-private-back',
          ${sqlLiteral(`e2e03-owner-private-${nowSuffix}`)}
        )
        RETURNING id::text AS id
      `);
			expect(ownerInsertedRows).toHaveLength(1);

			expectRlsDenied(() => {
				actors.nonOwner.runSql(`
          INSERT INTO public.cards (
            owner_user_id,
            visibility,
            skill,
            pattern,
            front_text,
            back_text,
            card_key
          ) VALUES (
            ${sqlLiteral(ownerUserId)}::uuid,
            'private',
            'reading',
            'R2',
            'e2e03-non-owner-private-front',
            'e2e03-non-owner-private-back',
            ${sqlLiteral(`e2e03-non-owner-private-${nowSuffix}`)}
          )
        `);
			});

			expectRlsDenied(() => {
				actors.anonymous.runSql(`
          INSERT INTO public.cards (
            owner_user_id,
            visibility,
            skill,
            pattern,
            front_text,
            back_text,
            card_key
          ) VALUES (
            ${sqlLiteral(ownerUserId)}::uuid,
            'private',
            'reading',
            'R2',
            'e2e03-anonymous-private-front',
            'e2e03-anonymous-private-back',
            ${sqlLiteral(`e2e03-anonymous-private-${nowSuffix}`)}
          )
        `);
			});

			const ownerUpdatedRows = actors.owner.queryRows<IdRow>(`
        UPDATE public.cards
        SET back_text = 'e2e03-owner-private-updated'
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(ownerUpdatedRows).toEqual([{ id: privateCardId }]);

			const nonOwnerUpdatedRows = actors.nonOwner.queryRows<IdRow>(`
        UPDATE public.cards
        SET back_text = 'e2e03-non-owner-private-update'
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(nonOwnerUpdatedRows).toHaveLength(0);

			const anonymousUpdatedRows = actors.anonymous.queryRows<IdRow>(`
        UPDATE public.cards
        SET back_text = 'e2e03-anonymous-private-update'
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(anonymousUpdatedRows).toHaveLength(0);

			const ownerDeckDeleteRows = actors.owner.queryRows<IdRow>(`
        DELETE FROM public.decks
        WHERE id = ${sqlLiteral(ownerDeckId)}::uuid
        RETURNING id::text AS id
      `);
			expect(ownerDeckDeleteRows).toHaveLength(0);

			const deckCountRows = queryRows<CountRow>(`
        SELECT COUNT(*)::int AS count
        FROM public.decks
        WHERE id = ${sqlLiteral(ownerDeckId)}::uuid
      `);
			expect(deckCountRows[0]?.count).toBe(1);

			runSql(`
        UPDATE public.study_sessions
        SET current_card_id = NULL
        WHERE user_id = ${sqlLiteral(ownerUserId)}::uuid
          AND current_card_id = ${sqlLiteral(privateCardId)}::uuid
      `);

			const nonOwnerDeletedRows = actors.nonOwner.queryRows<IdRow>(`
        DELETE FROM public.cards
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(nonOwnerDeletedRows).toHaveLength(0);

			const anonymousDeletedRows = actors.anonymous.queryRows<IdRow>(`
        DELETE FROM public.cards
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(anonymousDeletedRows).toHaveLength(0);

			const ownerDeletedRows = actors.owner.queryRows<IdRow>(`
        DELETE FROM public.cards
        WHERE id = ${sqlLiteral(privateCardId)}::uuid
        RETURNING id::text AS id
      `);
			expect(ownerDeletedRows).toEqual([{ id: privateCardId }]);
		} finally {
			fixture.cleanup();
		}
	});

	// 実行順序: Scenario 4 - owner scoped private data and storage

	// AC原文トレース: AC-07, AC-08, AC-10
	// AC解釈: 業務テーブルとillustrations bucketの両方でowner scoped private境界が一貫する必要がある。
	// 検証: owner/non-owner/anonymousでテーブル操作とstorage object操作を横断的に試行する。
	// 期待結果: ownerのみ成功し、non-owner/anonymousは拒否される。
	// 合格基準: private + owner scopedがDB/Storage両面で成立。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-04: users/decks/review/session/illustrationsとstorage objectsがowner scoped privateで統一される", () => {
		const dbFixture = createRlsFixture("e2e04-db");

		try {
			const {
				actors,
				ownerUserId,
				ownerDeckId,
				privateCardId,
				ownerIllustrationId,
				ownerStudySessionId,
			} = dbFixture;
			const dbChecks = [
				{
					query: `
            SELECT user_id::text AS id
            FROM public.users_profile
            WHERE user_id = ${sqlLiteral(ownerUserId)}::uuid
          `,
				},
				{
					query: `
            SELECT id::text AS id
            FROM public.decks
            WHERE id = ${sqlLiteral(ownerDeckId)}::uuid
          `,
				},
				{
					query: `
            SELECT card_id::text AS id
            FROM public.deck_cards
            WHERE deck_id = ${sqlLiteral(ownerDeckId)}::uuid
              AND card_id = ${sqlLiteral(privateCardId)}::uuid
          `,
				},
				{
					query: `
            SELECT card_id::text AS id
            FROM public.review_states
            WHERE user_id = ${sqlLiteral(ownerUserId)}::uuid
              AND card_id = ${sqlLiteral(privateCardId)}::uuid
          `,
				},
				{
					query: `
            SELECT id::text AS id
            FROM public.study_sessions
            WHERE id = ${sqlLiteral(ownerStudySessionId)}::uuid
          `,
				},
				{
					query: `
            SELECT id::text AS id
            FROM public.illustrations
            WHERE id = ${sqlLiteral(ownerIllustrationId)}::uuid
          `,
				},
			] as const;

			for (const check of dbChecks) {
				const ownerRows = actors.owner.queryRows<IdRow>(check.query);
				const nonOwnerRows = actors.nonOwner.queryRows<IdRow>(check.query);
				const anonymousRows = actors.anonymous.queryRows<IdRow>(check.query);

				expect(ownerRows).toHaveLength(1);
				expect(nonOwnerRows).toHaveLength(0);
				expect(anonymousRows).toHaveLength(0);
			}
		} finally {
			dbFixture.cleanup();
		}

		const storageFixture = createStorageBoundaryFixture("e2e04-storage");
		const nowSuffix = Date.now();

		try {
			const {
				actors,
				ownerUserId,
				nonOwnerUserId,
				ownerIllustrationId,
				ownerObjectId,
				ownerObjectName,
			} = storageFixture;

			const bucketRows = queryRows<StorageBucketRow>(`
        SELECT id, public AS is_public
        FROM storage.buckets
        WHERE id = ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)}
      `);
			expect(bucketRows).toEqual([{ id: ILLUSTRATIONS_STORAGE_BUCKET, is_public: false }]);

			for (const actor of [actors.owner, actors.nonOwner, actors.anonymous]) {
				const illustrationRows = actor.queryRows<IdRow>(`
          SELECT id::text AS id
          FROM public.illustrations
          WHERE id = ${sqlLiteral(ownerIllustrationId)}::uuid
        `);
				const objectRows = actor.queryRows<StorageObjectRow>(`
          SELECT id::text AS id, name
          FROM storage.objects
          WHERE id = ${sqlLiteral(ownerObjectId)}::uuid
        `);
				const isOwner = actor.userId === ownerUserId;

				if (isOwner) {
					expect(illustrationRows).toEqual([{ id: ownerIllustrationId }]);
					expect(objectRows).toEqual([{ id: ownerObjectId, name: ownerObjectName }]);
				} else {
					expect(illustrationRows).toHaveLength(0);
					expect(objectRows).toHaveLength(0);
				}
			}

			const ownerInsertedName = buildIllustrationsStorageObjectName(
				ownerUserId,
				`e2e04-owner-insert-${nowSuffix}.png`
			);
			const ownerInsertedRows = actors.owner.queryRows<IdRow>(`
        INSERT INTO storage.objects (bucket_id, name)
        VALUES (
          ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)},
          ${sqlLiteral(ownerInsertedName)}
        )
        RETURNING id::text AS id
      `);
			expect(ownerInsertedRows).toHaveLength(1);

			const ownerInsertedObjectId = ownerInsertedRows[0]?.id;
			expect(ownerInsertedObjectId).toBeDefined();
			if (ownerInsertedObjectId === undefined) {
				throw new Error("owner inserted object id is required");
			}

			const ownerScopedAttackName = buildIllustrationsStorageObjectName(
				ownerUserId,
				`e2e04-cross-attack-${nowSuffix}.png`
			);
			expectRlsDenied(() => {
				actors.nonOwner.runSql(`
          INSERT INTO storage.objects (bucket_id, name)
          VALUES (
            ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)},
            ${sqlLiteral(ownerScopedAttackName)}
          )
        `);
			});
			expectRlsDenied(() => {
				actors.anonymous.runSql(`
          INSERT INTO storage.objects (bucket_id, name)
          VALUES (
            ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)},
            ${sqlLiteral(ownerScopedAttackName)}
          )
        `);
			});

			const nonOwnerScopedName = buildIllustrationsStorageObjectName(
				nonOwnerUserId,
				`e2e04-owner-cross-write-${nowSuffix}.png`
			);
			expectRlsDenied(() => {
				actors.owner.runSql(`
          INSERT INTO storage.objects (bucket_id, name)
          VALUES (
            ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)},
            ${sqlLiteral(nonOwnerScopedName)}
          )
        `);
			});

			const ownerDeletedRows = actors.owner.queryRows<IdRow>(`
        DELETE FROM storage.objects
        WHERE id = ${sqlLiteral(ownerInsertedObjectId)}::uuid
        RETURNING id::text AS id
      `);
			expect(ownerDeletedRows).toEqual([{ id: ownerInsertedObjectId }]);
		} finally {
			storageFixture.cleanup();
		}
	});

	// 実行順序: Scenario 5 - type generation and frontend contract

	// AC原文トレース: AC-12
	// AC解釈: 型生成結果が規定パスに出力され、フロント実装がその単一型契約へ接続できる必要がある。
	// 検証: supabase gen types 実行後に frontend/src/types/database.ts を参照し、7テーブル型の存在を確認する。
	// 期待結果: 型出力先のぶれがなく、フロント側で参照可能。
	// 合格基準: 出力ファイル固定 + 7テーブル包含を確認。
	// @category: e2e
	// @dependency: full-system
	// @complexity: medium
	it("E2E-05: supabase gen types 経由で frontend/src/types/database.ts に7テーブル型契約が反映される", () => {
		expect(fs.existsSync(frontendDatabaseTypePath)).toBe(true);
		expect(fs.existsSync(path.resolve(__dirname, "../../../../frontend/types/database.ts"))).toBe(false);

		const generatedTypeFile = fs.readFileSync(frontendDatabaseTypePath, "utf8");
		expect(generatedTypeFile).toContain("export type Database =");
		expect(generatedTypeFile).toContain("public: {");
		expect(generatedTypeFile).toContain("Tables: {");

		for (const tableName of expectedPublicTables) {
			expect(generatedTypeFile).toContain(`${tableName}: {`);
		}

		const tableRows = queryRows<TableNameRow>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users_profile',
          'decks',
          'cards',
          'deck_cards',
          'review_states',
          'illustrations',
          'study_sessions'
        )
      ORDER BY table_name
    `);
		expect(tableRows.map((row) => row.table_name)).toEqual([
			"cards",
			"deck_cards",
			"decks",
			"illustrations",
			"review_states",
			"study_sessions",
			"users_profile",
		]);

		const serverClientSource = fs.readFileSync(frontendServerClientPath, "utf8");
		const browserClientSource = fs.readFileSync(frontendBrowserClientPath, "utf8");

		expect(serverClientSource).toContain("createSupabaseServerClient<Database>");
		expect(browserClientSource).toContain("createSupabaseBrowserClient<Database>");
	});
});
