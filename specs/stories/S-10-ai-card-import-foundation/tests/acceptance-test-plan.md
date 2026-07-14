# S-10 受入テスト計画（スケルトン）

- Requirements: `requirements.md` v1.1.1
- Design: `design.md` v1.1.1 Approved
- ADR: `ADR-007-ai-card-import-foundation.md` v1.1.1 Accepted
- 対象AC: AC-01〜AC-10（全sub-ACを含む）
- 生成日: 2026-07-14

## テスト分類

| 層 | ファイル | TODO数 | 責務 | 実装タイミング |
|---|---|---:|---|---|
| Unit | `ai-card-import-foundation.test.ts` | 32 | shared schema、Unicode、card-key、generation/import hash、preview HMAC | shared domain実装と同時 |
| DB Integration | `ai-card-import-foundation.int.test.ts` | 62 | 実DB上のRLS、constraint、trigger、RPC、lock、migration断面 | 各migration/RPC実装と同時 |
| Contract E2E | `ai-card-import-foundation.e2e.test.ts` | 13 | adapter相当入力からDB最終状態まで、fresh/upgrade chain | S-10全primitive完成後 |

ブラウザE2Eは生成しない。S-10ではUI、Route Handler、Remote MCP transport、Queue、worker、provider、Storage処理が明示的に対象外である。Contract E2EはQueue/providerを起動せず、`reserve_provider_usage`、`commit_import`、`finalize_import_item`、`mark_import_item_failed`、管理/undo RPCをシステム境界として扱う。

## ケース表

| ケース群 | ID範囲 | 件数 | AC | 主な検証 | 合格基準 | 後続実装依存 |
|---|---|---:|---|---|---|---|
| Schema | UT-SCHEMA-01〜10 | 10 | AC-02, AC-06 | unknown/type guard、R1/W1、1/50/51、ID、tag、deck/image union、trusted field拒否 | field path issue、成功時のみnormalized branded type | `schema.ts`, Han fixture |
| Unicode | UT-NORM-01〜05 | 5 | AC-01〜03 | 固定White_Space、FEFF、NFKC、case、astral/UTF-8 | 共通fixture全vector一致 | `normalize.ts`, `unicode-card-key.json` |
| Card key | UT-CARDKEY-01〜03 | 3 | AC-01〜03 | U+001F material、SHA-256、同値/差分 | lowercase hex期待値一致 | `card-key.ts` |
| Canonical hash | UT-HASH-01〜07 | 7 | AC-04, AC-05 | generation/import分離、key/tag順、ordinal、UUID、optional、owner/key除外 | 同値は同hash、意味差分は別hash | `canonical-request.ts` |
| Preview HMAC | UT-HMAC-01〜07 | 7 | AC-04 | v1/TTL、改ざん、owner/key/hash/secret、期限、constant-time | 不正系全拒否、token本文非露出 | `preview-token.ts` |
| RLS/grants | IT-RLS-01〜07 | 7 | AC-03, AC-09 | actor×table×operation、wrapper/internal grant、owner/source偽装、public immutable | 非owner/anon成功0、内部直実行0 | actor fixture, ACL helpers |
| Unique/owner relation | IT-UNIQUE-01〜03, IT-OWNER-01〜04 | 7 | AC-01, AC-02, AC-09 | partial unique、複合FK、deck/card/tag owner、relation RPC | owner間/Seed-private許可、owner内/cross-owner拒否 | constraint/index/trigger |
| Commit/Stage 1 | IT-COMMIT-01〜09 | 9 | AC-02, AC-04, AC-06 | 二段階境界、全table rollback、並行冪等、hash/reservation、deck/upload/tag | batch 1件、別hash conflict、失敗差分0、commit時card 0 | commit wrapper/internal, snapshot helper |
| Quota | IT-QUOTA-01〜08 | 8 | AC-05 | JST境界、199/200、49/50、並行、再送、exempt、provider開始、lock順 | card<=200、image<=50、二重消費0 | fixed DB clock, parallel clients |
| Upload/finalize/fail | IT-UPLOAD-01〜03, IT-FINALIZE-01〜05, IT-FAIL-01〜02 | 10 | AC-01, AC-02, AC-06 | upload metadata/state、finalize原子/並行/重複/failpoint、failure冪等 | 部分永続化0、terminal stateとbatch集計一致 | upload/storage metadata fixture, failpoints |
| Guard/review/undo | IT-GUARD-01〜04, IT-REVIEW-01〜03, IT-UNDO-01〜04 | 11 | AC-07, AC-08 | current+4 queues、無効JSON、RPC/direct、review reset/keep、tombstone、undo | active時変更0、本文だけreset、undo冪等/原子 | session fixture, management RPC |
| Lock/security/migration | IT-LOCK-01, IT-SECURITY-01〜03, IT-MIGRATION-01〜05 | 9 | AC-03, AC-09, AC-10 | lock交差、DEFINER/schema ACL、fresh/upgrade/key/seed/failure injection | deadlock 0、権限迂回0、snapshot差分0 | parallel/failpoint harness, isolated DB |
| Contract workflow | E2E-CONTRACT-01〜10 | 10 | AC-01〜09 | app/MCP/upload、再送、race、quota、study、undo、lock交差 | 端点ごとの最終DB状態が契約一致 | 全shared contract + 全DB primitive |
| Migration workflow | E2E-MIGRATION-01〜03 | 3 | AC-10 | fresh、upgrade、区間別failure injection | 両経路AC smoke成功、失敗時完全rollback | isolated fresh/upgrade DB jobs |

## 実装順序と依存関係

1. `fixtures/unicode-card-key.json`、canonical request fixture、frozen pre-S10 seedを作成する。
2. Unit TODOをshared domainのRedテストへ置換する。
3. S-02 DB testkitを拡張し、actor、snapshot、fixed clock、複数connection、failpoint helperを追加する。
4. DB Integration TODOをmigration/RPC実装順に置換する。各ケースは独立transactionまたは独立DBを使う。
5. freshとupgradeを別jobに分離し、同じAC-01〜09 smoke suiteを両経路から呼ぶ。
6. 最後にContract E2E TODOを完成させる。外部Queue/provider/Storage処理は導入しない。

## 共通TODO・品質ゲート

- [x] 各TODOに実装moduleまたはmigrationのimport/setupを追加する。
- [x] `any`を使わず、DB result・actor・RPC errorを型付けする。
- [x] 非同期処理を`async/await`で完了させ、parallel caseは全Promiseを回収する。
- [x] 各DB caseの前後snapshotを取り、エラーcodeだけでなく副作用0を確認する。
- [x] quota/expiry/JST caseは公開RPCと分離されたtest-only clockを使う。
- [x] deadlock caseは非特権actorでも設定可能な短い`lock_timeout`と有限反復回数を使い、失敗時にlock経路を識別できるようにする。
- [x] error/log assertionでtoken、request/card本文、SQL/stackが露出しないことを確認する。
- [x] Unit、DB Integration、Contract E2Eを独立して実行できるscript/jobを用意する。

## Open questions

実装を止めるopen questionはない。Design v1.1.1で固定されたupload 10 MiB/MIME allow list、idempotency key 128文字、`processing`状態、ICU `und` collationをfixtureへ転記するときは、値をtest内へ散在させず共通fixture/constantに集約する。
