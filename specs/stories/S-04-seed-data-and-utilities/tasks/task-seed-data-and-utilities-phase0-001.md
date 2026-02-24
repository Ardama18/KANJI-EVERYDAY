# タスク: JST日付ユーティリティとPhase 0統合テストを確定する

メタ情報:
- ストーリー: S-04-seed-data-and-utilities
- フェーズ: 0
- 依存: なし
- 提供成果物:
  - `frontend/src/lib/date.ts`
  - `frontend/src/lib/date.test.ts`
  - `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（IT-AC01〜IT-AC06 実装）
- 関連AC: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06
- サイズ: 標準（4-10ファイル）

## 実装内容
`getTodayJST`, `getTomorrowJST(baseDate?: string)`, `addDaysJST`, `isBeforeOrEqualJST` を `frontend/src/lib/date.ts` に実装し、UTC/JST 境界・月跨ぎ・年跨ぎ・比較・不正入力 fail-fast を unit/integration の両方で固定する。Phase 0 対象 `IT-AC01`〜`IT-AC06` を `it.todo` から実装して同一 Phase で合格させる。

## 対象ファイル
- [x] `frontend/src/lib/date.ts`（新規）
- [x] `frontend/src/lib/date.test.ts`（新規）
- [x] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`

## テスト観点
- Unit:
  - `UT-AC01-DATE-EXPORTS`
  - `UT-AC02-TODAY-JST-UTC-BOUNDARY`
  - `UT-AC03-TOMORROW-MONTH-ROLLOVER`
  - `UT-AC04-ADDDAYS-YEAR-ROLLOVER`
  - `UT-AC05-DATE-COMPARISON`
  - `UT-AC06-INVALID-DATE-FAIL-FAST`
- Integration:
  - `IT-AC01`, `IT-AC02`, `IT-AC03`, `IT-AC04`, `IT-AC05`, `IT-AC06`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/lib/date.test.ts` を作成し、AC-01〜AC-06 の失敗テストを追加する。
- [x] `seed-data-and-utilities.int.test.ts` の `IT-AC01`〜`IT-AC06` を `it.todo` から失敗テストへ切り替える。
- [x] 追加したテストを実行して失敗を確認する。

```bash
npm --prefix frontend run test -- src/lib/date.test.ts
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06"
```

### 2. Green Phase
- [x] `frontend/src/lib/date.ts` に4関数と `YYYY-MM-DD` 検証（不正入力例外）を最小実装する。
- [x] `getTomorrowJST()` と `getTomorrowJST("2026-02-28")` の両呼び出しが成立するように実装する。
- [x] unit + integration の Phase 0 対象テストを再実行して合格させる。

```bash
npm --prefix frontend run test -- src/lib/date.test.ts
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06"
```

### 3. Refactor Phase
- [x] date 文字列パースとフォーマット処理の重複を整理し、可読性を改善する。
- [x] fail-fast 例外メッセージを統一し、テストが契約を保証するよう調整する。
- [x] Phase 0 対象テストを再実行し、回帰がないことを確認する。

```bash
npm --prefix frontend run test -- src/lib/date.test.ts
npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06"
```

## 完了条件
- [x] `frontend/src/lib/date.ts` で4関数が export されている（AC-01）。
- [x] UTC/JST 境界・月跨ぎ・年跨ぎ・比較判定の unit/integration テストが pass している（AC-02〜AC-05）。
- [x] 不正入力で明示的例外を送出し計算を継続しないことがテストで確認できる（AC-06）。
- [x] `IT-AC01`〜`IT-AC06` が pass している。
- [x] 動作確認レベル L2（対象 Unit + Integration）が満たされている。

## 動作確認
- [x] `npm --prefix frontend run test -- src/lib/date.test.ts`
- [x] `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06"`
- [x] `git diff --name-only`
