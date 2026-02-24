# S-05 task decomposition overview

## 目的
- `specs/stories/S-05-srs-engine/plan.md` を、1コミット粒度で独立実行可能なタスクへ分解する。
- 各タスクで Red-Green-Refactor を完結させ、対応ACを同一Phase内で固定する。
- 最終Phaseで E2E・品質ゲート・トレーサビリティを確定し、S-05 の完了判定を明確化する。

## 分解方針
- plan.md の想定コミット数を尊重し、Phase 0=1件 / Phase 1=2件 / Phase 2=2件 / Phase 3=1件 / 最終Phase=1件（合計7タスク）で構成する。
- 統合テスト `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts` は各Phaseタスクに内包し、同Phase内で実装・実行・合格させる。
- E2Eテスト `specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts` は最終Phaseでのみ実行する。
- スケルトンタスクを避けるため、各タスクに対象ファイル・実行コマンド・完了条件・品質チェックを明記する。

## 確認レベル（代替運用定義）
- L1: 静的確認（typecheck/lint）と対象Unitテストが通過。
- L2: 対象PhaseのUnit + Integrationテストが通過し、該当ACが満たされる。
- L3: ストーリー全体のIntegration全件 + E2E + `npm run check --prefix frontend` が通過する。

注記: `task-decomposer` スキルで参照指定される `/.claude/steering/architecture/implementation-approach.md` は現リポジトリに存在しないため、上記を確認レベルの代替定義として採用する。

## タスク一覧
1. `task-contract-baseline-phase0-001.md`
- 目的: SRS公開契約（定数・型・公開境界）と S-05 テスト実行基盤を固定し、`IT-AC01`/`IT-AC02` を同コミットで合格させる。
- 依存: なし
- 検証レベル: L2

2. `task-calculate-core-phase1-002.md`
- 目的: `calculateRating` の基本遷移（good/hard/again、初回state=null、level clamp）を実装し、AC#3〜#7/#9/#10 を固定する。
- 依存: `task-contract-baseline-phase0-001.md`
- 検証レベル: L2

3. `task-calculate-time-preview-phase1-003.md`
- 目的: JST日次リセットと `getIntervalPreview` を実装し、AC#8/#11/#24 と Phase 1 統合テスト完了条件を固定する。
- 依存: `task-calculate-core-phase1-002.md`
- 検証レベル: L2

4. `task-classify-count-phase2-004.md`
- 目的: `classifyCard` / `countByCategory` を実装し、AC#12〜#15 を固定する。
- 依存: `task-calculate-time-preview-phase1-003.md`
- 検証レベル: L2

5. `task-build-session-queue-phase2-005.md`
- 目的: `buildSessionQueue` の順序・`newLimit` 正規化・初期retry構築を実装し、AC#16〜#18 を固定する。
- 依存: `task-classify-count-phase2-004.md`
- 検証レベル: L2

6. `task-queue-operations-phase3-006.md`
- 目的: キュー消化API（`getNextCardId`/`dequeueCard`/`addToRetryQueue`/`isSessionComplete`）を immutable 契約で実装し、AC#19〜#23 を固定する。
- 依存: `task-build-session-queue-phase2-005.md`
- 検証レベル: L2

7. `task-final-quality-e2e-phase4-007.md`
- 目的: E2E-AC01〜E2E-AC24、統合テスト全件回帰、frontend品質ゲート、トレーサビリティ整理を実施する。
- 依存: `task-queue-operations-phase3-006.md`
- 検証レベル: L3

## 依存関係
- `task-contract-baseline-phase0-001.md`
  -> `task-calculate-core-phase1-002.md`
  -> `task-calculate-time-preview-phase1-003.md`
  -> `task-classify-count-phase2-004.md`
  -> `task-build-session-queue-phase2-005.md`
  -> `task-queue-operations-phase3-006.md`
  -> `task-final-quality-e2e-phase4-007.md`

## 共通実行前提
- 作業ディレクトリはリポジトリルート（`KANJI-EVERYDAY`）。
- ストーリーテスト実行は `npm run test --prefix frontend -- <target>` を利用する。
- `calculateRating(state, rating, today, now)` は時刻注入を前提とし、実装内 `new Date()` 生成を禁止する。
- Pure / immutable 契約（入力オブジェクトを破壊しない）を全Taskで維持する。
