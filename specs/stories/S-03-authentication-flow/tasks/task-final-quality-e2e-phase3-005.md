# タスク: 最終品質保証とE2E受入を確定する

メタ情報:
- ストーリー: S-03-authentication-flow
- フェーズ: 最終Phase（phase3）
- 依存: `specs/stories/S-03-authentication-flow/tasks/task-auth-ui-layout-phase2-004.md`
- 提供成果物:
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx`（E2E-AC01〜E2E-AC20 実装）
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`（最終回帰整備）
  - `specs/stories/S-03-authentication-flow/tests/s03-traceability.md`（AC/テスト/実装追跡）
- 関連AC: AC#1〜AC#20
- 関連Should: SH-01, SH-02
- サイズ: 標準（4-10ファイル）

## 実装内容
全実装完了後に E2E シナリオを実装・実行し、統合テスト全件回帰と frontend 品質ゲートを通す。`requirements`/`ADR`/`design`/`実装`/`テスト` のトレーサビリティを `s03-traceability.md` に整理し、S-03の受入証跡を確定する。

## 対象ファイル
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx`
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`
- [x] `specs/stories/S-03-authentication-flow/tests/s03-traceability.md`

## テスト観点
- E2E:
  - `E2E-AC01`〜`E2E-AC20`
  - `E2E-SH01-LOADING-BEHAVIOR`
  - `E2E-SH02-LOGIN-SIGNUP-CROSS-NAVIGATION`
- Integration regression:
  - `IT-AC01`〜`IT-AC20`（全件再実行）
  - `IT-SH02`
- Quality gate:
  - frontend `lint`, `typecheck`, `test` を含む `npm run check --prefix frontend`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `authentication-flow.e2e.test.tsx` の `E2E-AC01`〜`E2E-AC20` を `it.todo` から失敗テストへ変更する。
- [x] SH観点（送信中状態/相互導線）のE2Eシナリオを追加する。
- [x] 失敗結果を確認し、未実装または不安定な観点を洗い出す。

```bash
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx
```

### 2. Green Phase
- [x] E2Eシナリオを実装し、AC#1〜AC#20のユーザー導線を通す。
- [x] `authentication-flow.int.test.tsx` をフル実行し、Phase 0〜2 の退行がないことを確認する。
- [x] `npm run check --prefix frontend` を実行し、品質ゲートを通過させる。
- [x] AC#2（email confirmations=OFF）の運用証跡を含めて `s03-traceability.md` を更新する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx
npm run check --prefix frontend
```

### 3. Refactor Phase
- [x] flakyになりやすい待機条件・時刻依存・selectorを安定化する。
- [x] `s03-traceability.md` の AC -> 実装 -> IT/E2E 対応関係を最終更新する。
- [x] 統合/E2E/品質ゲートを再実行し、最終状態を固定する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx
npm run check --prefix frontend
```

## 完了条件
- [x] `E2E-AC01`〜`E2E-AC20` が pass している。
- [x] `IT-AC01`〜`IT-AC20` の全件回帰が pass している。
- [x] `npm run check --prefix frontend` が pass している。
- [x] `s03-traceability.md` で AC#1〜AC#20 と SH観点の証跡が追跡可能である。
- [x] plan.md のルール（統合テスト同phase実施 / E2E最終実施）を満たしている。
- [x] 動作確認レベル L3（全体回帰 + E2E + 品質ゲート）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx`
- [x] `npm run check --prefix frontend`
- [x] `git diff --name-only`
