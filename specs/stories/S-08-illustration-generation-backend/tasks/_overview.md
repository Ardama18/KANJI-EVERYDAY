# S-08 task decomposition overview

## 目的
- `specs/stories/S-08-illustration-generation-backend/plan.md` を、phase順で独立実行可能な1コミット粒度へ分解する。
- 各タスクで Red-Green-Refactor を完結させ、統合テストを各phase内で同時に成立させる。
- 最終phaseでE2E・品質ゲート・トレーサビリティを固定し、S-08の受入完了を判定可能にする。

## 分解方針
- Phase 1=2件、Phase 2=2件、Phase 3=1件、最終Phase=1件の合計6タスクで構成する。
- 同一ユースケースは縦に統合し、雛形のみのmicro-taskは作らない。
- フェーズ完了チェック（対象AC・統合テスト・品質固定）は各phaseの最後のタスクに統合する。
- E2Eは plan.md のルールどおり最終Phaseでのみ実行する。

## 確認レベル（運用定義）
- L1: 静的確認（type/lint）と対象ユニットテストの通過
- L2: phase対象のユニット/統合テスト通過と対象AC観点の成立
- L3: ストーリー全体の統合テスト・E2E・品質ゲート通過と証跡更新

注記: `task-decomposer` が参照する `/.claude/steering/architecture/implementation-approach.md` は現リポジトリに存在しないため、既存ストーリー運用に合わせて上記L1/L2/L3定義を適用する。

## タスク一覧

1. `task-illustration-generation-backend-phase1-001.md`
- 目的: env optional契約とServer Action向けSupabaseクライアント境界を固定する。
- 依存: なし
- 検証レベル: L2

2. `task-illustration-generation-backend-phase1-002.md`
- 目的: `triggerIllustrationGeneration` の認証/状態遷移/fire-and-forgetを実装し、Phase 1統合テストを合格させる。
- 依存: `task-illustration-generation-backend-phase1-001.md`
- 検証レベル: L2

3. `task-illustration-generation-backend-phase2-003.md`
- 目的: prompt sanitization と Gemini fetchクライアントを実装し、入力/失敗分類契約を固定する。
- 依存: `task-illustration-generation-backend-phase1-002.md`
- 検証レベル: L2

4. `task-illustration-generation-backend-phase2-004.md`
- 目的: Storageアップロードと生成オーケストレーションを実装し、Phase 2統合テストを合格させる。
- 依存: `task-illustration-generation-backend-phase2-003.md`
- 検証レベル: L2

5. `task-illustration-generation-backend-phase3-005.md`
- 目的: `getIllustrationUrl` の latest-ready決定規則を実装し、Phase 3統合テストとトレーサビリティ更新を完了する。
- 依存: `task-illustration-generation-backend-phase2-004.md`
- 検証レベル: L2

6. `task-illustration-generation-backend-phase4-006.md`
- 目的: E2E-AC01〜14、統合回帰、frontend品質ゲート、最終トレーサビリティを確定する。
- 依存: `task-illustration-generation-backend-phase3-005.md`
- 検証レベル: L3

## 依存関係
- `task-illustration-generation-backend-phase1-001.md`
  -> `task-illustration-generation-backend-phase1-002.md`
  -> `task-illustration-generation-backend-phase2-003.md`
  -> `task-illustration-generation-backend-phase2-004.md`
  -> `task-illustration-generation-backend-phase3-005.md`
  -> `task-illustration-generation-backend-phase4-006.md`

## 共通実行前提
- 作業ディレクトリ: `KANJI-EVERYDAY` ルート。
- frontend対象テストは `npm run test --prefix frontend -- <path>` で実行する。
- story配下のテストファイルをfrontend経由で実行できるよう `frontend/vitest.config.ts` 設定を維持する。
- E2E実行前に Phase 1〜3 の実装・unit/integration を完了させる。
