# タスク: キュー消化APIを実装してAC#19〜#23を固定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 3
- 依存: `task-build-session-queue-phase2-005.md`
- 提供成果物:
  - `frontend/src/lib/srs/queue.ts`
  - `frontend/src/lib/srs/queue.test.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC19`〜`IT-AC23` 実装 + 全件回帰確認）
- 関連AC: AC#19, AC#20, AC#21, AC#22, AC#23
- サイズ: 標準（4-10ファイル）

## 実装内容
セッション進行API（`getNextCardId` / `dequeueCard` / `addToRetryQueue` / `isSessionComplete`）を実装する。優先順 `due -> learn -> new -> retry`、no-op時の新規参照返却、retry重複許容、全キュー空判定を immutable 契約で固定する。

## 対象ファイル
- [ ] `frontend/src/lib/srs/queue.ts`
- [ ] `frontend/src/lib/srs/queue.test.ts`
- [ ] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Unit:
  - 優先順で次カードIDが選ばれる
  - `dequeueCard` が対象キュー先頭1件のみ削除し入力を破壊しない
  - 空キュー `dequeueCard` が no-op + 新規参照返却
  - `addToRetryQueue` が重複IDを許容して末尾追加
  - `isSessionComplete` が4キュー全空時のみ `true`
- Integration:
  - `IT-AC19`〜`IT-AC23`
  - `IT-AC01`〜`IT-AC24` 全件回帰確認

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [ ] `queue.test.ts` に AC#19〜#23 の失敗テストを追加する。
- [ ] `srs-engine.int.test.ts` の `IT-AC19`〜`IT-AC23` を失敗テストへ変更する。
- [ ] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC19|IT-AC20|IT-AC21|IT-AC22|IT-AC23"
```

### 2. Green Phase
- [ ] `queue.ts` に4つのキュー操作関数を最小実装する。
- [ ] 各操作で新規オブジェクト返却（immutable）を保証する。
- [ ] `IT-AC19`〜`IT-AC23` がPASSするまで実装を調整する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC19|IT-AC20|IT-AC21|IT-AC22|IT-AC23"
```

### 3. Refactor Phase
- [ ] キュー選択優先順ロジックを読みやすい小関数へ整理する。
- [ ] Phase 3完了条件として統合テスト全件（`IT-AC01`〜`IT-AC24`）を再実行する。
- [ ] queue系Unitテストを再実行し、参照不変性の回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/srs/queue.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts
```

## 品質チェック
- [ ] `npm run test --prefix frontend -- src/lib/srs/queue.test.ts`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`
- [ ] `npm run typecheck --prefix frontend`

## 完了条件
- [ ] AC#19〜#23 が Unit + Integration でPASSしている。
- [ ] `IT-AC01`〜`IT-AC24` の統合テスト全件がPASSしている。
- [ ] キュー操作が入力非破壊・新規参照返却であることをテストで担保できる。
- [ ] 動作確認レベル L2（対象Unit + Integration + 型チェック）を満たす。
