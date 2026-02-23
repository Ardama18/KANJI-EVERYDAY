# タスク: サーバー/ブラウザ用 Supabase クライアント分離の実装

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 1
- 依存: `task-bootstrap-phase0-001.md`
- 対応要件: AC6
- サイズ: 標準（4-10ファイル）
- 依存成果物: `frontend/src/lib/env.ts`

## 実装内容

`server.ts` と `client.ts` の責務を明確に分離し、環境変数検証結果を `env.ts` からのみ参照する構造を作る。テストで import の混在や API の不一致を検証する。

## 対象ファイル
- [x] `frontend/src/lib/supabase/server.ts`
- [x] `frontend/src/lib/supabase/client.ts`
- [x] `frontend/src/lib/supabase/server.test.ts`
- [x] `frontend/src/lib/supabase/client.test.ts`
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/lib/supabase/server.test.ts` に `createServerClient` を使うことを期待する失敗テストを追加
- [x] `frontend/src/lib/supabase/client.test.ts` に `createBrowserClient` を使うことを期待する失敗テストを追加
- [x] `project-scaffolding.int.test.ts` の AC6 を実装観点として更新
- [x] 2つのテストを独立実行して `module not found` など既存未定義の失敗を確認

### 2. Green Phase
- [x] `frontend/src/lib/supabase/server.ts` を追加  
  - `createServerClient` 使用
  - `cookies()` と env 検証済みキーを注入
- [x] `frontend/src/lib/supabase/client.ts` を追加  
  - `createBrowserClient` 使用
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` のみを参照
- [x] 追加テストを最小実装で通す

### 3. Refactor Phase
- [x] 両モジュールでインポート/エクスポート名を統一
- [x] `frontend/src/lib/supabase/server.ts` 側で `env.ts` の例外を再送出せず透過的に扱う
- [x] 2つのテストを再実行し、共通ヘルパーがある場合は重複を整理

## 完了条件
- [x] `server.ts` が `createServerClient` を使用している
- [x] `client.ts` が `createBrowserClient` を使用している
- [x] 両テストが通る
- [x] server/client の責務境界が実装上明確
- [x] `project-scaffolding.int.test.ts` で AC6 実装方針を接続

## 動作確認
- [ ] `cd frontend && npx vitest run src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts`
- [ ] `rg "createServerClient|createBrowserClient" frontend/src/lib/supabase -g '*.ts'`
- [ ] `rg "process\\.env" frontend/src/lib/supabase -g '*.ts' | cat` で直接参照がないことを確認
