# タスク: card・relation管理RPCと編集/tombstone契約を実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 4
- 依存: `tasks/task-upload-finalize-failure-phase4-010.md`
- 提供成果物: update/delete/deck/tag/illustration管理RPC、編集印、削除tombstone、Integration 3件
- 関連AC: AC-07〜09、IT-OWNER-04、IT-REVIEW-02、IT-UNDO-02
- サイズ: 大きめ（管理ユースケース一式）

## 実装内容

authenticated owner向けにcard更新/削除とdeck/tag/illustration relation置換を正規経路として実装する。card rowを起点にowner、optimistic timestamp、active guard、relation ownerを再検証し、本文/関連編集印と個別削除tombstoneを原子的に記録する。

## 対象ファイル

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`（既存actor/context/diagnostic helperを再利用し、変更不要を確認）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-OWNER-04`、`IT-REVIEW-02`、`IT-UNDO-02`を実DBテストへ置換する。
- [x] authenticated直接relation write拒否、管理RPC owner境界、relation-only review keep、個別削除tombstoneを検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-OWNER-04|IT-REVIEW-02|IT-UNDO-02"
```

### 2. Green Phase

- [x] `update_imported_card`でowner/expected_updated_at/active guardを検証し、content変更はkey再計算 + review reset + `user_edited_at`を同transactionにする。
- [x] `delete_private_card`と直接DELETEでfinalized itemをdeleted/result NULL/deleted_card_id/deleted_atへtombstone化し、編集印は立てない。
- [x] `set_card_decks/tags/illustration`はcard row→card advisory→対象UUID昇順でlockし、owner invariantを再検証する。
- [x] relation変更はreview_statesを維持するがimport itemの`user_edited_at`を設定する。
- [x] internal flagなしの直接illustration key変更とrelation writeを拒否する。

### 3. Refactor Phase

- [x] owner不一致を存在秘匿し、expected timestamp競合を`CONFLICT`、activeを`ACTIVE_SESSION`へ安定分類する。
- [x] tombstone/edit marker triggerは外部EXECUTE不可、失敗statementで部分記録0にする。

## 完了条件

- [x] 対象3件が実DBでPASSする。
- [x] authenticated relation直接write成功0、owner管理RPC成功、既存SELECT互換を維持する。
- [x] illustration/tag/deckだけの変更でreview snapshot差分0、編集印は設定される。
- [x] 個別削除後にresult FKがNULLでもdeleted card ID/由来を保持する。
- [x] content更新/削除/関係変更のactive guardがPhase 3契約を維持する。
- [x] 動作確認レベルL2を満たす。

## 注意事項

- undo本体とauto deck削除は次タスクで実装する。
- UI/管理画面/Route Handlerは作らない。

## 完了証跡（2026-07-14）

- Red: 対象3件を実DB化し3/3 FAILを確認。未実装RPCに加え、authenticatedの直接`illustration_key`更新が成功する境界不備を再現した。
- Green: authenticated wrapper 5種と非公開internal、content/relation編集印、illustration直書きguard、個別削除tombstone、card-tag owner triggerを実装した。
- management illustration更新はbackend/transaction単位の短寿命contextをRPC内で削除し、同transaction後続の直接更新へinternal権限が漏れないことを検証した。
- `pg_get_functiondef`でcard row→card advisory→item marker→target UUID lock順、catalogでwrapper/internal ACL、owner/search_pathを固定した。
- 対象3/3、Phase 4交差30/30、S-10全体52 PASS/9 TODO、fresh migration＋Seed、frontend unit、lint、typecheck、diff checkを完了した。

## 差し戻し対応証跡（2026-07-14）

- `update_imported_card_internal`はpatch適用後のfront/backを`ai_normalize_display_text`で正規化し、両面1..200文字、R1 front/W1 backのHan必須をStage 1と同じregexで再検証する。
- IT-OWNER-04でUnicode空白が`漢 字`へ正規化されcard keyが再計算されること、空白のみ・201文字・R1漢字なし・W1漢字なしを`P1000`で原子的に拒否することを追加した。
- validation失敗前後のcontent/key/updated_at/edit marker snapshot一致、正常更新時のreview reset/edit marker、stale expected timestamp、active guardを再確認した。
- fresh migration＋Seed、Task011 3/3、Phase 4交差30/30、S-10全体52 PASS/9 TODO、ACL/catalog、frontend unit、lint、typecheck、diff checkを再実行した。
