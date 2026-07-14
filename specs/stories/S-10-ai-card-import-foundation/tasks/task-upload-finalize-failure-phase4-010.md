# タスク: upload登録・finalize・failure primitiveを実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 4
- 依存: `tasks/task-commit-import-phase4-009.md`
- 提供成果物: `register_ai_upload`、`finalize_import_item`、`mark_import_item_failed`、Integration 10件
- 関連AC: AC-01, AC-02, AC-06, AC-09、IT-UPLOAD-01〜03、IT-FINALIZE-01〜05、IT-FAIL-01〜02
- サイズ: 大きめ（3つのworker境界、上限900行。超過見込みならuploadを先行コミットへ分離）

## 実装内容

Queue/provider/Storage処理を起動せず、trusted adapter/workerが呼ぶ3つのservice-role DB primitiveを完成させる。upload metadata登録を冪等化し、commit済みitemからcard/relation/upload consume/resultをitem単位で原子確定し、安全なterminal failureとbatch集計を実装する。

## 対象ファイル

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-UPLOAD-01〜03`、`IT-FINALIZE-01〜05`、`IT-FAIL-01〜02`を実テストへ置換する。
- [x] metadata境界、owner/state、再送/並行、commit後duplicate、区間failpoint、safe error allow-listをassertする。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-UPLOAD|IT-FINALIZE|IT-FAIL"
```

### 2. Green Phase

- [x] uploadはowner/key advisory後、同metadata ready再送を同じrow、差分/consumed/deleted再利用を`CONFLICT`にする。
- [x] path prefix、object owner/存在をtrusted metadata fixtureで確認し、MIME PNG/JPEG/WebP、1..10MiBを強制する。Storage APIは呼ばない。
- [x] finalizeは既存result card→owner/card-key advisory→illustration→batch/item→deck/upload→reservation→relation順でlock後再検証する。
- [x] finalized再送は同じcard ID、terminal不整合は`CONFLICT`、owner重複はitemだけを`failed/DUPLICATE_EXISTING`へ確定する。
- [x] card/deck_card/card_tags/item result/upload consumeを1 transactionにし、named uniqueだけをduplicate分類する。
- [x] mark-failedはallow-list code/safe detail/attempt keyを検証し、同attempt再送を冪等、別attempt/terminalを`CONFLICT`にする。

### 3. Refactor Phase

- [x] batch terminal counts/status/completed_atの再計算をfinalize/failで共有し、partial side effectをsnapshotで検出する。
- [x] provider本文/stack/Storage metadata/SQLを保存または返却しない。

## 完了条件

- [x] 対象10件が実DBでPASSする。
- [x] finalize再送/並行の全副作用が1回分以下である。
- [x] duplicate/failpoint時にcardだけ、relationだけ、upload consumeだけが残る事象が0件である。
- [x] upload画像は画像quotaを消費せず、consumedはfinalize成功時1回だけである。
- [x] batch/item terminal stateと集計が一致する。
- [x] 動作確認レベルL2を満たす。

## 注意事項

- provider出力でfront/back/card_keyを書き換えずcommit済みitemを正本にする。
- Queue ack/retry、provider/Storage object処理はIssue #12へ残す。

## 先行分割証跡（2026-07-14）

- 3 RPC・Integration 10件の一括差分が900行を超える見込みのため、明示された分割条件に従いupload境界を先行成果とした。
- IT-UPLOAD-01〜03を実DB化し、並行同key、metadata差分、Storage owner/存在、MIME/size/path境界、terminal再利用、ACLを検証した。
- finalize/failure境界とTask全体の完了条件は後続成果へ残す。

## 後半完了証跡（2026-07-14）

- IT-FINALIZE-01〜05とIT-FAIL-01〜02を実DB化し、7件のmissing RPC RedからGreenへ移行した。
- `pg_get_functiondef`構造assertでadvisory→illustration→batch→item→deck→upload→reservation→relation順を固定した。
- Task010全10件、Phase 4交差27件、S-10全体49件、fresh migration＋Seed、frontend unit 155件、lint、typecheck、diff checkを完了した。

## 後半差し戻し対応証跡（2026-07-14）

- finalized再送のmutableな`cards.illustration_key`事前readを廃止し、Design lock matrixどおり既存result cardを`FOR UPDATE`してからcard-key advisoryを取得した。item lock後に`locked_item.result_card_id`を再検証し、ロック済みcardからactual keyを再取得する。
- IT-FINALIZE-01の`pg_get_functiondef`構造assertでresult card row（1524）→advisory（1862）→illustration（2267）→batch（2537）→item（2792）→actual key read（3386）→deck（3771）の順を固定した。Task011管理RPC予定のcard row→card advisory→item markerと同順で、逆順待ちを追加していない。
- IT-FINALIZE-03へ、別transactionがresult cardのillustrationを変更中に旧illustrationでfinalized再送する交差試験を追加した。再送はcard row解放後のactual keyを読み、`P1008 CONFLICT`となる。
- fresh migration＋Seed、Task010 10/10、Phase 4交差27/27、S-10全体49 PASS/12 TODO、frontend unit 155/155、lint、typecheck、diff checkを再実行した。
- ACL/definerを再確認し、public wrapperは`authenticated=false/service_role=true`、internal/recountは両roleともfalse、owner=`s10_migration_owner`、`search_path=pg_catalog, pg_temp`を維持した。
