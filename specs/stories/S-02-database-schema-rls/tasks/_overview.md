# S-02 task decomposition overview

## 目的
- `specs/stories/S-02-database-schema-rls/plan.md` を、1コミット=1タスクで実行可能な単位に分解する。
- 各Phase内で統合テストTODO実装と検証を完結させ、最終PhaseでE2Eと全体品質を固定する。

## 分解方針
- 実装戦略は Design Doc の `Hybrid（Schema-first + Policy-hardening + Type-contract integration）` を採用。
- plan.md の「想定コミット数: 各Phase 1」を維持し、Phase 0〜3 + 最終Phaseで合計5タスクに固定。
- スケルトンタスクを避けるため、各タスクに対象ファイル・実行コマンド・完了条件を明記。

## 確認レベル（運用定義）
- L1: 静的確認（lint/typecheck/構文確認）
- L2: Phase対象の統合テスト + SQL/Storage観測
- L3: ストーリー全体の統合テスト/E2E/型チェックを通した最終受入

注記: `task-decomposer` スキルが参照する `implementation-approach.md` はこのリポジトリに存在しないため、上記レベル定義を代替運用する。

## タスク一覧

1. `task-schema-trigger-phase0-001.md`
- 目的: `pgcrypto` + 7テーブルDDL + 制約/INDEX + `updated_at` トリガーを実装し、AC-01/02/03/11を統合テストで固定。
- 依存: なし
- 検証レベル: L2

2. `task-rls-policy-phase1-002.md`
- 目的: 7テーブルRLS有効化と `cards` 公開/私有境界、DELETE allow-listを実装し、AC-04〜09を固定。
- 依存: `task-schema-trigger-phase0-001.md`
- 検証レベル: L2

3. `task-storage-boundary-phase2-003.md`
- 目的: `illustrations` private bucket + owner scoped storage policyを実装し、AC-10を固定。
- 依存: `task-rls-policy-phase1-002.md`
- 検証レベル: L2

4. `task-type-contract-phase3-004.md`
- 目的: `frontend/src/types/database.ts` を生成し、Supabase clientに `Database` ジェネリクスを適用。AC-12を固定。
- 依存: `task-storage-boundary-phase2-003.md`
- 検証レベル: L2

5. `task-final-quality-e2e-phase4-005.md`
- 目的: E2E Scenario 1〜5と全統合テスト回帰を実行し、トレーサビリティ証跡を確定。
- 依存: `task-type-contract-phase3-004.md`
- 検証レベル: L3

## 依存関係
- `task-schema-trigger-phase0-001.md` → `task-rls-policy-phase1-002.md` → `task-storage-boundary-phase2-003.md` → `task-type-contract-phase3-004.md` → `task-final-quality-e2e-phase4-005.md`

## 共通実行前提
- Supabase CLI が利用可能であること（`supabase --version`）。
- Dockerが起動済みで、`supabase start` が成功すること。
- ルート作業ディレクトリは `S-02-database-schema-rls` ワークツリーであること。
