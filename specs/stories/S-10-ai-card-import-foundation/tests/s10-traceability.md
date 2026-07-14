# S-10 AIカード登録基盤 受入追跡表

更新日: 2026-07-14
対象: Issue #10 / requirements v1.1.1 / design v1.1.1 / ADR-007

## 正本と実装境界

- 要求正本: `../requirements.md` の AC-01〜10（全 sub-AC を含む）
- 設計正本: `../design.md` の Stage 1、canonical hash、preview HMAC、DB primitive、lock matrix、migration strategy
- 判断記録: `../../../adr/ADR-007-ai-card-import-foundation.md`
- production: `frontend/src/lib/ai-import/{normalize,card-key,canonical-request,preview-token,schema}.ts`、`supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`、`frontend/src/types/database.ts`
- test boundary: provider、Queue、Storage API、UI、Route Handler、Remote MCP transportは起動しない。保存済みupload/illustration fixtureとDB primitiveを境界にする。

## AC / sub-AC 追跡

| AC / sub-AC | requirements / design / ADR | production path | Unit / Integration | Contract E2E |
|---|---|---|---|---|
| AC-01, 01a, 01b 異owner・owner relation・公開Seed同値 | requirements AC-01、design §4/§8/AC表、ADR-007 owner-scoped private key | `schema.ts`、`ai_compute_card_key`、private partial unique、owner複合FK/trigger、`commit_import`、`finalize_import_item` | UT-SCHEMA-04〜07、UT-CARDKEY-01〜03、IT-UNIQUE-01〜03、IT-OWNER-01〜03、IT-FINALIZE-01 | E2E-CONTRACT-01, 02 |
| AC-02, 02a, 02b, 02c request/既存/race重複 | requirements AC-02、design Stage 1/card-key lock、ADR-007 two-stage import | `validateImportRequest`、`commit_import_internal`、`finalize_import_item_internal`、`cards_private_owner_card_key_uidx` | UT-SCHEMA-06、IT-COMMIT-02/07、IT-UNIQUE-03、IT-FINALIZE-04/05 | E2E-CONTRACT-06 |
| AC-03, 03a, 03b, 03c, 03d Seed不変・backfill・再seed・immutable | requirements AC-03、design migration/Seed、ADR-007 forward migration | S-10 migration normalization/backfill/partial index/public guard、`supabase/seed.sql` | IT-RLS-07、IT-MIGRATION-01〜05 | E2E-CONTRACT-02、E2E-MIGRATION-01〜03 |
| AC-04, 04a, 04b, 04c preview・冪等commit | requirements AC-04、design canonical/HMAC/idempotency lock、ADR-007 signed preview | `canonical-request.ts`、`preview-token.ts`、`commit_import_internal` | UT-HASH-01〜07、UT-HMAC-01〜07、IT-COMMIT-03/04/06 | E2E-CONTRACT-03, 10 |
| AC-05, 05a, 05b, 05c JST quota・免除・再送・非返却 | requirements AC-05、design quota reservation/JST clock、ADR-007 trusted source policy | `reserve_provider_usage(_internal)`、`ai_usage_daily`、`ai_quota_reservations` | IT-QUOTA-01〜08、IT-UPLOAD-01〜03、IT-FAIL-01/02 | E2E-CONTRACT-03, 04, 05, 07 |
| AC-06, 06a, 06b, 06c Stage 1 rollback・commit/finalize atomicity | requirements AC-06、design two-stage transaction/failpoints、ADR-007 atomic primitives | `schema.ts`、`commit_import_internal`、`finalize_import_item_internal`、transaction failpoints | UT-SCHEMA-01〜10、IT-COMMIT-01/02/06〜09、IT-FINALIZE-01/03/05 | E2E-CONTRACT-01, 03, 05, 06 |
| AC-07, 07a, 07b, 07c active session・undo | requirements AC-07、design symmetric guard/undo lock、ADR-007 management boundary | `ai_assert_card_inactive`、card guard triggers、`undo_import`、delete tombstone | IT-GUARD-01〜04、IT-UNDO-01〜04 | E2E-CONTRACT-08, 09, 10 |
| AC-08, 08a, 08b review reset/keep | requirements AC-08、design content-change trigger、ADR-007 parent/teacher management | review reset trigger、`update_imported_card`、`set_card_{decks,tags,illustration}` | IT-REVIEW-01〜03、IT-OWNER-04 | E2E-CONTRACT-08, 10 |
| AC-09, 09a, 09b, 09c RLS・所有者整合 | requirements AC-09、design RLS matrix/owner trigger/ACL、ADR-007 trusted adapter | table RLS、card_tags/deck_cards owner trigger、service wrapper/internal ACL | IT-RLS-01〜07、IT-OWNER-01〜04、IT-SECURITY-01〜03 | E2E-CONTRACT-01, 05, 08, 10 |
| AC-10, 10a, 10b fresh/upgrade/rollback | requirements AC-10、design transactional migration、ADR-007 forward-only rollout | 全migration chain、S-10 forward migration、seed、failure-injection harness | IT-MIGRATION-01〜05 | E2E-MIGRATION-01〜03 |

