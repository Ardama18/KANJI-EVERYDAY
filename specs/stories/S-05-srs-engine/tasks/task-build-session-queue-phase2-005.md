# タスク: buildSessionQueueを実装してAC#16〜#18を固定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 2
- 依存: `task-classify-count-phase2-004.md`
- 提供成果物:
  - `frontend/src/lib/srs/queue.ts`
  - `frontend/src/lib/srs/queue.test.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC16`〜`IT-AC18` 実装）
- 関連AC: AC#16, AC#17, AC#18
- サイズ: 標準（4-10ファイル）

## 実装内容
`buildSessionQueue(cards, today, newLimit)` を実装し、`due -> learn -> new -> retry` の初期構築、`newLimit` 正規化、カテゴリ内入力順維持、`retry=[]` 初期化を固定する。

## 対象ファイル
- [x] `frontend/src/lib/srs/queue.ts`
- [x] `frontend/src/lib/srs/queue.test.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Unit:
  - `newLimit` 正規化（`1.9 -> 1`, `-1 -> 0`, `NaN -> 0`）
  - カテゴリ内の入力順維持
  - 初期 `retry` が空配列で構築される
- Integration:
  - `IT-AC16`, `IT-AC17`, `IT-AC18`
  - Phase 2対象（`IT-AC12`〜`IT-AC18`）回帰確認

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `queue.test.ts` に AC#16〜#18 の失敗テストを追加する。
- [x] `srs-engine.int.test.ts` の `IT-AC16`〜`IT-AC18` を失敗テストへ変更する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC16|IT-AC17|IT-AC18"
```

### 2. Green Phase
- [x] `queue.ts` に `buildSessionQueue` を最小実装する。
- [x] `newLimit` 正規化とカテゴリ順序維持を明示実装する。
- [x] 対象テストがPASSするまで実装を調整する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC16|IT-AC17|IT-AC18"
```

### 3. Refactor Phase
- [x] O(n) で処理できるようループ構造を整理する（余計な再走査を避ける）。
- [x] Phase 2統合テスト全件（`IT-AC12`〜`IT-AC18`）を再実行する。
- [x] Unitテストを再実行し回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15|IT-AC16|IT-AC17|IT-AC18"
```

## 品質チェック
- [x] `npm run test --prefix frontend -- src/lib/srs/queue.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC12|IT-AC13|IT-AC14|IT-AC15|IT-AC16|IT-AC17|IT-AC18"`
- [x] `npm run typecheck --prefix frontend`

## 完了条件
- [x] AC#16〜#18 が Unit + Integration でPASSしている。
- [x] `buildSessionQueue` の `newLimit` 正規化と順序契約が固定されている。
- [x] 実装が O(n) 方針で説明可能である。
- [x] 動作確認レベル L2（対象Unit + Integration + 型チェック）を満たす。
