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

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-OWNER-04`、`IT-REVIEW-02`、`IT-UNDO-02`を実DBテストへ置換する。
- [ ] authenticated直接relation write拒否、管理RPC owner境界、relation-only review keep、個別削除tombstoneを検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-OWNER-04|IT-REVIEW-02|IT-UNDO-02"
```

### 2. Green Phase

- [ ] `update_imported_card`でowner/expected_updated_at/active guardを検証し、content変更はkey再計算 + review reset + `user_edited_at`を同transactionにする。
- [ ] `delete_private_card`と直接DELETEでfinalized itemをdeleted/result NULL/deleted_card_id/deleted_atへtombstone化し、編集印は立てない。
- [ ] `set_card_decks/tags/illustration`はcard row→card advisory→対象UUID昇順でlockし、owner invariantを再検証する。
- [ ] relation変更はreview_statesを維持するがimport itemの`user_edited_at`を設定する。
- [ ] internal flagなしの直接illustration key変更とrelation writeを拒否する。

### 3. Refactor Phase

- [ ] owner不一致を存在秘匿し、expected timestamp競合を`CONFLICT`、activeを`ACTIVE_SESSION`へ安定分類する。
- [ ] tombstone/edit marker triggerは外部EXECUTE不可、失敗statementで部分記録0にする。

## 完了条件

- [ ] 対象3件が実DBでPASSする。
- [ ] authenticated relation直接write成功0、owner管理RPC成功、既存SELECT互換を維持する。
- [ ] illustration/tag/deckだけの変更でreview snapshot差分0、編集印は設定される。
- [ ] 個別削除後にresult FKがNULLでもdeleted card ID/由来を保持する。
- [ ] content更新/削除/関係変更のactive guardがPhase 3契約を維持する。
- [ ] 動作確認レベルL2を満たす。

## 注意事項

- undo本体とauto deck削除は次タスクで実装する。
- UI/管理画面/Route Handlerは作らない。

