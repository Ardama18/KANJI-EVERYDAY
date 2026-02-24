# タスク: triggerIllustrationGeneration の状態遷移と非同期起動を実装する

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 1
- 依存: `specs/stories/S-08-illustration-generation-backend/tasks/task-illustration-generation-backend-phase1-001.md`
- 提供成果物:
  - `frontend/src/actions/illustration-actions.ts`
  - `frontend/src/actions/illustration-actions.test.ts`
  - `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`（IT-AC01/03/04/05/06/07 実装）
- 関連AC: AC-01, AC-03, AC-04, AC-05, AC-06, AC-07
- サイズ: 標準（4-10ファイル）

## 実装内容
`triggerIllustrationGeneration(cardId)` に認証チェック、owner境界、状態遷移（ready/pending=no-op, failed=retry, missing=insert）を実装する。`void processIllustrationGeneration(...).catch(...)` による fire-and-forget を同コミットで導入し、Phase 1対象の統合テストを合格させる。

## 対象ファイル
- [x] `frontend/src/actions/illustration-actions.ts`
- [x] `frontend/src/actions/illustration-actions.test.ts`
- [x] `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`

## テスト観点
- Unit:
  - 未認証で認証エラー + DB副作用0件 + 外部API呼び出し0回
  - `ready/pending` で no-op
  - `failed` で `pending` へ戻して再生成開始
  - レコードなしで `pending` INSERT + 生成開始
  - fire-and-forgetで呼び出し側応答をブロックしない
- Integration:
  - `IT-AC01`, `IT-AC03`, `IT-AC04`, `IT-AC05`, `IT-AC06`, `IT-AC07`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/actions/illustration-actions.test.ts` のPhase 1対象ケースを `it.todo` から失敗テストへ変更する。
- [x] `illustration-generation-backend.int.test.ts` の `IT-AC01/03/04/05/06/07` を失敗テストへ変更する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-03|AC-04|AC-05|AC-06|AC-07"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC01|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07"
```

### 2. Green Phase
- [x] `triggerIllustrationGeneration` の認証・owner境界・状態遷移ロジックを実装する。
- [x] `void processIllustrationGeneration(...).catch(...)` を導入し、非同期例外を握りつぶさない。
- [x] Unit/IntegrationのPhase 1対象テストを通す。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-03|AC-04|AC-05|AC-06|AC-07"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC01|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07"
```

### 3. Refactor Phase
- [x] 状態遷移分岐を可読な判定関数へ整理する。
- [x] owner境界・DB更新条件の重複を削減する。
- [x] Phase 1対象テストを再実行して回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-03|AC-04|AC-05|AC-06|AC-07"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC01|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07"
```

## 完了条件
- [x] AC-01/03/04/05/06/07 の受入観点を満たす実装とテストが揃っている。
- [x] `triggerIllustrationGeneration` が fire-and-forget 契約を満たし、生成完了待ちをしない。
- [x] `IT-AC01/03/04/05/06/07` がPASSしている。
- [x] Phase 1 完了チェック（対象AC + 対象統合テストPASS）が本タスク内で完結している。
- [x] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-03|AC-04|AC-05|AC-06|AC-07"`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC01|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07"`
- [x] `git diff --name-only`
