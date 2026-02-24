# タスク: Seed deck_cards 100件紐付けとPhase 1統合回帰を完了する

メタ情報:
- ストーリー: S-04-seed-data-and-utilities
- フェーズ: 1
- 依存: `specs/stories/S-04-seed-data-and-utilities/tasks/task-seed-data-and-utilities-phase1-002.md`
- 提供成果物:
  - `supabase/seed.sql`（deck_cards 紐付け + conflict 戦略調整）
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（IT-AC10 実装）
- 関連AC: AC-10
- サイズ: 標準（4-10ファイル）

## 実装内容
Seed deck と全 Seed cards の紐付けを `deck_cards` に 100件作成する。`ON CONFLICT (deck_id, card_id) DO NOTHING` を適用し、Phase 1 の完成条件（AC-07〜AC-10）を統合テストで固定する。

## 対象ファイル
- [ ] `supabase/seed.sql`
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`

## テスト観点
- Integration:
  - `IT-AC10`: Seed deck と全 Seed cards の `deck_cards` 紐付けが 100件
  - `IT-AC07`〜`IT-AC09`: Phase 1 回帰確認

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `seed-data-and-utilities.int.test.ts` の `IT-AC10` を `it.todo` から失敗テストへ切り替える。
- [ ] Seed deck_id と cards 集合の紐付け欠損を失敗で観測し、必要 SQL を確定する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC10"
```

### 2. Green Phase
- [ ] `supabase/seed.sql` に `deck_cards` 100件投入（seed deck x seed cards）を実装する。
- [ ] `ON CONFLICT (deck_id, card_id) DO NOTHING` を適用し、重複リンクを防止する。
- [ ] `IT-AC10` を pass させたうえで `IT-AC07`〜`IT-AC10` を再実行して Phase 1 全体を合格させる。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC10"
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09|IT-AC10"
```

### 3. Refactor Phase
- [ ] deck_cards 生成クエリを読みやすく整理し、seed cards の選択条件を明示する。
- [ ] Phase 1 対象統合テストを再実行し、回帰がないことを確認する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09|IT-AC10"
```

## 完了条件
- [ ] Seed deck の `deck_cards` が 100件で欠損リンクがない（AC-10）。
- [ ] `IT-AC10` が pass し、`IT-AC07`〜`IT-AC09` に回帰がない。
- [ ] 動作確認レベル L2（対象 Integration）が満たされている。

## 動作確認
- [ ] `supabase db reset`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC10"`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC07|IT-AC08|IT-AC09|IT-AC10"`
- [ ] `git diff --name-only`
