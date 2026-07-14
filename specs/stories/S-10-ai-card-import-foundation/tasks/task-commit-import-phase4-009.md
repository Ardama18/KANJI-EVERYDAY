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

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/fixtures/canonical-requests.json`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-COMMIT-01〜09`をsnapshot/parallel/failpoint実テストへ置換する。
- [x] 正常差分、全validation失敗、同key並行、別hash/source/reservation、generation/import分離、deck/upload/tagを個別assertする。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-COMMIT"
```

### 2. Green Phase

- [x] wrapperで引数shape/sourceを検証し、internalでJSONを必要列へ展開して未知field/型/件数を再検証する。
- [x] duplicate候補card row→owner/card-key/idempotency advisory→batch/reservation→deck/upload→tags/itemsのlock順を守る。
- [x] 同owner/key/hash/source/reservation再送は同じbatchを返し副作用0、いずれか差分は`CONFLICT`とする。
- [x] DB再計算import hash、request内/既存duplicate、deck ID/name/create、ready upload、card reservationをlock後再照合する。
- [x] tag displayだけをupsertしDB triggerでnormalized nameを強制し、batch/items/item_tagsをordinal順insertする。
- [x] 途中例外では自動作成deckを含め全変更をrollbackする。

### 3. Refactor Phase

- [x] batch/item/tag/RPC resultを安定named shapeまたはsafe JSONに限定し、内部rowを返さない。
- [x] snapshot helperでdeck/card/batch/item/tag/card_tags/usage/reservation全差分0を共通assertする。

## 完了条件

- [x] `IT-COMMIT-01〜09`が実DBでPASSする。
- [x] 同時commitでbatch 1件、全caller同一batch ID、item/tag/usage増分1回以下である。
- [x] 正常commit後もcard/deck_cards/card_tagsが0件である。
- [x] generation hashとimport hashの不一致を許容し、reservation keyでworkflowを関連付ける。
- [x] request/card/token/SQL/stackをerror/logへ露出しない。
- [x] 動作確認レベルL2を満たす。

## 注意事項

- preview HMAC検証はtrusted adapterの前段契約であり、このDB wrapperはHMAC secretを受け取らない。
- finalize/worker/provider/Queueを実装しない。

## Rework証跡（2026-07-14）

- 手動reviewで検出されたlock順違反を修正し、card reservationの`SELECT ... FOR UPDATE`と整合検証をdeck解決・upload lockより前へ移動した。
- `pg_get_functiondef`を用いるIT-COMMIT-08の構造assertで、existing batch→reservation→deck→uploadの取得順を恒久化した。
- IT-COMMIT 9件＋IT-QUOTA 8件の交差回帰17/17、S-10全体39件、fresh migration＋Seed（`ON_ERROR_STOP=1`）、frontend unit 155件、lint、typecheck、diff checkがすべて成功した。
