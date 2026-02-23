# タスク: 最終品質固定と受入評価

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 最終Phase（品質保証）
- 依存: `task-integration-e2e-phase4-005.md`
- 対応要件: AC1〜AC7 全件、品質ゲート
- サイズ: 小〜標準
- 依存成果物: `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx`, `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`

## 実装内容

Phase0〜4で実装した内容を最終的に一次結合し、受入観点（7 AC + 品質観点）を満たす状態でロールバック可能なコミットに固定する。変更ファイルの自己レビューを完了し、必要なら evidence の置場に実行結果をメモする。

## 対象ファイル
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx`
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`
- [x] `frontend/src/lib/env.ts`
- [x] `frontend/src/lib/supabase/server.ts`
- [x] `frontend/src/lib/supabase/client.ts`
- [x] `frontend/app/*`
- [x] `frontend/tsconfig.json`
- [x] `frontend/biome.json`
- [x] `frontend/vitest.config.ts`

## 実装手順（Red-Green-Refactor）

### 1. Red Phase
- [x] 実行結果の現状を1か所に集約し、未実行ケースを列挙
- [x] `implementation` 停止条件が残っていれば再実行要件へ分岐

### 2. Green Phase
- [x] 全テストカテゴリを実行:
  - `frontend` 単体/統合
  - ストーリー統合テスト
  - ストーリーE2E観点
  - 型チェック
  - Biome
- [x] `process.env` 直接参照の最終スキャン結果を保存

### 3. Refactor Phase
- [x] 失敗したテスト/lint があれば原因箇所を局所修正して再実行
- [x] カバレッジと実行ログ（失敗/成功）を要約し、品質固定に必要な記録を追加

## 完了条件
- [x] `frontend` の型・lint・テスト・E2E が全件成功
- [x] 受け入れ条件 AC1〜AC7 がテストと静的観点で説明可能
- [x] `process.env` 直接参照がレビュー阻止条件として確認され、残存しない
- [x] 品質固定の実施記録（実行手順・主要結果）が残る

品質固定実施記録: `specs/stories/S-01-project-scaffolding/quality-gate-phase5-006-result.md`

## 動作確認
- [x] `cd frontend && npx biome check .`
- [x] `cd frontend && npx tsc --noEmit`
- [x] `cd frontend && npx vitest run`
- [x] `cd frontend && npx vitest run ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`（or root 配置に合わせて調整）
- [x] `cd frontend && rg "process\\.env" src ../specs/stories/S-01-project-scaffolding/tests -g '*.ts' -g '*.tsx'`
- [x] `cd frontend && npm run build`
