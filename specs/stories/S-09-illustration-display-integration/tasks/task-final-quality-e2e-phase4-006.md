# タスク: 最終品質保証とE2E受入証跡を確定する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 最終Phase（phase4）
- 依存: `specs/stories/S-09-illustration-display-integration/tasks/task-image-contract-phase3-005.md`
- 提供成果物:
  - `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts`
  - `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
  - `specs/stories/S-09-illustration-display-integration/tests/s09-traceability.md`
- 関連AC: AC-01〜AC-20
- サイズ: 標準（4-10ファイル）

## 実装内容
全実装完了後に E2E骨子の `it.todo` を具体化し、`E2E-AC01/03/12/13/14/15/16/17/20` をPASSさせる。統合テスト全件回帰と `npm run check --prefix frontend` を通過させ、requirements/ADR/design/実装/テストの対応関係を `s09-traceability.md` に集約してストーリー完了判定を可能にする。

## 対象ファイル
- [x] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts`
- [x] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- [x] `specs/stories/S-09-illustration-display-integration/tests/s09-traceability.md`

## テスト観点
- E2E:
  - `E2E-AC01`, `E2E-AC03`, `E2E-AC12`, `E2E-AC13`, `E2E-AC14`, `E2E-AC15`, `E2E-AC16`, `E2E-AC17`, `E2E-AC20`
- Integration regression:
  - `illustration-display-integration.int.test.ts` 全件
- Quality gate:
  - `npm run check --prefix frontend`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `illustration-display-integration.e2e.test.ts` の対象 `it.todo` を失敗テストへ置換する。
- [x] 失敗を確認し、前提データ/待機条件/selectorを確定する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts
```

### 2. Green Phase
- [x] E2Eシナリオを実装し、対象ACを通過させる。
- [x] 統合テスト全件を再実行し、Phase 1〜3退行がないことを確認する。
- [ ] `npm run check --prefix frontend` を実行し品質ゲートを通す。
- [x] `s09-traceability.md` に AC-01〜AC-20 の最終証跡を追記する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts
npm run check --prefix frontend
```

### 3. Refactor Phase
- [x] flaky要因（待機条件/selector/時刻依存）を安定化する。
- [x] `s09-traceability.md` の要件-設計-実装-テスト対応表を最終更新する。
- [ ] 統合/E2E/品質ゲートを再実行して最終状態を固定する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts
npm run check --prefix frontend
```

## 完了条件
- [x] `E2E-AC01/03/12/13/14/15/16/17/20` がPASSしている。
- [x] 統合テスト全件がPASSしている。
- [ ] `npm run check --prefix frontend` がPASSしている。
- [x] AC-01〜AC-20 の証跡が `s09-traceability.md` で追跡可能である。
- [x] plan.md の実施ルール（統合テスト同phase、E2E最終phase）が満たされている。
- [ ] 動作確認レベル L3（全体回帰 + E2E + 品質ゲート）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts`
- [ ] `npm run check --prefix frontend`
- [x] `git diff --name-only`

## 作業ログ
- 2026-02-24: `illustration-display-integration.e2e.test.ts` の `it.todo` を `E2E-AC01/03/12/13/14/15/16/17/20` の実テストへ置換し、`npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts` で 9 件PASSを確認。
- 2026-02-24: `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts` を再実行し、12 件PASSを確認。
- 2026-02-24: `specs/stories/S-09-illustration-display-integration/tests/s09-traceability.md` を新規作成し、AC-01〜AC-20の要件/ADR/設計/実装/テスト証跡を集約。
- 2026-02-24: `bash .claude/skills/quality-fixer/scripts/quality-check.sh` はスクリプト不在で実行不可。`npm run check --prefix frontend` は S-04 seed 系の既知DB障害（`127.0.0.1:54322`, `global/pg_filenode.map: I/O error`）で失敗し、全体品質ゲートPASSは未達。
- 2026-02-24: quality-fixer代替として S-09スコープ品質ゲート（`npm run lint --prefix frontend && npm run typecheck --prefix frontend && npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts`）を実行し、`status=approved`（S-09 scope）を確認。
