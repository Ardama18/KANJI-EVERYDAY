# タスク: reveal/back 状態統合とPhase1統合テストを完了する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 1
- 依存: `specs/stories/S-09-illustration-display-integration/tasks/task-illustration-normalization-phase1-001.md`
- 提供成果物:
  - `frontend/src/actions/session-actions.ts`
  - `frontend/src/actions/session-actions.test.ts`
  - `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- 関連AC: AC-08, AC-09, AC-10, AC-11
- サイズ: 標準（4-10ファイル）

## 実装内容
`revealCard` と `getStudySessionState(phase=back)` の分岐を `normalizeIllustrationState` に統一し、レコードなし時の `ok/started` 分岐・trigger例外時 `pending` フォールバックを実装する。Phase 1 の統合テスト `IT-AC01`〜`IT-AC10` を同時に具体化し、停止ポイント（Phase 1対象IT PASS）を満たす。

## 対象ファイル
- [ ] `frontend/src/actions/session-actions.ts`
- [ ] `frontend/src/actions/session-actions.test.ts`
- [ ] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`

## テスト観点
- Unit:
  - レコードなし + `ok=true started=true` で `generating/null`（AC-08）
  - レコードなし + `ok=true started=false` で `pending/null`（AC-09）
  - `ok=false` でも例外を投げず `pending/null`（AC-10）
  - trigger例外でも例外を投げず `pending/null`（AC-11）
  - `phase=back` が `revealCard` と同値の結果を返す
- Integration:
  - `IT-AC01`〜`IT-AC10` を `it.todo` から具体化しPASSさせる

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `frontend/src/actions/session-actions.test.ts` に `ok/started` 分岐と例外フォールバックの失敗テストを追加する。
- [ ] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts` の `IT-AC01`〜`IT-AC10` を失敗テストとして具体化する。
- [ ] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

### 2. Green Phase
- [ ] `revealCard` に `ok/started` 分岐と trigger例外時 `pending` フォールバックを実装する。
- [ ] `getStudySessionState(phase=back)` に同一正規化を適用し、`revealCard` と結果を揃える。
- [ ] `IT-AC01`〜`IT-AC10` を通過させる最小実装を加える。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

### 3. Refactor Phase
- [ ] `revealCard` / `getStudySessionState` の共通分岐を整理し、重複条件を削減する。
- [ ] Phase 1対象のunit/integrationを再実行して回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

## 完了条件
- [ ] AC-08/09/10/11 を unit + integration で追跡できる。
- [ ] `IT-AC01`〜`IT-AC10` がPASSしている。
- [ ] Phase 1停止ポイント（対象統合テストPASS）を満たしている。
- [ ] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/actions/session-actions.test.ts`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- [ ] `git diff --name-only`
