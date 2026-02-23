# S-01-task decomposition overview

## 目標
- `plan.md` を実行順と依存関係を崩さない形で、`frontend` 配下のブートストラップに限定した縦割りタスクへ分解する。
- 想定コミット数（各Phase 1コミット）を保持しつつ、Phase境界内で `Red-Green-Refactor` を実施可能にする。

## タスク一覧（Phase別）

- `task-bootstrap-phase0-001.md`
  - 先行基盤（最小 frontend 構成）と env 検証の基礎、`.env.local.example`/`.gitignore`、`env.ts` のテストをまとめる
  - 依存: `plan.md`, `requirements.md`, `design.md`, `story.md`

- `task-supabase-phase1-002.md`
  - `server.ts` / `client.ts` の分離実装とテストをまとめる
  - 依存: `task-bootstrap-phase0-001.md`

- `task-router-stubs-phase2-003.md`
  - App Router の必須ページ群とグローバルスタイル、UIスタブテストをまとめる
  - 依存: `task-bootstrap-phase0-001.md`

- `task-tooling-phase3-004.md`
  - TypeScript / Biome / Vitest の基盤設定と `package.json` スクリプト統合をまとめる
  - 依存: `task-bootstrap-phase0-001.md`

- `task-integration-e2e-phase4-005.md`
  - 統合テストと E2E テストの実装、AC対応、レビュー阻止観点の実装をまとめる
  - 依存: `task-bootstrap-phase0-001.md`, `task-supabase-phase1-002.md`, `task-router-stubs-phase3-004.md`

- `task-quality-gate-phase5-006.md`
  - 全フェーズ完了後に実行する最終品質固定とエビデンス確認をまとめる
  - 依存: `task-integration-e2e-phase4-005.md`

## 依存関係

- Phase0 が `frontend/` 基盤の必須ファイルを作成し、後続タスクの前提を満たす。
- Phase1/3/4 は実装内容が独立するが、すべて `frontend/src/lib/env.ts` と `frontend/src/app` の前提を参照する。
- 品質固定は Phase5 で実施し、Phase0〜4 の実装完了を前提にする。

## 実装品質ルール

- 各タスクは1コミット想定で、`Red`（失敗テスト）→`Green`（最小実装）→`Refactor`（整える）を実施する。
- `process.env` への直接参照を `env.ts` 外で増やさないよう、変更差分内をスキャンする。
- テスト更新は `target file` と同一 PR/コミットで閉じる。
