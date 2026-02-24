# タスク: 最終品質保証とE2E証跡を確定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 4（最終Phase）
- 依存: `task-queue-operations-phase3-006.md`
- 提供成果物:
  - `specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts`（`E2E-AC01`〜`E2E-AC24` 実装）
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（全件回帰実行結果）
  - `specs/stories/S-05-srs-engine/plan.md`（必要に応じて AC別完了チェック更新）
- 関連AC: AC#1〜AC#24（受入証跡確定）
- サイズ: 標準（4-10ファイル）

## 実装内容
全実装完了後にのみ E2E を実装・実行し、AC#1〜#24 の受入証跡を確定する。統合テスト全件回帰、`npm run check --prefix frontend` の品質ゲート、トレーサビリティ整理までを1コミットで完結する。

## 対象ファイル
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`
- [x] `specs/stories/S-05-srs-engine/plan.md`

## テスト観点
- E2E:
  - `E2E-AC01`〜`E2E-AC24` の受入シナリオが通る
- Integration Regression:
  - `IT-AC01`〜`IT-AC24` が継続して通る
- Quality Gate:
  - frontend の lint/typecheck/test を含む `check` が通る

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `srs-engine.e2e.test.ts` の `E2E-AC01`〜`E2E-AC24` を失敗テストとして実装する。
- [x] 現状で失敗することを確認する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts
```

### 2. Green Phase
- [x] E2Eシナリオを最小修正で安定化し、`E2E-AC01`〜`E2E-AC24` をPASSさせる。
- [x] 統合テスト全件を再実行し、回帰がないことを確認する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts
```

### 3. Refactor Phase
- [x] E2Eの重複セットアップを整理し、flakeを抑える。
- [x] `npm run check --prefix frontend` を実行して最終品質ゲートを通過させる。
- [x] AC別トレーサビリティ（Unit/Integration/E2E対応）を `plan.md` に反映する。

```bash
npm run check --prefix frontend
```

## 品質チェック
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.e2e.test.ts`
- [x] `npm run check --prefix frontend`

## 完了条件
- [x] `E2E-AC01`〜`E2E-AC24` がPASSしている。
- [x] `IT-AC01`〜`IT-AC24` の統合テスト全件がPASSしている。
- [x] `npm run check --prefix frontend` が成功している。
- [x] AC#1〜#24 の検証経路（Unit/Integration/E2E）が追跡可能である。
- [x] 動作確認レベル L3（統合全件 + E2E + 品質ゲート）を満たす。
