# タスク: calculateRating基本遷移を実装してAC#3〜#7/#9/#10を固定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 1
- 依存: `task-contract-baseline-phase0-001.md`
- 提供成果物:
  - `frontend/src/lib/srs/calculate.ts`
  - `frontend/src/lib/srs/calculate.test.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC03`〜`IT-AC07`, `IT-AC09`, `IT-AC10` 実装）
- 関連AC: AC#3, AC#4, AC#5, AC#6, AC#7, AC#9, AC#10
- サイズ: 標準（4-10ファイル）

## 実装内容
`calculateRating(state, rating, today, now)` の基本遷移を実装する。`good/hard/again` 遷移、`state=null` 初回処理、level clamp、retry上限判定を pure / immutable 契約で固定し、Phase 1の中核ACを成立させる。

## 対象ファイル
- [x] `frontend/src/lib/srs/calculate.ts`
- [x] `frontend/src/lib/srs/calculate.test.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Unit:
  - `calculateRating` が 4引数契約を満たし、内部で時刻生成しない
  - `good/hard/again` 遷移、retry上限、`state=null`、level clamp
  - 入力 `state` が破壊されない（immutable）
- Integration:
  - `IT-AC03`〜`IT-AC07`, `IT-AC09`, `IT-AC10`

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `calculate.test.ts` に AC#3〜#7/#9/#10 の失敗テストを追加する。
- [x] `srs-engine.int.test.ts` の `IT-AC03`〜`IT-AC07`, `IT-AC09`, `IT-AC10` を失敗テストへ変更する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC09|IT-AC10"
```

### 2. Green Phase
- [x] `calculate.ts` に基本遷移ロジックを最小実装する（`good/hard/again`, retry上限, `state=null`, level clamp）。
- [x] `lastReviewedAt=now` を満たし、`new Date()` 非依存を維持する。
- [x] 追加テストがPASSするまで分岐条件を調整する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC09|IT-AC10"
```

### 3. Refactor Phase
- [x] 遷移分岐を可読性の高い補助関数へ整理する（挙動不変）。
- [x] immutable 契約確認テストを強化する（参照比較含む）。
- [x] 対象テストを再実行し回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/calculate.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC09|IT-AC10"
```

## 品質チェック
- [x] `npm run test --prefix frontend -- src/lib/srs/calculate.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC09|IT-AC10"`
- [x] `npm run typecheck --prefix frontend`

## 完了条件
- [x] AC#3〜#7/#9/#10 を Unit + Integration で検証できる。
- [x] `calculateRating` が pure / immutable 契約（入力非破壊）を満たす。
- [x] 変更差分が Phase 1の論理単位として1コミット可能。
- [x] 動作確認レベル L2（対象Unit + Integration + 型チェック）を満たす。
