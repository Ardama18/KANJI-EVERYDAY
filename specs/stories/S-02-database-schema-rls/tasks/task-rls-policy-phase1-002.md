# タスク: 7テーブルRLSポリシーを実装してAC-04〜09を固定

メタ情報:
- ストーリー: S-02-database-schema-rls
- フェーズ: 1
- 依存: `specs/stories/S-02-database-schema-rls/tasks/task-schema-trigger-phase0-001.md`
- 提供成果物:
  - `supabase/migrations/<timestamp>_s02_schema_rls.sql`（RLS/policy追記）
  - `specs/stories/S-02-database-schema-rls/tests/helpers/rls-actors.ts`
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`（AC-04〜09 実装）
- 対応AC: AC-04, AC-05, AC-06, AC-07, AC-08, AC-09
- サイズ: 大きめ（11-15ファイル想定）

## 実装内容
7テーブルでRLSを有効化し、Design DocのRLS操作マトリクスに沿ってpolicyを実装する。`cards` は public read-only + private owner write/delete、その他テーブルは owner-only、DELETEは `cards private owner` 以外を未定義（default deny）で維持する。AC-04〜09を統合テストで固定する。

## 対象ファイル
- [x] `supabase/migrations/<timestamp>_s02_schema_rls.sql`
- [x] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/s02-db-testkit.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/rls-actors.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `database-schema-rls.int.test.ts` の AC-04〜09 を `it.todo` から失敗テストへ置き換える。
- [x] owner/non-owner/anonymous の3セッションを `tests/helpers/rls-actors.ts` で生成できるようにする。
- [x] `cards` の public/private 分岐と DELETE default deny の失敗ケースを先に固定する。
- [x] 失敗確認コマンドを実行する。

```bash
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-04"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-05"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-06"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-07"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-08"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-09"
```

### 2. Green Phase
- [x] 7テーブルすべてへ `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` を追加する。
- [x] テーブルごとのSELECT/INSERT/UPDATE policyをRLSマトリクスどおりに追加する。
- [x] `cards` のみ public SELECT policyを追加し、private owner write/delete policyを明示する。
- [x] `cards` 以外にはDELETE policyを追加しない（default denyを維持）。
- [x] AC-04〜09の統合テストをすべてPASSさせる。

```bash
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-04|AC-05|AC-06|AC-07|AC-08|AC-09"
```

### 3. Refactor Phase
- [x] policy名を一貫命名（`<table>_<action>_<scope>`）へ揃える。
- [x] テストデータ生成とクリーンアップ処理をhelperに集約する。
- [x] AC-04〜09を再実行し、回帰がないことを確認する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-04|AC-05|AC-06|AC-07|AC-08|AC-09"
```

## 完了条件
- [x] 7/7テーブルでRLS有効化を確認できる。
- [x] `cards public` は全員SELECT可・書き込み不可を再現できる。
- [x] `cards private` はownerのみINSERT/UPDATE/DELETE可を再現できる。
- [x] `cards private owner DELETE` 以外のDELETEが拒否されることを確認できる。
- [x] AC-04〜09の統合テストがすべてPASSする。
- [x] 動作確認レベル L2 を満たす（対象ACの統合テスト）。

## 動作確認
- [x] `supabase db reset`
- [x] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-04|AC-05|AC-06|AC-07|AC-08|AC-09"`
- [x] `git diff --name-only`
