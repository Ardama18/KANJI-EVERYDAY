# タスク: env契約とSupabaseサーバー境界を固定する

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 1
- 依存: なし
- 提供成果物:
  - `frontend/src/lib/env.ts`
  - `frontend/src/lib/env.test.ts`
  - `frontend/.env.local.example`
  - `frontend/src/lib/supabase/server.ts`
  - `frontend/vitest.config.ts`（storyテスト実行経路の調整が必要な場合）
  - `frontend/src/actions/illustration-actions.test.ts`（Supabase境界モック更新）
- 関連AC: AC-01, AC-08（前提契約）
- サイズ: 標準（4-10ファイル）

## 実装内容
`GEMINI_API_KEY` を optional契約として扱うenv定義を追加し、Server Action/非同期処理の両方で使用するSupabaseサーバークライアント境界を定義する。Phase 1後続タスクで状態遷移を実装できるよう、テスト基盤とモック境界を先に固定する。

## 対象ファイル
- [x] `frontend/src/lib/env.ts`
- [x] `frontend/src/lib/env.test.ts`
- [x] `frontend/.env.local.example`
- [x] `frontend/src/lib/supabase/server.ts`
- [x] `frontend/vitest.config.ts`
- [x] `frontend/src/actions/illustration-actions.test.ts`

## テスト観点
- Unit:
  - `GEMINI_API_KEY` が未設定でも env 読み込みで失敗しない
  - 既存必須env契約を壊さない
  - Server Action 向け Supabase クライアント境界をモック可能に保つ

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/lib/env.test.ts` に `GEMINI_API_KEY` optional 契約の失敗テストを追加する。
- [x] `frontend/src/actions/illustration-actions.test.ts` に Supabase server クライアント境界前提の失敗テストを追加する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/env.test.ts
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts
```

### 2. Green Phase
- [x] `frontend/src/lib/env.ts` で `GEMINI_API_KEY` を optional として取得する。
- [x] `frontend/.env.local.example` に optional契約の説明を追記する。
- [x] `frontend/src/lib/supabase/server.ts` に Server Action / background共通の取得境界を実装する。
- [x] 必要に応じて `frontend/vitest.config.ts` を更新し、story配下テストを実行可能にする。
- [x] 追加したテストを再実行して通過させる。

```bash
npm run test --prefix frontend -- src/lib/env.test.ts
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts
```

### 3. Refactor Phase
- [x] env/supabase境界の命名・責務分離を整理し、重複モックを削減する。
- [x] テストを再実行して回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/env.test.ts
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts
```

## 完了条件
- [x] `GEMINI_API_KEY` が optional契約としてコードと `.env.local.example` に反映されている。
- [x] `frontend/src/lib/supabase/server.ts` でServer Action向けクライアント境界が定義されている。
- [x] `env.test.ts` と `illustration-actions.test.ts` の対象ケースがPASSしている。
- [x] 後続タスク（状態遷移/生成処理）が同境界を再利用できる。
- [x] 動作確認レベル L2（対象Unit + 境界テスト）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/lib/env.test.ts`
- [x] `npm run test --prefix frontend -- src/actions/illustration-actions.test.ts`
- [x] `git diff --name-only`
