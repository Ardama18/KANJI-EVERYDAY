// S-02 統合テスト - Design Doc: database-schema-rls
// 生成日: 2026-02-23
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Design AC）:
// AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12

import { describe, expect, it } from "vitest";

import {
  createAuthUserFixture,
  queryRows,
  runSql,
  sqlLiteral,
} from "./helpers/s02-db-testkit";
import {
  assertSchemaContract,
  hasUniqueIllustrationKeyConstraint,
} from "./helpers/schema-assertions";

interface ExtensionRow {
  extname: string;
}

interface UuidDefaultRow {
  table_name: string;
  default_expr: string;
}

interface TriggerRow {
  table_name: string;
  trigger_name: string;
  trigger_definition: string;
}

interface UpdatedAtRow {
  updated_at: string;
}

interface CountRow {
  count: number;
}

describe("database-schema-rls 統合テスト", () => {
  // 実行順序: Phase 0 - Schema / Extension / Trigger

  // AC原文 (AC-01): システムは `users_profile`, `decks`, `cards`, `deck_cards`, `review_states`, `illustrations`, `study_sessions` の7テーブルを、要件定義書AC#1の列契約・制約・インデックスで保持すること。
  // AC解釈: 7テーブルそれぞれのPK/FK/NOT NULL/DEFAULT/CHECK/INDEXが設計マトリクスと一致する必要がある。
  // 検証: information_schema / pg_catalog を用いてテーブル定義・制約・インデックスを照合する。
  // 期待結果: AC-01スキーマ契約マトリクスとの差分が0件である。
  // 合格基準: 7/7テーブルで定義一致。
  // @category: integration
  // @dependency: supabase/migrations/*_s02_schema_rls.sql
  // @complexity: high
  it("AC-01: 7テーブルのスキーマ契約（列/制約/インデックス）が設計マトリクスと一致する", () => {
    assertSchemaContract();
  });

  // AC原文 (AC-02): マイグレーションが開始されたとき、システムは `pgcrypto` を有効化し、`gen_random_uuid()` 利用列の作成を成功させること。
  // AC解釈: extension作成がDDLより前に成立し、UUID default列がエラーなく作成される必要がある。
  // 検証: pg_extensionにpgcryptoが存在し、UUID default列の作成完了を確認する。
  // 期待結果: extension未導入由来のDDL失敗が発生しない。
  // 合格基準: pgcrypto有効化 + 対象列作成成功。
  // @category: integration
  // @dependency: supabase/migrations/*_s02_schema_rls.sql, PostgreSQL extension state
  // @complexity: medium
  it("AC-02: pgcrypto有効化後に gen_random_uuid() 利用列を正常作成できる", () => {
    const extensions = queryRows<ExtensionRow>(`
      SELECT extname
      FROM pg_extension
      WHERE extname = 'pgcrypto'
    `);
    expect(extensions).toEqual([{ extname: "pgcrypto" }]);

    const uuidDefaults = queryRows<UuidDefaultRow>(`
      SELECT
        table_name,
        column_default AS default_expr
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'id'
        AND table_name IN ('decks', 'cards', 'illustrations', 'study_sessions')
      ORDER BY table_name
    `);

    expect(uuidDefaults).toHaveLength(4);
    for (const row of uuidDefaults) {
      expect(row.default_expr).toContain("gen_random_uuid()");
    }

    const generated = queryRows<{ generated_uuid: string }>(`
      SELECT gen_random_uuid()::text AS generated_uuid
    `);
    expect(generated).toHaveLength(1);
    expect(generated[0]?.generated_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  // AC原文 (AC-03): `users_profile`, `decks`, `illustrations` の行が更新されたとき、システムは `updated_at` を自動更新すること。
  // AC解釈: 3テーブルにupdated_atトリガーが定義され、更新時刻が自動で進む必要がある。
  // 検証: トリガー存在確認 + UPDATE ... RETURNING updated_at の前後比較を実施する。
  // 期待結果: 3テーブルすべてでupdated_atが更新される。
  // 合格基準: トリガー作成済みかつ時刻前進が観測できる。
  // @category: integration
  // @dependency: supabase/migrations/*_s02_schema_rls.sql, update_updated_at_column() trigger function
  // @complexity: medium
  it("AC-03: users_profile/decks/illustrations 更新時に updated_at が自動更新される", () => {
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

    const { userId } = createAuthUserFixture("ac03");

    runSql(`
      INSERT INTO public.users_profile (user_id, display_name)
      VALUES (${sqlLiteral(userId)}::uuid, 'AC03 User')
    `);

    const deckIdRows = queryRows<{ id: string }>(`
      INSERT INTO public.decks (owner_user_id, name)
      VALUES (${sqlLiteral(userId)}::uuid, 'AC03 Deck')
      RETURNING id::text AS id
    `);

    runSql(`
      INSERT INTO public.illustrations (owner_user_id, illustration_key)
      VALUES (${sqlLiteral(userId)}::uuid, 'ac03-shared-key')
    `);

    const deckId = deckIdRows[0]?.id;
    expect(deckId).toBeDefined();

    const usersProfileBefore = queryRows<UpdatedAtRow>(`
      SELECT updated_at::text AS updated_at
      FROM public.users_profile
      WHERE user_id = ${sqlLiteral(userId)}::uuid
    `)[0];
    expect(usersProfileBefore).toBeDefined();

    runSql("SELECT pg_sleep(0.02)");

    const usersProfileAfter = queryRows<UpdatedAtRow>(`
      UPDATE public.users_profile
      SET display_name = 'AC03 User Updated'
      WHERE user_id = ${sqlLiteral(userId)}::uuid
      RETURNING updated_at::text AS updated_at
    `)[0];

    expect(usersProfileAfter).toBeDefined();
    expect(new Date(usersProfileAfter?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date(usersProfileBefore?.updated_at ?? 0).getTime()
    );

    const decksBefore = queryRows<UpdatedAtRow>(`
      SELECT updated_at::text AS updated_at
      FROM public.decks
      WHERE id = ${sqlLiteral(deckId ?? "")}::uuid
    `)[0];
    expect(decksBefore).toBeDefined();

    runSql("SELECT pg_sleep(0.02)");

    const decksAfter = queryRows<UpdatedAtRow>(`
      UPDATE public.decks
      SET name = 'AC03 Deck Updated'
      WHERE id = ${sqlLiteral(deckId ?? "")}::uuid
      RETURNING updated_at::text AS updated_at
    `)[0];

    expect(decksAfter).toBeDefined();
    expect(new Date(decksAfter?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date(decksBefore?.updated_at ?? 0).getTime()
    );

    const illustrationsBefore = queryRows<UpdatedAtRow>(`
      SELECT updated_at::text AS updated_at
      FROM public.illustrations
      WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
        AND illustration_key = 'ac03-shared-key'
      ORDER BY created_at DESC
      LIMIT 1
    `)[0];
    expect(illustrationsBefore).toBeDefined();

    runSql("SELECT pg_sleep(0.02)");

    const illustrationsAfter = queryRows<UpdatedAtRow>(`
      UPDATE public.illustrations
      SET status = 'ready'
      WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
        AND illustration_key = 'ac03-shared-key'
      RETURNING updated_at::text AS updated_at
    `)[0];

    expect(illustrationsAfter).toBeDefined();
    expect(new Date(illustrationsAfter?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date(illustrationsBefore?.updated_at ?? 0).getTime()
    );
  });

  // 実行順序: Phase 1 - RLS Policy

  // AC原文 (AC-04): システムは7/7テーブルでRLSを有効化すること。
  // AC解釈: 対象7テーブルすべてでrowsecurity=trueである必要がある。
  // 検証: pg_class/pg_tablesからRLS有効状態を照会する。
  // 期待結果: 7テーブルすべて有効。
  // 合格基準: RLS有効率 7/7。
  // @category: integration
  // @dependency: supabase/migrations/*_s02_schema_rls.sql
  // @complexity: low
  it.todo("AC-04: 7テーブルすべてでRLSが有効化される");

  // AC原文 (AC-05): もし `cards.visibility='public'` なら、システムは未認証ユーザー（anonymous）を含む全ユーザーにSELECTを許可し、INSERT/UPDATE/DELETEを拒否すること。
  // AC解釈: public行は閲覧専用で、匿名・認証済みの別を問わず書き込み禁止。
  // 検証: anonymous/authenticatedのSELECT成功とINSERT/UPDATE/DELETE拒否を確認する。
  // 期待結果: SELECTのみ許可される。
  // 合格基準: public行に対する書き込み拒否率 100%。
  // @category: integration
  // @dependency: cards RLS policies, anonymous/authenticated DB sessions
  // @complexity: high
  it.todo("AC-05: cards public行は全員SELECT可かつ全員書き込み不可（read-only）である");

  // AC原文 (AC-06): もし `cards.visibility='private'` なら、システムは所有者本人にのみINSERT/UPDATE/DELETEを許可すること。
  // AC解釈: private行の書き込みはowner strictで、非所有者/未認証は拒否される必要がある。
  // 検証: owner/non-owner/anonymousそれぞれでINSERT/UPDATE/DELETEを試行する。
  // 期待結果: ownerのみ成功。
  // 合格基準: 非所有書き込み拒否率 100%。
  // @category: integration
  // @dependency: cards RLS policies, owner/non-owner identities
  // @complexity: high
  it.todo("AC-06: cards private行は所有者本人のみINSERT/UPDATE/DELETE可能である");

  // AC原文 (AC-07): システムは `illustrations` をprivate + owner scopedとして扱い、非所有者/未認証のSELECT/INSERT/UPDATE/DELETEを拒否すること。
  // AC解釈: illustrationsは全操作でownerのみ許可される。
  // 検証: owner/non-owner/anonymousでCRUDを実行し結果を比較する。
  // 期待結果: owner以外は全操作拒否。
  // 合格基準: non-owner/anonymous拒否率 100%。
  // @category: integration
  // @dependency: illustrations table policies, authenticated roles
  // @complexity: high
  it.todo("AC-07: illustrations は private + owner scoped で non-owner/anonymous を全操作拒否する");

  // AC原文 (AC-08): システムは `users_profile`, `decks`, `deck_cards`, `review_states`, `study_sessions` のSELECT/INSERT/UPDATEを所有者本人（または自分自身）のみに制限すること。
  // AC解釈: 5テーブルの主要操作はowner-only境界で一貫し、他ユーザーアクセスを拒否する必要がある。
  // 検証: 各テーブルでowner/non-ownerのSELECT/INSERT/UPDATE挙動を検証する。
  // 期待結果: ownerのみ許可。
  // 合格基準: 5テーブル全操作でowner-onlyを再現。
  // @category: integration
  // @dependency: users_profile/decks/deck_cards/review_states/study_sessions policies
  // @complexity: high
  it.todo("AC-08: 5テーブルのSELECT/INSERT/UPDATEは所有者本人のみに制限される");

  // AC原文 (AC-09): もしDELETEポリシーが明示されていないテーブルDELETEが試行された場合、システムは操作を拒否すること。
  // AC解釈: cards private owner DELETE以外はdefault denyで拒否される必要がある。
  // 検証: DELETE未許可テーブルでowner/non-owner双方のDELETEを試行する。
  // 期待結果: 未明示DELETEはすべて拒否。
  // 合格基準: 非allow-list DELETE拒否率 100%。
  // @category: edge-case
  // @dependency: table DELETE policies, default deny behavior
  // @complexity: medium
  it.todo("AC-09: 明示DELETEポリシー未定義テーブルのDELETE試行はすべて拒否される");

  // 実行順序: Phase 2 - Storage Policy

  // AC原文 (AC-10): システムはStorageバケット `illustrations` をprivateで作成し、オブジェクトアクセスをowner scopedに制御すること。
  // AC解釈: bucket public=false かつ storage.objects policyでowner-onlyアクセス制御が必要。
  // 検証: bucket属性確認 + owner/non-owner/anonymousのobject read/write/delete試行を行う。
  // 期待結果: ownerのみアクセス可。
  // 合格基準: バケット非公開 + non-owner/anonymous拒否率 100%。
  // @category: integration
  // @dependency: supabase/migrations/*_s02_storage_illustrations.sql, storage.objects policies
  // @complexity: high
  it.todo("AC-10: Storage illustrations バケットはprivateかつowner scopedアクセス制御を満たす");

  // AC原文 (AC-11): システムは `illustrations.illustration_key` にUNIQUE制約を付与しないこと。
  // AC解釈: illustration_keyの重複値を許容し、将来拡張を阻害しない必要がある。
  // 検証: pg_constraint/index情報からUNIQUE未設定を確認し、重複insertを試行する。
  // 期待結果: UNIQUE違反が発生しない。
  // 合格基準: illustration_keyに一意制約が存在しないことを確認。
  // @category: edge-case
  // @dependency: illustrations table constraints
  // @complexity: medium
  it("AC-11: illustrations.illustration_key に UNIQUE制約が存在しない", () => {
    expect(hasUniqueIllustrationKeyConstraint()).toBe(false);

    const { userId } = createAuthUserFixture("ac11");
    const duplicatedKey = `ac11-duplicate-${Date.now()}`;

    runSql(`
      INSERT INTO public.illustrations (owner_user_id, illustration_key, status)
      VALUES
        (${sqlLiteral(userId)}::uuid, ${sqlLiteral(duplicatedKey)}, 'pending'),
        (${sqlLiteral(userId)}::uuid, ${sqlLiteral(duplicatedKey)}, 'ready')
    `);

    const rows = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.illustrations
      WHERE owner_user_id = ${sqlLiteral(userId)}::uuid
        AND illustration_key = ${sqlLiteral(duplicatedKey)}
    `);

    expect(rows[0]?.count).toBe(2);
  });

  // 実行順序: Phase 3 - Type Contract

  // AC原文 (AC-12): 型生成コマンドが実行されたとき、システムは7テーブルを含む型を `frontend/src/types/database.ts` に出力すること。
  // AC解釈: 出力先固定と7テーブル包含の両方を満たす必要がある。
  // 検証: supabase gen types 実行後に出力ファイルと型定義内容を確認する。
  // 期待結果: frontend/src/types/database.ts に7テーブルが定義される。
  // 合格基準: 出力先の単一性 + 7テーブル型存在を確認。
  // @category: integration
  // @dependency: supabase CLI, frontend/src/types/database.ts
  // @complexity: medium
  it.todo("AC-12: 型生成結果が frontend/src/types/database.ts に出力され7テーブル型を含む");
});
