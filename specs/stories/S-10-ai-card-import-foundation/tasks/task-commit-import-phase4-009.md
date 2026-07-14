# タスク: commit_importとStage 1 DB再検証を実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 4
- 依存: `tasks/task-quota-reservation-phase4-008.md`
- 提供成果物: `commit_import` wrapper/internal、IT-COMMIT 9件
- 関連AC: AC-02, AC-04, AC-06、IT-COMMIT-01〜09
- サイズ: 大きめ（transactional vertical slice）

## 実装内容

service_role専用trusted wrapperと非公開internal primitiveを実装する。owner/idempotency/card-key lock後にrequest hash、set validation、duplicate、deck/upload、reservation、tagを再検証し、batch/items/tags/item_tags/reservation linkだけを1 transactionで確定する。card/deck_cards/card_tagsとusage加算は行わない。

## 対象ファイル

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/fixtures/canonical-requests.json`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-COMMIT-01〜09`をsnapshot/parallel/failpoint実テストへ置換する。
- [ ] 正常差分、全validation失敗、同key並行、別hash/source/reservation、generation/import分離、deck/upload/tagを個別assertする。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-COMMIT"
```

### 2. Green Phase

- [ ] wrapperで引数shape/sourceを検証し、internalでJSONを必要列へ展開して未知field/型/件数を再検証する。
- [ ] duplicate候補card row→owner/card-key/idempotency advisory→batch/reservation→deck/upload→tags/itemsのlock順を守る。
- [ ] 同owner/key/hash/source/reservation再送は同じbatchを返し副作用0、いずれか差分は`CONFLICT`とする。
- [ ] DB再計算import hash、request内/既存duplicate、deck ID/name/create、ready upload、card reservationをlock後再照合する。
- [ ] tag displayだけをupsertしDB triggerでnormalized nameを強制し、batch/items/item_tagsをordinal順insertする。
- [ ] 途中例外では自動作成deckを含め全変更をrollbackする。

### 3. Refactor Phase

- [ ] batch/item/tag/RPC resultを安定named shapeまたはsafe JSONに限定し、内部rowを返さない。
- [ ] snapshot helperでdeck/card/batch/item/tag/card_tags/usage/reservation全差分0を共通assertする。

## 完了条件

- [ ] `IT-COMMIT-01〜09`が実DBでPASSする。
- [ ] 同時commitでbatch 1件、全caller同一batch ID、item/tag/usage増分1回以下である。
- [ ] 正常commit後もcard/deck_cards/card_tagsが0件である。
- [ ] generation hashとimport hashの不一致を許容し、reservation keyでworkflowを関連付ける。
- [ ] request/card/token/SQL/stackをerror/logへ露出しない。
- [ ] 動作確認レベルL2を満たす。

## 注意事項

- preview HMAC検証はtrusted adapterの前段契約であり、このDB wrapperはHMAC secretを受け取らない。
- finalize/worker/provider/Queueを実装しない。

