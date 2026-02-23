# タスク: frontendブートストラップ基盤と環境変数フェイルファスト土台の構築

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 0
- 依存: なし（前提）
- 対応要件: AC1, AC2
- サイズ: 標準（4-10ファイル）
- 依存成果物: `specs/stories/S-01-project-scaffolding/plan.md`

## 実装内容

`frontend/` の最小プロジェクト土台を作成し、環境変数検証レイヤを導入してフェイルファストを成立させる。`frontend/src/lib/env.ts` を核にし、`NODE_ENV=test` でも `SUPABASE_SERVICE_ROLE_KEY` が必須となる動作を保証する。

## 対象ファイル
- [x] `frontend/package.json`
- [x] `frontend/src/lib/env.ts`
- [x] `frontend/src/lib/env.test.ts`
- [x] `frontend/.env.local.example`
- [x] `frontend/.gitignore`
- [x] `frontend/app/layout.tsx`
- [x] `frontend/app/page.tsx`
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/lib/env.test.ts` に未設定時の失敗ケースを追加する  
  - `NEXT_PUBLIC_SUPABASE_URL` 欠損
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` 欠損
  - `SUPABASE_SERVICE_ROLE_KEY` 欠損
  - `NODE_ENV=test` で `SUPABASE_SERVICE_ROLE_KEY` が未設定でも例外発火すること
- [x] `project-scaffolding.int.test.ts` の AC1・AC2 TODO を実装対象としてマーカー化
- [ ] 変更前に既存 `frontend` 未作成状態を確認し、ディレクトリ追加のみ差分として扱う
- [x] `npm` コマンドが未構成なので、テスト実行コマンドは `npx vitest run src/lib/env.test.ts` を前提に失敗確認する

### 2. Green Phase
- [x] `frontend/package.json` を最小構成で追加  
  - `@supabase/supabase-js` / `@supabase/ssr` は peer 互換版を指定
- [x] `frontend/src/lib/env.ts` を実装  
  - 3キーを取得し、欠落時は例外を throw
  - 欠落キー一覧をエラー文言に含める
- [x] `frontend/src/lib/env.test.ts` で上記 Red ケースが通ることを確認
- [x] `frontend/.env.local.example` をキー定義のみで作成（値は空）
- [x] `frontend/.gitignore` に `.env.local` を追加
- [x] `frontend/app/layout.tsx` と `frontend/app/page.tsx` を最小雛形として追加（Phase2で置換しやすい構造）

### 3. Refactor Phase
- [x] テスト失敗ケースのメッセージを共通化し、不足キー列挙の順序を安定化
- [x] `env.ts` の関数境界を `getEnvConfig`, `requireEnv` に寄せる
- [x] 変更後に `npx vitest run src/lib/env.test.ts` を再実行し、Greenを維持

## 完了条件
- [x] `.env.local.example` が 3 キーを欠かさず列挙する
- [x] `frontend/src/lib/env.ts` が未設定時に例外を throw し、欠落キーを出力する
- [x] `NODE_ENV=test` でも `SUPABASE_SERVICE_ROLE_KEY` 未設定時に失敗する
- [x] `process.env` 参照は `env.ts` を起点に限定される
- [x] `frontend/src/lib/env.test.ts` の追加テストが通る
- [x] `project-scaffolding.int.test.ts` で AC1/AC2 の TODO 対応タスク（実装準備）として明示している

## 動作確認
- [x] `cd frontend && npx vitest run src/lib/env.test.ts`（または `npm run test -- src/lib/env.test.ts`）
- [x] `.env.local.example` の記述を人手レビューで照合（3キー）
- [x] `rg "process\\.env" frontend -g '*.ts' -g '*.tsx' | cat` で直接参照を確認
