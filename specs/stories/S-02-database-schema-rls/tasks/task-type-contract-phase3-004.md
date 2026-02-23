# タスク: 型契約を生成してSupabaseクライアントへ適用（AC-12）

メタ情報:
- ストーリー: S-02-database-schema-rls
- フェーズ: 3
- 依存: `specs/stories/S-02-database-schema-rls/tasks/task-storage-boundary-phase2-003.md`
- 提供成果物:
  - `frontend/src/types/database.ts`
  - `frontend/src/lib/supabase/server.ts`（`Database` ジェネリクス適用）
  - `frontend/src/lib/supabase/client.ts`（`Database` ジェネリクス適用）
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`（AC-12 実装）
- 対応AC: AC-12
- サイズ: 標準（4-10ファイル）

## 実装内容
Supabase CLIで `frontend/src/types/database.ts` を生成し、`createServerClient` / `createBrowserClient` に `Database` ジェネリクスを適用する。AC-12統合テストで出力先固定と7テーブル型包含を検証する。

## 対象ファイル
- [x] `frontend/src/types/database.ts`
- [x] `frontend/src/lib/supabase/server.ts`
- [x] `frontend/src/lib/supabase/client.ts`
- [x] `frontend/src/lib/supabase/server.test.ts`
- [x] `frontend/src/lib/supabase/client.test.ts`
- [x] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] AC-12 を `it.todo` から失敗テストへ置き換える。
- [x] `frontend/src/lib/supabase/*` のテストで、`Database` 型未適用時に失敗する観点（型/import）を追加する。
- [x] `frontend/src/types/database.ts` が未生成または未包含状態で失敗することを確認する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-12"
npm --prefix frontend run typecheck
```

### 2. Green Phase
- [x] 型生成コマンドで `frontend/src/types/database.ts` を生成する。
- [x] `frontend/src/lib/supabase/server.ts` / `client.ts` に `Database` ジェネリクスを適用する。
- [x] 必要に応じて `server.test.ts` / `client.test.ts` の期待値を更新する。
- [x] AC-12とfrontend typecheckを通す。

```bash
supabase gen types typescript --local --schema public > frontend/src/types/database.ts
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-12"
npm --prefix frontend run test -- src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts
npm --prefix frontend run typecheck
```

### 3. Refactor Phase
- [x] `Database` 型importを単一パスに統一する（`frontend/src/types/database.ts`）。
- [x] 不要な型アサーション（`as`）を除去する。
- [x] AC-12とfrontendテストを再実行して回帰なしを確認する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-12"
npm --prefix frontend run test -- src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts
npm --prefix frontend run typecheck
```

## 完了条件
- [x] `frontend/src/types/database.ts` に7テーブル型が存在する。
- [x] `frontend/src/lib/supabase/server.ts` / `client.ts` が `Database` ジェネリクスを利用している。
- [x] AC-12統合テストがPASSする。
- [x] frontendの型チェックとSupabase client関連テストがPASSする。
- [x] 動作確認レベル L2 を満たす（AC-12 + 型検証）。

## 動作確認
- [x] `supabase gen types typescript --local --schema public > frontend/src/types/database.ts`（注: 本環境で `supabase` CLI未導入のため、同等の型契約を手動生成）
- [x] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts -t "AC-12"`（注: ローカル `frontend/node_modules/.bin/vitest` + 一時configで実行）
- [x] `npm --prefix frontend run test -- src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts`
- [x] `npm --prefix frontend run typecheck`
- [x] `git diff --name-only`
