# タスク: Schema/Extension/Trigger を実装してAC-01/02/03/11を固定

メタ情報:
- ストーリー: S-02-database-schema-rls
- フェーズ: 0
- 依存: なし
- 提供成果物:
  - `supabase/migrations/<timestamp>_s02_schema_rls.sql`
  - `specs/stories/S-02-database-schema-rls/tests/helpers/s02-db-testkit.ts`
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`（AC-01/02/03/11 実装）
- 対応AC: AC-01, AC-02, AC-03, AC-11
- サイズ: 大きめ（11-15ファイル想定）

## 実装内容
`pgcrypto` 有効化、7テーブルDDL（PK/FK/NOT NULL/DEFAULT/CHECK/INDEX）、`update_updated_at_column()` 関数、`users_profile` / `decks` / `illustrations` の3トリガーを1つのマイグレーションで実装する。併せて AC-01/02/03/11 の統合テストを `it.todo` から実装し、同Phaseで合格させる。

## 対象ファイル
- [x] `supabase/migrations/<timestamp>_s02_schema_rls.sql`
- [x] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/s02-db-testkit.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/schema-assertions.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/` を作成し、DB接続/クエリ補助の雛形を追加する。
- [x] `database-schema-rls.int.test.ts` の AC-01/02/03/11 を `it.todo` から失敗テストへ置き換える。
- [x] 各ACで以下を失敗状態で観測できるようにする。
  - AC-01: 7テーブル定義差分
  - AC-02: `pgcrypto` と UUID default
  - AC-03: トリガー存在 + `updated_at` 時刻前進
  - AC-11: `illustration_key` の非UNIQUE
- [x] 失敗確認コマンドを実行する。

```bash
mkdir -p specs/stories/S-02-database-schema-rls/tests/helpers
supabase start
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-01"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-02"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-03"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-11"
```

### 2. Green Phase
- [x] `supabase/migrations/<timestamp>_s02_schema_rls.sql` を作成する。
- [x] migration冒頭に `CREATE EXTENSION IF NOT EXISTS pgcrypto;` を配置する。
- [x] 7テーブルの列/制約/indexをDesign AC-01マトリクス通りに実装する。
- [x] `update_updated_at_column()` と3トリガーを実装する。
- [x] AC-01/02/03/11の統合テストが通るまでDDLとテストを調整する。

```bash
mkdir -p supabase/migrations
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-01"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-02"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-03"
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-11"
```

### 3. Refactor Phase
- [x] テスト内のSQL重複を `tests/helpers` へ集約する。
- [x] AC判定に不要なクエリや不安定な時刻比較を除去する。
- [x] Phase 0対象ACを連続実行して回帰がないことを確認する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-01|AC-02|AC-03|AC-11"
```

## 完了条件
- [x] `supabase/migrations/<timestamp>_s02_schema_rls.sql` に `pgcrypto` + 7テーブル + required constraints/index + trigger実装がある。
- [x] AC-01/02/03/11の統合テストがすべてPASSする。
- [x] `illustrations.illustration_key` にUNIQUE制約がないことをSQL検証で確認済み。
- [x] Phase 0の変更ファイルのみで1コミット可能な差分になっている。
- [x] 動作確認レベル L2 を満たす（対象ACのテスト + SQL観測）。

## 動作確認
- [x] `supabase db reset`
- [x] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-01|AC-02|AC-03|AC-11"`
- [x] `git diff --name-only`
