# S-09 task decomposition overview

## 目的
- `specs/stories/S-09-illustration-display-integration/plan.md` を、phase順で独立実行可能な1コミット粒度へ分解する。
- `revealCard`/`getStudySessionState` の状態契約統一、UI表示統合、画像設定固定、最終品質保証を段階的に完了する。
- 各phaseで統合テストを同時実装し、最終PhaseでE2Eと品質ゲートを完了させる。

## 分解方針
- Phase 1=2件、Phase 2=2件、Phase 3=1件、最終Phase=1件の合計6タスクで構成する。
- 同一ユースケースは縦に統合し、準備だけのmicro-taskは作らない。
- 統合テストはPhase 1/2/3で同時に具体化し、E2Eは最終Phaseに限定する。
- `ui_design: none` のため、UI phaseで手動確認を完了条件へ統合する。

## 確認レベル（運用定義）
- L1: 静的確認（type/lint）と対象ユニットテストの通過
- L2: phase対象のユニット/統合テスト通過と対象AC観点の成立
- L3: ストーリー全体の統合テスト・E2E・品質ゲート通過と証跡更新

注記: `task-decomposer` スキルが参照する `/.claude/steering/architecture/implementation-approach.md` は現リポジトリに存在しないため、既存ストーリー運用に合わせて上記L1/L2/L3定義を適用する。

## タスク一覧

1. `task-illustration-normalization-phase1-001.md`
- 目的: Server Actionの型契約と `normalizeIllustrationState` を固定し、5状態正規化の土台を作る。
- 依存: なし
- 検証レベル: L1

2. `task-reveal-backfill-phase1-002.md`
- 目的: `revealCard`/`getStudySessionState(phase=back)` へ正規化を統合し、Phase 1統合テスト（IT-AC01〜10）を合格させる。
- 依存: `task-illustration-normalization-phase1-001.md`
- 検証レベル: L2

3. `task-illustration-display-phase2-003.md`
- 目的: `IllustrationDisplay` の5状態描画と画像エラー時フォールバックを実装する。
- 依存: `task-reveal-backfill-phase1-002.md`
- 検証レベル: L1

4. `task-cardback-integration-phase2-004.md`
- 目的: `CardBack` 表示統合と評価導線継続性を実装し、Phase 2統合テスト（IT-AC11）と手動UI確認を完了する。
- 依存: `task-illustration-display-phase2-003.md`
- 検証レベル: L2

5. `task-image-contract-phase3-005.md`
- 目的: `next.config.mjs` と `<Image>` 契約を固定し、Phase 1〜3統合テスト回帰を完了する。
- 依存: `task-cardback-integration-phase2-004.md`
- 検証レベル: L2

6. `task-final-quality-e2e-phase4-006.md`
- 目的: E2E-AC01/03/12/13/14/15/16/17/20、統合回帰、frontend品質ゲート、トレーサビリティを確定する。
- 依存: `task-image-contract-phase3-005.md`
- 検証レベル: L3

## 依存関係
- `task-illustration-normalization-phase1-001.md`
  -> `task-reveal-backfill-phase1-002.md`
  -> `task-illustration-display-phase2-003.md`
  -> `task-cardback-integration-phase2-004.md`
  -> `task-image-contract-phase3-005.md`
  -> `task-final-quality-e2e-phase4-006.md`

## 共通実行前提
- 作業ディレクトリ: `KANJI-EVERYDAY` ルート。
- frontend対象テストは `npm run test --prefix frontend -- <path>` で実行する。
- story配下テストは `frontend/vitest.config.ts` で実行対象に含める。
- E2Eは最終Phaseまで着手しない。
