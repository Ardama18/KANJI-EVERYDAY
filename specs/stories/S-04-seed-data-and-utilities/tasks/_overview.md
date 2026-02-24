# S-04 task decomposition overview

## 目的
- `specs/stories/S-04-seed-data-and-utilities/plan.md` を 1コミット粒度で実行可能なタスクへ分解する。
- 各 Phase で統合テストを同時実装・同時検証し、最終 Phase でのみ E2E を実行する。
- Seed の冪等性・ロールバック保証と date utility 契約を、AC 単位で追跡可能にする。

## 分解方針
- plan.md の想定コミット数を尊重し、Phase 0=1件 / Phase 1=2件 / Phase 2=1件 / 最終Phase=1件の合計5タスクで構成する。
- スケルトンタスクは禁止し、各タスクに対象ファイル・実行コマンド・完了条件・関連 AC を明記する。
- `seed-data-and-utilities.int.test.ts` は各 Phase のタスク内で `it.todo` を実装し、同 Phase 内で合格させる。
- `seed-data-and-utilities.e2e.test.ts` は最終 Phase（phase3）でのみ実装・実行する。

## 確認レベル（運用定義）
- L1: 型・lint など静的確認と対象ユニットテストが通過
- L2: Phase 対象のユニット/統合テストが通過し、対象 AC を満たす
- L3: 統合テスト全件・E2E・品質ゲートが通過し、トレーサビリティが更新される

注記: `task-decomposer` が参照する `/.claude/steering/architecture/implementation-approach.md` は現リポジトリに存在しないため、上記レベル定義を代替運用する。

## タスク一覧

1. `task-seed-data-and-utilities-phase0-001.md`
- 目的: `date.ts` 4関数と fail-fast 契約を実装し、IT-AC01〜IT-AC06 を同 Phase で合格させる。
- 依存: なし
- 検証レベル: L2

2. `task-seed-data-and-utilities-phase1-002.md`
- 目的: Seed 固定データソース・固定 owner/profile/deck upsert・cards 100件投入を実装し、IT-AC07〜IT-AC09 を合格させる。
- 依存: `task-seed-data-and-utilities-phase0-001.md`
- 検証レベル: L2

3. `task-seed-data-and-utilities-phase1-003.md`
- 目的: Seed deck と全 Seed cards の `deck_cards` 紐付けを完成させ、IT-AC10 と Phase 1 回帰を合格させる。
- 依存: `task-seed-data-and-utilities-phase1-002.md`
- 検証レベル: L2

4. `task-seed-data-and-utilities-phase2-004.md`
- 目的: Seed 単一トランザクション・失敗時ロールバック・再実行冪等性を確定し、IT-AC11〜IT-AC12 を合格させる。
- 依存: `task-seed-data-and-utilities-phase1-003.md`
- 検証レベル: L2

5. `task-seed-data-and-utilities-phase3-005.md`
- 目的: E2E-01〜E2E-05、統合テスト全件回帰、frontend 品質ゲート、ACトレーサビリティ整理を完了させる。
- 依存: `task-seed-data-and-utilities-phase2-004.md`
- 検証レベル: L3

## 依存関係
- `task-seed-data-and-utilities-phase0-001.md`
  -> `task-seed-data-and-utilities-phase1-002.md`
  -> `task-seed-data-and-utilities-phase1-003.md`
  -> `task-seed-data-and-utilities-phase2-004.md`
  -> `task-seed-data-and-utilities-phase3-005.md`

## 共通実行前提
- 作業ディレクトリはリポジトリルート（`KANJI-EVERYDAY`）。
- Supabase ローカル環境を起動済みで、`supabase db reset` が実行可能であること。
- frontend テストは `npm --prefix frontend run test -- <path>` で対象ファイルを直接指定して実行する。
- Phase 内の受入確認は `seed-data-and-utilities.int.test.ts` の対象 `IT-AC` を優先し、最終 Phase で `seed-data-and-utilities.e2e.test.ts` を実行する。
