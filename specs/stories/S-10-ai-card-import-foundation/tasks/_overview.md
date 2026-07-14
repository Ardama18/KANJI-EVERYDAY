# S-10 task decomposition overview

## 目的

- Issue #10 の承認済み `plan.md` を、6 Phaseの依存順を保った1コミット粒度へ分解する。
- production実装と対応するUnit/DB Integration TODOの実テスト化を同じタスクでRed-Green-Refactorする。
- Contract E2Eは全production完成後のPhase 6だけで実装し、fresh/upgrade/failure-injectionを独立DB jobとして検証する。

## スコープ境界

- 対象: forward migration、Seed互換、共有TypeScript契約、S-10 tables/RLS/trigger/RPC、生成DB型、Unit 32件、DB Integration 61件、Contract E2E 13件。
- 対象外: Queue、`pgmq`、enqueue、worker、retry orchestration、provider SDK/API、画像生成、Storage object処理、UI、Route Handler、Remote MCP transport、OAuth、secret環境変数配線。
- `reserve_provider_usage`、`commit_import`、`register_ai_upload`、`finalize_import_item`、`mark_import_item_failed`はQueue/provider非依存のDB primitiveとして扱う。
- 既存の `supabase/migrations/20260223000000_s02_schema_rls.sql` と `20260223000001_s02_storage_illustrations.sql` は編集しない。

## 分解方針

- Phase 1=3件、Phase 2=2件、Phase 3=2件、Phase 4=5件、Phase 5=2件、Phase 6=2件、合計16タスク。
- 同一RPCはwrapper/internal/constraint/error分類/該当統合テストまでを1タスクにまとめる。
- 単一forward migrationは依存順に同じファイルを段階更新するが、各タスクを戻せる論理的変更単位に保つ。
- Unit TODOはPhase 1または5、DB Integration TODOはPhase 2〜6で対応productionと同時に解決する。
- `ai-card-import-foundation.e2e.test.ts` の13 TODOはPhase 6より前に変更しない。
- 各Phase最後のタスクは対象回帰後にtask-executorから `/quality-fixer frontend` を呼び、構造化結果 `status=approved` を次Phaseの開始条件とする。

## 確認レベル（代替運用定義）

- L1: lint/typecheckと対象Unitの通過。
- L2: 対象Unit/DB Integrationを実環境で通し、該当ACと副作用0を確認。
- L3: Unit/DB Integration/Contract E2E全件、独立DB 3 job、build、品質ゲート、トレーサビリティを通過。

注記: `task-decomposer` が必須参照する `.claude/steering/architecture/implementation-approach.md` はrepositoryに存在しないため、承認済みDesign v1.1.1と既存storyのL1/L2/L3運用を正本とする。

## タスク一覧

| 順 | ファイル | 目的 | 確認 | 依存 |
|---:|---|---|---|---|
| 1 | `task-test-foundation-normalize-phase1-001.md` | fixture、DB harness、実行script、Unicode正規化 | L2 | なし |
| 2 | `task-key-canonical-phase1-002.md` | card-keyとgeneration/import canonical hash | L1 | 001 |
| 3 | `task-preview-hmac-phase1-003.md` | preview HMACとPhase 1品質ゲート | L2 | 002 |
| 4 | `task-card-key-migration-phase2-004.md` | SQL正規化、backfill、部分unique、Seed互換 | L2 | 003 |
| 5 | `task-import-schema-phase2-005.md` | import schema、owner制約、Phase 2品質ゲート | L2 | 004 |
| 6 | `task-rls-security-phase3-006.md` | RLS/direct-write/EXECUTE/schema ACL | L2 | 005 |
| 7 | `task-session-review-triggers-phase3-007.md` | active guard、review reset、trigger原子性、Phase 3品質ゲート | L2 | 006 |
| 8 | `task-quota-reservation-phase4-008.md` | 安定SQL error helperとJST quota予約 | L2 | 007 |
| 9 | `task-commit-import-phase4-009.md` | 二段階commitと冪等性/Stage 1 DB再検証 | L2 | 008 |
| 10 | `task-upload-finalize-failure-phase4-010.md` | upload/finalize/mark-failed primitive | L2 | 009 |
| 11 | `task-card-management-phase4-011.md` | card/relation管理RPC、編集印、tombstone | L2 | 010 |
| 12 | `task-undo-lock-matrix-phase4-012.md` | undo、全経路lock交差、Phase 4品質ゲート | L2 | 011 |
| 13 | `task-stage1-error-contract-phase5-013.md` | Stage 1 schemaとTypeScript error mapper | L1 | 012 |
| 14 | `task-database-types-phase5-014.md` | Supabase生成型とUnit/Integration回帰、Phase 5品質ゲート | L2 | 013 |
| 15 | `task-migration-jobs-phase6-015.md` | migration 5件と独立DB 3 job/migration E2E | L3 | 014 |
| 16 | `task-contract-e2e-phase6-016.md` | workflow E2E 10件、全品質、traceability | L3 | 015 |

## 依存関係

```text
phase1-001 -> phase1-002 -> phase1-003
  -> phase2-004 -> phase2-005
  -> phase3-006 -> phase3-007
  -> phase4-008 -> phase4-009 -> phase4-010 -> phase4-011 -> phase4-012
  -> phase5-013 -> phase5-014
  -> phase6-015 -> phase6-016
```

Phase内の対象テストと `/quality-fixer frontend` がapprovedになるまで次Phaseへ進まない。

## 共通実行前提

- 作業ディレクトリはrepository root。
- `S10_TEST_DATABASE_URL` はS-10専用DBを明示し、未指定時はfail-fastする。S-02 helperの既定URLへfallbackしない。
- 通常DB Integrationは `npm --prefix frontend run test:s10:integration -- -t "<ID regex>"` で実行する。
- Unitは `npm --prefix frontend run test:s10:unit -- -t "<ID regex>"`、Contract E2EはPhase 6だけで `npm --prefix frontend run test:s10:e2e` を使う。
- DB actorはowner A、owner B、anon、authenticated、service roleを型付きfixtureで切り替える。
- parallel testは全Promiseを回収し、短い`deadlock_timeout`と有限反復を使う。
- error/logにはtoken、request/card本文、SQL、stackを含めない。
- 共通Unicode/canonical fixtureをTypeScriptとSQLから読み、期待値をテスト本文へ重複記述しない。

