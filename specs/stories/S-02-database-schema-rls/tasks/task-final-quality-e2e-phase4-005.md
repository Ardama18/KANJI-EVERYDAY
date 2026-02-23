# タスク: 最終品質保証とE2E受入（Scenario 1〜5）

メタ情報:
- ストーリー: S-02-database-schema-rls
- フェーズ: 最終Phase（phase4）
- 依存: `specs/stories/S-02-database-schema-rls/tasks/task-type-contract-phase3-004.md`
- 提供成果物:
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts`（E2E-01〜05 実装）
  - `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`（最終回帰調整）
  - `specs/stories/S-02-database-schema-rls/tests/s02-traceability.md`
- 対応AC: AC-01〜AC-12, E2E-01〜E2E-05
- サイズ: 標準（4-10ファイル）

## 実装内容
E2E Scenario 1〜5を `database-schema-rls.e2e.test.ts` に実装し、全実装完了後にのみE2Eを実行する。統合テスト全件を再実行して退行を排除し、要件/ADR/Design/実装/テストのトレーサビリティを `s02-traceability.md` に記録する。

## 対象ファイル
- [ ] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts`
- [ ] `specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`
- [ ] `specs/stories/S-02-database-schema-rls/tests/s02-traceability.md`
- [ ] `frontend/src/types/database.ts`（最終生成物の再確認）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `database-schema-rls.e2e.test.ts` の E2E-01〜05 を `it.todo` から失敗テストへ置き換える。
- [ ] migration→RLS→storage→type contract を通しで検証するアサーションを先に記述する。
- [ ] 失敗状態を確認し、欠けている前提を洗い出す。

```bash
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts
```

### 2. Green Phase
- [ ] E2E-01〜05が通るようにシナリオ実装を完成させる。
- [ ] 統合テストを全件実行し、AC-01〜12の退行がないことを確認する。
- [ ] frontend型/テストを再実行して、型契約の破綻がないことを確認する。

```bash
supabase db reset
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
```

### 3. Refactor Phase
- [ ] flakyになりやすい待機/時刻依存アサーションを安定化する。
- [ ] `specs/stories/S-02-database-schema-rls/tests/s02-traceability.md` に ACごとの証跡を整理する。
- [ ] E2E + Integration + frontendチェックを再実行し、最終状態を固定する。

```bash
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts
npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件
- [ ] E2E-01〜E2E-05がPASSする。
- [ ] AC-01〜AC-12の検証結果がテストログと `s02-traceability.md` で追跡可能。
- [ ] plan.md の固定ルール（統合テスト同Phase実施、E2E最終実施）を満たす。
- [ ] frontend lint/typecheck/test がPASSする。
- [ ] 動作確認レベル L3 を満たす（全体回帰 + E2E）。

## 動作確認
- [ ] `supabase db reset`
- [ ] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts`
- [ ] `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts`
- [ ] `npm --prefix frontend run lint`
- [ ] `npm --prefix frontend run typecheck`
- [ ] `npm --prefix frontend run test`
- [ ] `git diff --name-only`
