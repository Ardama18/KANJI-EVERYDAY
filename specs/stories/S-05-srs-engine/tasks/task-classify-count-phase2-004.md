# タスク: classifyCard/countByCategoryを実装してAC#12〜#15を固定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 2
- 依存: `task-calculate-time-preview-phase1-003.md`
- 提供成果物:
  - `frontend/src/lib/srs/classify.ts`
  - `frontend/src/lib/srs/classify.test.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC12`〜`IT-AC15` 実装）
- 関連AC: AC#12, AC#13, AC#14, AC#15
- サイズ: 標準（4-10ファイル）

## 実装内容
`classifyCard` と `countByCategory` を実装し、`new/learn/due/null` 判定と `null` 除外集計を固定する。`dueDate > today -> null`、`state=null -> new` などの境界をUnit + Integrationで確定する。

## 対象ファイル
- [x] `frontend/src/lib/srs/classify.ts`
- [x] `frontend/src/lib/srs/classify.test.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Unit:
  - `classifyCard(null)=new`
  - learn/due 分岐
  - future due の `null` 判定
  - `countByCategory` の `null` 除外集計
- Integration:
  - `IT-AC12`, `IT-AC13`, `IT-AC14`, `IT-AC15`

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `classify.test.ts` に AC#12〜#15 の失敗テストを追加する。
- [x] `srs-engine.int.test.ts` の `IT-AC12`〜`IT-AC15` を失敗テストへ変更する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/classify.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15"
```

### 2. Green Phase
- [x] `classify.ts` に分類判定と集計ロジックを最小実装する。
- [x] `null` 除外条件を明示して集計仕様を実装する。
- [x] 対象テストがPASSするまで判定順序を調整する。

```bash
npm run test --prefix frontend -- src/lib/srs/classify.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15"
```

### 3. Refactor Phase
- [x] 分類条件を読みやすい述語関数へ整理する（挙動不変）。
- [x] 境界ケース（today一致/未一致）をテーブル駆動で明確化する。
- [x] 対象テスト再実行で回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/classify.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15"
```

## 品質チェック
- [x] `npm run test --prefix frontend -- src/lib/srs/classify.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15"`
- [x] `npm run typecheck --prefix frontend`

## 完了条件
- [x] AC#12〜#15 が Unit + Integration でPASSしている。
- [x] `classifyCard` / `countByCategory` が pure 関数として実装されている。
- [x] 変更差分が Phase 2前半の論理単位として1コミット可能。
- [x] 動作確認レベル L2（対象Unit + Integration + 型チェック）を満たす。
