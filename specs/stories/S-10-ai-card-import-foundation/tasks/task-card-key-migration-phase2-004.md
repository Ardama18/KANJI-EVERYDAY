# タスク: card-key forward migrationとSeed互換を実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 2
- 依存: `tasks/task-preview-hmac-phase1-003.md`（Phase 1 quality approved）
- 提供成果物: S-10単一forward migrationの正規化/backfill/部分unique区間、更新Seed、IT-UNIQUE 3件
- 関連AC: AC-01〜03、IT-UNIQUE-01〜03
- サイズ: 大きめ（migration/Seed/fixture/Integration test）

## 実装内容

既存migrationを編集せず、`20260714000000_s10_ai_card_import_foundation.sql`を単一transactional forward migrationとして追加する。ICU `und`、SQL正規化/key関数、fixture self-check、衝突検査、SHA-256 backfill、旧global uniqueの部分unique化を依存順に実装し、repo Seedだけを別transaction前提でforward互換化する。

## 対象ファイル

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `supabase/seed.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/fixtures/unicode-card-key.json`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-UNIQUE-01〜03`を実DBの失敗テストへ置換する。
- [x] pre-S10 Seed上で旧global unique、新key未backfill、SQL fixture不一致を観測する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-UNIQUE"
```

### 2. Green Phase

- [x] ICU/NFKC/lowercaseが利用不能なら先頭self-checkでfail-fastする安定名のimmutable helperを作る。
- [x] 全既存cardの新keyを一時領域へ計算し、public key/private owner-key衝突を旧unique drop前に検査する。
- [x] `cards.updated_at`、owner/visibility check、64文字lowercase hex check、`cards_id_owner_uq`を追加する。
- [x] `cards_public_card_key_uidx`と`cards_private_owner_card_key_uidx`を作り、caller提供keyはtriggerで再計算する。
- [x] `seed.sql`を`ai_compute_card_key`と`ON CONFLICT (card_key) WHERE visibility = 'public' DO NOTHING`へ変更し、ID/本文/skill/pattern/deck関連/件数を変えない。

### 3. Refactor Phase

- [x] function/constraint/indexへDesign記載の安定名を付け、named `23505`だけを`DUPLICATE_EXISTING`対象として識別可能にする。
- [x] migration transactionへrepo Seed実行を混在させず、区間failpointを後続jobから注入可能にする。

## 完了条件

- [x] `IT-UNIQUE-01〜03`がPASSする。
- [x] owner A/Bの同keyと公開Seed同値privateを許可し、同一owner private重複だけを拒否する。
- [x] 衝突またはself-check失敗でschema/key/constraintが適用前へ全rollbackする。
- [x] Seed再実行で公開card/deck/relation件数が変わらない。
- [x] 既存S-02 migration 2ファイルに差分がない。
- [x] 動作確認レベルL2を満たす。

## 注意事項

- 恣意的な既存cardのmerge/deleteやdown migrationを実装しない。
- RLS/RPC/Contract E2Eは後続タスクへ残す。
