# S-03 task decomposition overview

## 目的
- `specs/stories/S-03-authentication-flow/plan.md` を、phase順で独立実行可能な 1コミット粒度へ分解する。
- 各タスクで Red-Green-Refactor を完結させ、対応ACを同一phase内で検証できる状態にする。
- 最終phaseで E2E・品質ゲート・トレーサビリティを固定し、ストーリー完了判定を明確化する。

## 分解方針
- plan.md の想定コミット数を尊重し、Phase 0=1件 / Phase 1=2件 / Phase 2=1件 / 最終Phase=1件 の合計5タスクで構成する。
- スケルトンタスクは禁止し、各タスクに対象ファイル・実行コマンド・完了条件・関連AC・テスト観点を明記する。
- 統合テスト `authentication-flow.int.test.tsx` は各phaseのタスクに内包し、E2Eは最終phaseでのみ実行する。

## 確認レベル（運用定義）
- L1: 静的確認（型・lint）および対象ユニットテストが通過
- L2: phase対象のユニット/統合テストが通過し、対象ACの受入観点を満たす
- L3: ストーリー全体の統合テスト・E2E・品質ゲートが通過し、トレーサビリティが更新される

注記: `task-decomposer` スキルが参照する `/.claude/steering/architecture/implementation-approach.md` は現リポジトリに存在しないため、上記レベル定義を代替運用する。

## タスク一覧

1. `task-middleware-boundary-phase0-001.md`
- 目的: middleware境界判定・matcher除外・Vitest実行経路を固定し、AC#15〜AC#18を成立させる。
- 依存: なし
- 検証レベル: L2

2. `task-signup-action-phase1-002.md`
- 目的: signup系 Server Action（型/バリデーション/エラーマッピング/profile初期作成）を実装し、AC#1〜AC#8・AC#20(signUp経路) を固定する。
- 依存: `task-middleware-boundary-phase0-001.md`
- 検証レベル: L2

3. `task-login-rescue-phase1-003.md`
- 目的: login/signout と profile救済ロジック（冪等）を実装し、AC#9〜AC#11・AC#13・AC#14・AC#20(signIn/signOut経路) を固定する。
- 依存: `task-signup-action-phase1-002.md`
- 検証レベル: L2

4. `task-auth-ui-layout-phase2-004.md`
- 目的: login/signup UI・auth layout・logout導線を統合し、AC#12・AC#19（+ AC#20 UI接続）を固定する。
- 依存: `task-login-rescue-phase1-003.md`
- 検証レベル: L2

5. `task-final-quality-e2e-phase3-005.md`
- 目的: E2E-AC01〜E2E-AC20、統合テスト全件回帰、frontend品質ゲート、トレーサビリティ整理を実施する。
- 依存: `task-auth-ui-layout-phase2-004.md`
- 検証レベル: L3

## 依存関係
- `task-middleware-boundary-phase0-001.md`
  -> `task-signup-action-phase1-002.md`
  -> `task-login-rescue-phase1-003.md`
  -> `task-auth-ui-layout-phase2-004.md`
  -> `task-final-quality-e2e-phase3-005.md`

## 共通実行前提
- 作業ディレクトリ: `KANJI-EVERYDAY` ルート。
- frontend テストは `npm run test --prefix frontend` を利用する。
- Supabase接続前提のテストは、実行環境設定（Auth設定含む）を事前に満たしていること。
- AC#2（`Enable email confirmations=OFF`）の運用チェック証跡を最終phaseで追記すること。
