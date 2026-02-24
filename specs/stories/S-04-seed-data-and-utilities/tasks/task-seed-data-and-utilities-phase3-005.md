# タスク: 最終品質保証とE2E受入を完了する

メタ情報:
- ストーリー: S-04-seed-data-and-utilities
- フェーズ: 最終Phase（phase3）
- 依存: `specs/stories/S-04-seed-data-and-utilities/tasks/task-seed-data-and-utilities-phase2-004.md`
- 提供成果物:
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts`（E2E-01〜E2E-05 実装）
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（最終回帰調整）
  - `specs/stories/S-04-seed-data-and-utilities/tests/s04-traceability.md`（新規）
- 関連AC: AC-01〜AC-12, E2E-01〜E2E-05
- サイズ: 標準（4-10ファイル）

## 実装内容
全実装完了後にのみ E2E シナリオ 1〜5 を実装・実行し、S-04 の受入証跡を確定する。統合テスト全件回帰と frontend 品質ゲートを同一タスクで完了し、`s04-traceability.md` に Story/Design/実装/テストの対応を記録する。

## 対象ファイル
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts`
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/s04-traceability.md`（新規）
- [ ] `frontend/src/lib/date.ts`
- [ ] `frontend/src/lib/date.test.ts`
- [ ] `supabase/seed.sql`

## テスト観点
- E2E:
  - `E2E-01`: date utility 正常系導線（AC-01〜AC-05）
  - `E2E-02`: 不正入力 fail-fast 導線（AC-06）
  - `E2E-03`: seed 初回実行導線（AC-07〜AC-10）
  - `E2E-04`: seed 冪等再実行導線（AC-11）
  - `E2E-05`: seed 失敗時ロールバック導線（AC-12）
- Regression:
  - `IT-AC01`〜`IT-AC12` 全件
  - frontend lint/typecheck/test

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `seed-data-and-utilities.e2e.test.ts` の `E2E-01`〜`E2E-05` を `it.todo` から失敗テストへ切り替える。
- [ ] E2E 実行で不足前提・失敗ポイントを明確化する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts
```

### 2. Green Phase
- [ ] `E2E-01`〜`E2E-05` が pass するようテスト実装を完成させる。
- [ ] 統合テスト `IT-AC01`〜`IT-AC12` を再実行し、退行がないことを確認する。
- [ ] frontend 品質ゲート（lint/typecheck/test）を実行する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts
npm --prefix frontend run check
```

### 3. Refactor Phase
- [ ] `specs/stories/S-04-seed-data-and-utilities/tests/s04-traceability.md` を作成し、AC-01〜AC-12 と E2E シナリオの証跡を整理する。
- [ ] flaky 要因（時刻依存・seed 再実行順）を安定化し、最終回帰を実施する。

```bash
supabase db reset
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts
npm --prefix frontend run check
```

## 完了条件
- [ ] `E2E-01`〜`E2E-05` が pass している。
- [ ] `IT-AC01`〜`IT-AC12` が pass している。
- [ ] `s04-traceability.md` で AC とテスト結果が追跡可能になっている。
- [ ] plan.md の運用ルール（統合テスト同 Phase、E2E 最終 Phase）を満たしている。
- [ ] 動作確認レベル L3（統合 + E2E + 品質ゲート）が満たされている。

## 動作確認
- [ ] `supabase db reset`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`
- [ ] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts`
- [ ] `npm --prefix frontend run check`
- [ ] `git diff --name-only`
