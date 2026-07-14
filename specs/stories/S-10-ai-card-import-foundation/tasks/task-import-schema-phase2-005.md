# タスク: import永続schemaとowner制約を実装しPhase 2品質ゲートを通す

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 2（最終タスク）
- 依存: `tasks/task-card-key-migration-phase2-004.md`
- 提供成果物: S-10 tables/constraints/indexes/owner relation、IT-OWNER-01〜03、Phase 2 approved証跡
- 関連AC: AC-01, AC-02, AC-09、IT-OWNER-01〜03
- サイズ: 大きめ（単一migrationのschema区間 + 3 Integration）

## 実装内容

Design 4.2のimport/upload/tag/quota tablesをFK依存順に追加し、単一行CHECK、部分unique、複合owner FK、deck/card owner triggerでservice roleを含むowner不変条件を保証する。正規化値はcaller入力を信用せずDB triggerで再導出する。

## 対象ファイル

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-import-schema-phase2-005.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-OWNER-01〜03`をowner A/B/serviceの実テストへ置換する。
- [ ] cross-owner `card_tags` INSERT/UPDATEと`deck_cards` private差替えが現状成功または未定義で失敗することを確認する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-OWNER-0[1-3]"
```

### 2. Green Phase

- [ ] `ai_import_batches/items/uploads/tags/ai_import_item_tags/card_tags/ai_usage_daily/ai_quota_reservations`をDesignの列、状態CHECK、FK、unique/indexで作る。
- [ ] `(id,owner_user_id)`複合unique/FKでbatch-item、item-upload、item-tag、private card-tag ownerを一致させる。
- [ ] `ai_import_items`のpattern/skill、image/upload、terminal state/timestamp/result整合をCHECKする。
- [ ] `normalize_tag_names`でdisplay nameをNFKC/固定空白処理し、normalized nameをlowercase再導出する。
- [ ] `enforce_deck_card_owner`でpublicまたは同一owner privateだけをINSERT/UPDATE可能にする。

### 3. Refactor / Phase gate

- [ ] Phase 2の`IT-UNIQUE-01〜03`と`IT-OWNER-01〜03`を同じ実DBで回帰する。
- [ ] catalog照会でconstraint/index/FK名、delete action、check predicateをDesignと照合する。
- [ ] task-executorから `/quality-fixer frontend` を呼び、対象Integration、lint、typecheckを修正ループ後に通す。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-UNIQUE|IT-OWNER-0[1-3]"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [ ] Phase 2 DB Integration 6/61件が実テスト化されPASSする。
- [ ] cross-owner card/tag/deck relationをservice roleでも拒否する。
- [ ] status/image/result/timeの不整合rowをCHECK/FKで拒否する。
- [ ] migration全体が単一transactionで適用される。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [ ] Phase 2の動作確認レベルL2を満たし、Phase 3開始条件が成立する。

## 注意事項

- owner RLS policyとRPC EXECUTE grantはPhase 3以降で追加する。
- Storage object操作、Queue、provider処理を追加しない。

