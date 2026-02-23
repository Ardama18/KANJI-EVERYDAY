# タスク: Storage private/owner-boundary を実装してAC-10を固定

メタ情報:
- ストーリー: S-02-database-schema-rls
- フェーズ: 2
- 依存: `specs/stories/S-02-database-schema-rls/tasks/task-rls-policy-phase1-002.md`
- 提供成果物:
  - `supabase/migrations/<timestamp>_s02_storage_illustrations.sql`
  - `specs/stories/S-02-database-schema-rls/tests/helpers/storage-actors.ts`
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`（AC-10 実装）
- 対応AC: AC-10
- サイズ: 標準（4-10ファイル）

## 実装内容
`illustrations` バケットを `public=false` で作成し、`storage.objects` にowner scoped policyを実装する。DB側 `illustrations` 境界とStorage境界が一致することを統合テスト（AC-10）で固定する。

## 対象ファイル
- [x] `supabase/migrations/<timestamp>_s02_storage_illustrations.sql`
- [x] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/storage-actors.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/s02-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] AC-10 を `it.todo` から失敗テストへ置き換える。
- [x] owner/non-owner/anonymous の object read/write/delete 失敗期待を先に記述する。
- [x] bucket属性（`public=false`）の検証クエリを追加する。
- [x] 失敗確認コマンドを実行する。

```bash
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-10"
```

### 2. Green Phase
- [x] `supabase/migrations/<timestamp>_s02_storage_illustrations.sql` を作成する。
- [x] `storage.buckets` へ `illustrations` (`public=false`) を作成するDDLを追加する。
- [x] `storage.objects` にowner scoped policy（SELECT/INSERT/UPDATE/DELETE必要操作）を追加する。
- [ ] AC-10テストが通るまでSQLとテストを調整する。

```bash
mkdir -p supabase/migrations
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-10"
```

### 3. Refactor Phase
- [x] bucket名・policy名・owner条件の定数をhelperへ集約する。
- [x] DB RLS（AC-07）との境界差分がないことをテストで明示する。
- [ ] AC-10を再実行し、回帰がないことを確認する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-10"
```

## 完了条件
- [x] `illustrations` バケットが `public=false` で作成される。
- [ ] ownerのみStorage objectアクセス可、non-owner/anonymous拒否を再現できる。
- [ ] AC-10統合テストがPASSする。
- [ ] DB `illustrations` 境界（AC-07）とStorage境界（AC-10）の不整合がない。
- [ ] 動作確認レベル L2 を満たす（AC-10 + 境界一致確認）。

## 動作確認
- [ ] `supabase db reset`
- [x] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-10"`
- [x] `git diff --name-only`
