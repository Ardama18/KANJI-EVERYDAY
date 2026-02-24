# タスク: JST日次リセットとinterval previewを実装してPhase1を完結する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 1
- 依存: `task-calculate-core-phase1-002.md`
- 提供成果物:
  - `frontend/src/lib/srs/calculate.ts`
  - `frontend/src/lib/srs/calculate.test.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC08`, `IT-AC11`, `IT-AC24` 実装 + Phase1回帰確認）
- 関連AC: AC#8, AC#11, AC#24
- サイズ: 標準（4-10ファイル）

## 実装内容
`retryTodayCount` の JST日次リセットと 00:00 境界判定、`getIntervalPreview` の仕様文言を実装する。Phase 1残ACを固定し、`IT-AC03`〜`IT-AC11` + `IT-AC24` がすべてPASSする状態でPhase 1を完了させる。

## 対象ファイル
- [x] `frontend/src/lib/srs/calculate.ts`
- [x] `frontend/src/lib/srs/calculate.test.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Unit:
  - JST日次境界（同日/翌日、00:00跨ぎ）で retry カウントが正しく再計算される
  - `getIntervalPreview` が `good/hard/again` の仕様文言を返す
- Integration:
  - `IT-AC08`, `IT-AC11`, `IT-AC24`
  - Phase 1対象（`IT-AC03`〜`IT-AC11`, `IT-AC24`）全件再実行

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `calculate.test.ts` に JST境界・preview文言の失敗テストを追加する。
- [x] `srs-engine.int.test.ts` の `IT-AC08`, `IT-AC11`, `IT-AC24` を失敗テストへ変更する。
- [x] 期待どおり失敗することを確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC08|IT-AC11|IT-AC24"
```

### 2. Green Phase
- [x] `calculate.ts` に JST日次判定ロジックを追加し、retry リセット条件を実装する。
- [x] `getIntervalPreview` の返却文言を仕様どおり実装する。
- [x] `IT-AC08`, `IT-AC11`, `IT-AC24` がPASSするまで調整する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC08|IT-AC11|IT-AC24"
```

### 3. Refactor Phase
- [x] JST日付比較ロジックを重複なく整理し、意図が読める命名へ改善する。
- [x] Phase 1統合テスト全件（`IT-AC03`〜`IT-AC11`, `IT-AC24`）を再実行して回帰がないことを確認する。
- [x] calculate系Unitテストを再実行し、境界値の再現性を確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC24"
```

## 品質チェック
- [x] `npm run test --prefix frontend -- src/lib/srs/calculate.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC24"`
- [x] `npm run typecheck --prefix frontend`

## 完了条件
- [x] AC#8, AC#11, AC#24 が Unit + Integration でPASSしている。
- [x] Phase 1対象 Integration（`IT-AC03`〜`IT-AC11`, `IT-AC24`）が全件PASSしている。
- [x] JST境界判定の再現性がテストで担保されている。
- [x] 動作確認レベル L2（対象Unit + Integration + 型チェック）を満たす。
