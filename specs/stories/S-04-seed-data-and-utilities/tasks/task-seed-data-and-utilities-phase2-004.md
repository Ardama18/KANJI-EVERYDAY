# タスク: Seed冪等性と失敗時ロールバック保証を確定する

メタ情報:
- ストーリー: S-04-seed-data-and-utilities
- フェーズ: 2
- 依存: `specs/stories/S-04-seed-data-and-utilities/tasks/task-seed-data-and-utilities-phase1-003.md`
- 提供成果物:
  - `supabase/seed.sql`（BEGIN/COMMIT/ROLLBACK + conflict 戦略完成）
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（IT-AC11〜IT-AC12 実装）
- 関連AC: AC-11, AC-12
- サイズ: 標準（4-10ファイル）

## 実装内容
`supabase/seed.sql` の DML を単一トランザクションで実行し、途中失敗時に全ロールバックされることを保証する。`cards/decks/deck_cards` の conflict 戦略を最終確定して Seed 再実行時の件数不増を成立させる。`IT-AC11`〜`IT-AC12` を実装し、Phase 2 で回帰確認まで完了する。

## 対象ファイル
- [ ] `supabase/seed.sql`
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`

## テスト観点
- Integration:
  - `IT-AC11`: Seed 2回実行後の `cards/decks/deck_cards` 件数差分が 0
  - `IT-AC12`: migration不足/途中失敗時に明示的エラー + 全ロールバック
  - `IT-AC01`〜`IT-AC10`: 回帰確認

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `seed-data-and-utilities.int.test.ts` の `IT-AC11`〜`IT-AC12` を `it.todo` から失敗テストへ切り替える。
- [ ] Seed 再実行で件数増加または失敗時部分反映が起こることを失敗で観測する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC11|IT-AC12"
```

### 2. Green Phase
- [ ] `supabase/seed.sql` を `BEGIN` 開始・全処理成功時 `COMMIT` の単一トランザクションにする。
- [ ] `cards` は `ON CONFLICT (card_key) DO NOTHING`、`decks` は `ON CONFLICT (id) DO UPDATE`、`deck_cards` は `ON CONFLICT (deck_id, card_id) DO NOTHING` を適用する。
- [ ] `IT-AC11`〜`IT-AC12` を pass させ、続けて `IT-AC01`〜`IT-AC12` 全件で回帰なしを確認する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC11|IT-AC12"
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts
```

### 3. Refactor Phase
- [ ] トランザクション境界と失敗注入ケースの可読性を改善し、テスト意図を明確化する。
- [ ] Phase 2 対象テストを再実行して回帰がないことを確認する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC11|IT-AC12"
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts
```

## 完了条件
- [ ] Seed 再実行後に `cards/decks/deck_cards` 件数が増えない（AC-11）。
- [ ] 失敗時に明示的エラーが返り、部分成功データが残らない（AC-12）。
- [ ] `IT-AC11`〜`IT-AC12` が pass し、`IT-AC01`〜`IT-AC10` へ回帰がない。
- [ ] 動作確認レベル L2（対象 Integration）が満たされている。

## 動作確認
- [ ] `supabase db reset`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC11|IT-AC12"`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`
- [ ] `git diff --name-only`
