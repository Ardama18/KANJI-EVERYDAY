# タスク: 最終品質保証とE2E受入証跡を確定する

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 最終Phase（phase4）
- 依存: `specs/stories/S-08-illustration-generation-backend/tasks/task-illustration-generation-backend-phase3-005.md`
- 提供成果物:
  - `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts`（E2E-AC01〜E2E-AC14 実装）
  - `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`（最終回帰調整）
  - `specs/stories/S-08-illustration-generation-backend/tests/s08-traceability.md`（最終証跡）
- 関連AC: AC-01〜AC-14
- サイズ: 標準（4-10ファイル）

## 実装内容
全実装完了後に E2E-AC01〜14 を実装・実行し、統合テスト全件回帰と `npm run check --prefix frontend` を通過させる。`requirements` / `ADR` / `design` / `実装` / `IT/E2E` の追跡を `s08-traceability.md` に集約し、ストーリー完了判定を可能にする。

## 対象ファイル
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts`
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/s08-traceability.md`

## テスト観点
- E2E:
  - `E2E-AC01`〜`E2E-AC14`
  - 主要導線: trigger -> state transition -> getIllustrationUrl
- Integration regression:
  - `illustration-generation-backend.int.test.ts` 全件
- Quality gate:
  - `npm run check --prefix frontend`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `illustration-generation-backend.e2e.test.ts` の `E2E-AC01`〜`E2E-AC14` を `it.todo` から失敗テストへ変更する。
- [ ] 失敗を確認し、前提データ/待機条件を洗い出す。

```bash
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts
```

### 2. Green Phase
- [ ] E2Eシナリオを実装し、主要導線を通過させる。
- [ ] 統合テスト全件を実行し、Phase 1〜3退行がないことを確認する。
- [ ] `npm run check --prefix frontend` を実行し、lint/typecheck/test を通す。
- [ ] `s08-traceability.md` に AC-01〜AC-14 の最終証跡を追記する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts
npm run check --prefix frontend
```

### 3. Refactor Phase
- [ ] flakyになりやすい待機/時刻/selectorを安定化する。
- [ ] `s08-traceability.md` のAC対応表を最終更新する。
- [ ] 統合/E2E/品質ゲートを再実行して最終状態を固定する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts
npm run check --prefix frontend
```

## 完了条件
- [ ] `E2E-AC01`〜`E2E-AC14` がPASSしている。
- [ ] 統合テスト全件がPASSしている。
- [ ] `npm run check --prefix frontend` がPASSしている。
- [ ] AC-01〜AC-14 の証跡が `s08-traceability.md` で追跡可能である。
- [ ] plan.md の実施ルール（統合テスト同phase、E2E最終phase）が満たされている。
- [ ] 動作確認レベル L3（全体回帰 + E2E + 品質ゲート）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.e2e.test.ts`
- [ ] `npm run check --prefix frontend`
- [ ] `git diff --name-only`
