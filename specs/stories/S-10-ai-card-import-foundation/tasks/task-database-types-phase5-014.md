# タスク: Supabase生成型を統合しPhase 5品質ゲートを通す

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 5（最終タスク）
- 依存: `tasks/task-stage1-error-contract-phase5-013.md`
- 提供成果物: 再生成`database.ts`、共有型/DB RPC compile契約、Phase 5回帰/approved証跡
- 関連AC: AC-01〜09（型境界）
- サイズ: 標準（3-5ファイル）

## 実装内容

Phase 2〜4で確定したlocal DBからSupabase型を再生成し、既存cards変更、新規tables、wrapper関数args/returnsをfrontendの`Database` genericへ接続する。手編集で型を捏造せず、Unit 32件とDB Integration 56件を全回帰する。

## 対象ファイル

- [ ] `frontend/src/types/database.ts`
- [ ] `frontend/src/lib/supabase/client.ts`（生成型差分で必要な場合のみ）
- [ ] `frontend/src/lib/supabase/server.ts`（生成型差分で必要な場合のみ）
- [ ] `frontend/src/lib/ai-import/schema.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-database-types-phase5-014.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] migration適用済みのS-10専用local DBに対し型生成前のcompile失敗/不足RPCを確認する。
- [ ] wrapper args/results、table Insert/Update/Rowを共有契約から利用するcompile fixtureを追加または既存typecheckへ含める。

```bash
npm --prefix frontend run typecheck
```

### 2. Green Phase

- [ ] S-10専用local DBへ全migrationを適用してから公式CLIで型を再生成する。
- [ ] 生成型にcards.updated_at/owner constraints、新規8 tables、公開wrapper関数が含まれることを確認する。
- [ ] internal/trigger functionをclient公開APIとして利用するコードを作らない。
- [ ] Supabase client/serverの`Database` genericを維持し、normalized request/RPC args/resultsの`any`を除く。

```bash
supabase gen types typescript --local --schema public > frontend/src/types/database.ts
npm --prefix frontend run typecheck
```

### 3. Refactor / Phase gate

- [ ] Unit受入32件とmapper補助Unit、DB Integration実装済み56件を回帰する。
- [ ] generated file以外の不要な型assertion/重複DTOを削除する。
- [ ] task-executorから `/quality-fixer frontend` を呼び、lint/typecheck/Unit/Integrationを修正ループ後に通す。

```bash
npm --prefix frontend run test:s10:unit
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "^(?!.*IT-MIGRATION)"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [ ] S-10受入Unit 32/32件とmapper補助UnitがPASSする。
- [ ] DB Integration実装済み56/56件がPASSする。
- [ ] generated DB型がlocal schemaと一致し、既存client/serverがcompileする。
- [ ] normalized request/RPC args/results/database accessに`any`がない。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [ ] Phase 5の動作確認レベルL2を満たし、Phase 6開始条件が成立する。

## 注意事項

- `database.ts`を手作業で部分追記しない。
- Contract E2E TODOはPhase 6まで変更しない。