## Contract E2E の最終副作用観測

`helpers/s10-contract-workflow.ts` は、productionのpure schema検証 → canonical generation/import SHA-256 → preview HMAC署名/検証 → public quota予約 → `commit_import` → image予約/保存済みfixture → `finalize_import_item` → DB readbackを共有する。固定clockが必要なJST日付境界のみtest-only internal wrapperを直接呼び、その他はpublic wrapperとproductionの正規化/HMAC実装を通す。各workflowはbatch/item/card/deck_cards/item_tags/card_tags/quota/usage/uploadをbatch単位でsnapshotし、owner境界、再送、並行、失敗時の非増分を検証する。cleanupはmarkerに紐づく予約分だけをusageから差し引き、他workflowのowner usageを削除せず、反復しても同じ最終状態になる。待機用sleepは使用せず、各RPCのtransaction完了と複数connectionのPromise完了を同期点にする。

| E2E ID | workflow | 主な最終assert |
|---|---|---|
| E2E-CONTRACT-01 | owner A/B同内容 | owner別card/deck relation、owner/other owner/anonのRLS可視性 |
| E2E-CONTRACT-02 | 公開Seed同値private | private key一致、全public Seedの全カラムsnapshot/key snapshot差分0 |
| E2E-CONTRACT-03 | app_ai並行commit/finalize再送 | HMAC改ざん拒否、hash/reservation不整合の全副作用0、batch/item/card/reservation/usage単一化、hash連結一致 |
| E2E-CONTRACT-04 | remote_mcp | exempt units 0、card usage 0 |
| E2E-CONTRACT-05 | upload | upload consumed、upload/illustration/storage owner一致、other owner RLS 0、image usage 0 |
| E2E-CONTRACT-06 | finalize直前duplicate | item failed・batch completed/failedCount 1、DUPLICATE_EXISTING、追加card/deck_card/card_tag 0 |
| E2E-CONTRACT-07 | JST境界・並行上限 | run専用日付のcard 200/image 50、同一key再送不増、超過だけP1005 |
| E2E-CONTRACT-08 | active session・編集 | 直接UPDATE/DELETE、管理・全relation RPC、undoのP1006と全snapshot不変、実tag変更でreview keep、本文でreset |
| E2E-CONTRACT-09 | tombstone・undo再送 | delete skip 1、card delete 1、auto deck/FK削除、予約維持、再undo同結果、cleanup 2回後残留0 |
| E2E-CONTRACT-10 | lock交差 | lock/deadlock timeout付きcommit/finalize/active guard並行のdeadlock 0、batch集計・card/item/全relationの最終不変条件 |

## 実行コマンドと結果

| Gate | command | 2026-07-14 result |
|---|---|---|
| Red | `npm --prefix frontend run typecheck`（E2E置換直後） | FAIL: `helpers/s10-contract-workflow` 未実装 |
| Unit | `npm --prefix frontend run test:s10:unit` | 32/32 PASS |
| DB Integration | `S10_TEST_DATABASE_URL=... npm --prefix frontend run test:s10:integration` + 独立3 job | 62/62 PASS（通常57 + job 5） |
| Contract E2E | `S10_TEST_DATABASE_URL=... npm --prefix frontend run test:s10:e2e` + 独立3 job | 13/13 PASS（通常10 + job 3） |
| Fresh | `npm --prefix frontend run test:s10:fresh` | PASS（Integration 58/58、Contract E2E 11/11） |
| Upgrade | `npm --prefix frontend run test:s10:upgrade` | PASS（Integration 3、migration E2E 1） |
| Failure injection | `npm --prefix frontend run test:s10:failure` | PASS（Integration 1、migration E2E 1） |
| Existing tests | `S10_TEST_DATABASE_URL=... npm --prefix frontend run test -- --maxWorkers=1 --minWorkers=1` | inventory 446（47 files）、通常438/438 PASS、独立job条件付き8 skip（独立jobで8/8 PASS） |
| Static / build | `npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build` | PASS |
| TODO inventory | `rg -n "it\\.todo|test\\.todo" specs/stories/S-10-ai-card-import-foundation/tests/*.ts` | 0件 |

独立migration 3 jobの詳細なDB名分離、snapshot、再計算、rollback結果は `../tasks/task-migration-jobs-phase6-015.md` を正本とする。上表の最終結果はTask016完了時の再実行結果で更新する。
