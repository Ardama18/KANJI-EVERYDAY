# タスク: Seed固定データソースとowner/deck/cards投入を実装する

メタ情報:
- ストーリー: S-04-seed-data-and-utilities
- フェーズ: 1
- 依存: `specs/stories/S-04-seed-data-and-utilities/tasks/task-seed-data-and-utilities-phase0-001.md`
- 提供成果物:
  - `supabase/seed.sql`（新規、50字ソース + owner/profile/deck/cards 実装）
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（IT-AC07〜IT-AC09 実装）
- 関連AC: AC-07, AC-08, AC-09
- サイズ: 大きめ（11-15ファイル）

## 実装内容
`supabase/seed.sql` を新規作成し、`SEED_OWNER_USER_ID` と `SEED_DECK_ID` を固定した upsert 戦略を実装する。50字ソース（`kanji/vocab/reading`）から R1/W1 の 100 cards を生成し、`visibility='public'`、`owner_user_id IS NULL`、`card_key='{pattern}:{front_text}:{back_text}'` 契約を満たす。`auth.users` と `users_profile`、固定 deck 行の upsert までを本タスクで完了する。

## 対象ファイル
- [x] `supabase/seed.sql`（新規）
- [x] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`

## テスト観点
- Integration:
  - `IT-AC07`: cards 100件（50字 x R1/W1）
  - `IT-AC08`: Seed cards の属性契約（public/null/card_key）
  - `IT-AC09`: owner/profile/deck upsert と固定 deck 1件維持

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `seed-data-and-utilities.int.test.ts` の `IT-AC07`〜`IT-AC09` を `it.todo` から失敗テストへ切り替える。
- [x] `specs/stories/S-02-database-schema-rls/tests/helpers/s02-db-testkit.ts` の `auth.users` 必須列セットを確認する。
- [x] Seed 未実装状態で失敗を確認し、必要な SQL 契約（fixed UUID、必須列、カード件数）を確定する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09"
```

### 2. Green Phase
- [x] `supabase/seed.sql` に 50字ソース定義を実装し、各行から R1/W1 cards を生成する。
- [x] `auth.users` を必須列セットで `ON CONFLICT (id)` upsert し、`users_profile` を同期 upsert する。
- [x] `decks` を `SEED_DECK_ID` 固定で upsert し、`name='小学3年生の漢字'` と `new_limit_per_day=10` を保証する。
- [ ] `IT-AC07`〜`IT-AC09` が pass するまで SQL とテストを調整する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09"
```

### 3. Refactor Phase
- [x] Seed SQL の CTE 構成を整理し、cards 生成と owner/deck upsert の責務を明確化する。
- [x] `card_key` 生成式を一箇所に固定し、契約逸脱を防ぐ。
- [ ] Phase 1 前半対象テストを再実行して回帰なしを確認する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09"
```

## 完了条件
- [x] `supabase/seed.sql` に固定 UUID の owner/profile/deck upsert が実装されている（AC-09）。
- [x] Seed 実行後に cards が 100件で、R1/W1 と card_key 契約を満たす（AC-07, AC-08）。
- [ ] `IT-AC07`〜`IT-AC09` が pass している。
- [ ] 動作確認レベル L2（対象 Integration）が満たされている。

## 動作確認
- [ ] `supabase db reset`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09"`
- [x] `git diff --name-only`
