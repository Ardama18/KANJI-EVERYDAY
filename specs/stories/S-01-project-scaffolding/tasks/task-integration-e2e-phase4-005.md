# タスク: 統合テストとE2E導線・起動失敗観点の接続

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 4
- 依存: `task-bootstrap-phase0-001.md`, `task-supabase-phase1-002.md`, `task-router-stubs-phase2-003.md`, `task-tooling-phase3-004.md`
- 対応要件: AC1〜AC7
- サイズ: 大きめ（11-15ファイルを上限に統合）
- 依存成果物: `frontend/src/lib/env.ts`, `frontend/src/lib/supabase/*`, `frontend/app/*`

## 実装内容

受入テスト/導線テストを実装し、Phase0〜3の結果を1点結線して E2E 観点まで確定する。`process.env` 直接参照禁止の最終チェックを含め、AC1〜AC7 を証跡化する。

## 対象ファイル
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.ts`
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.ts`
- [x] `frontend/src/lib/env.ts`
- [x] `frontend/src/lib/env.test.ts`
- [x] `frontend/src/lib/supabase/server.ts`
- [x] `frontend/src/lib/supabase/client.ts`
- [x] `frontend/app/page.tsx`
- [x] `frontend/app/login/page.tsx`
- [x] `frontend/app/decks/page.tsx`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] 統合テストの TODO を 7件分の実装ケースへ置換
- [x] E2E の TODO を 3件分の実装ケースへ置換
- [x] 追加したテストを実行し、現状の未実装を確認
- [x] `process.env` の直接参照検知（簡易スクリプト）用の期待失敗条件を定義

### 2. Green Phase
- [x] `project-scaffolding.int.test.ts` の AC1/AC7 を満たす assertion を実装
  - `.env.local.example` の3鍵保証
  - 起動/テスト時の env 未設定検証
  - サーバー/クライアント分離の import 連携確認
  - `process.env` 直接参照検知テスト
- [x] `project-scaffolding.e2e.test.ts` で導線・スタブ・起動失敗を実装
- [x] 必要ならテスト向けのユーティリティを最小追加

### 3. Refactor Phase
- [x] E2E と統合ケースの期待値を共通化し重複を削減
- [x] 失敗時ログ文言を安定化して再実行比較を容易にする
- [x] 全テストを再実行

## 完了条件
- [x] 7 AC が統合テストで実装され、実行可能
- [x] E2E シナリオが `/`, `/login`, `/decks` の表示要件を担保
- [x] `SUPABASE_SERVICE_ROLE_KEY` 不足時の起動阻害観点をテストで明示
- [x] `process.env` の直接参照ガードが実体験として成立する

## 動作確認
- [ ] `npm run test -- --runInBand` 相当で int/e2e 両ファイルを実行（frontend 側から実行手順に合わせて）
- [ ] `cd frontend && npx vitest run src/lib/env.test.ts`
- [ ] `rg "process\\.env" frontend/src frontend/src/lib spec/stories/S-01-project-scaffolding/tests -g '*.ts' -g '*.tsx'`
- [ ] `git diff -- frontend/src/lib/env.ts frontend/src/lib/supabase/server.ts frontend/src/lib/supabase/client.ts | sed -n '1,200p'`
