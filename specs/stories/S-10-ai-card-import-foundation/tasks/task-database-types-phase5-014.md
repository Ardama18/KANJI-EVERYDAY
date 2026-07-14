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

- [x] `frontend/src/types/database.ts`
- [x] `frontend/src/lib/supabase/client.ts`（変更不要。`Database` generic維持を確認）
- [x] `frontend/src/lib/supabase/server.ts`（変更不要。`Database` generic維持を確認）
- [x] `frontend/src/lib/ai-import/schema.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tasks/task-database-types-phase5-014.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] migration適用済みのS-10専用local DBに対し型生成前のcompile失敗/不足RPCを確認する。
- [x] wrapper args/results、table Insert/Update/Rowを共有契約から利用するcompile fixtureを追加または既存typecheckへ含める。

```bash
npm --prefix frontend run typecheck
```

### 2. Green Phase

- [x] S-10専用local DBへ全migrationを適用してから公式CLIで型を再生成する。
- [x] 生成型にcards.updated_at/owner constraints、新規8 tables、公開wrapper関数が含まれることを確認する。
- [x] internal/trigger functionをclient公開APIとして利用するコードを作らない。
- [x] Supabase client/serverの`Database` genericを維持し、normalized request/RPC args/resultsの`any`を除く。

```bash
supabase gen types typescript --local --schema public > frontend/src/types/database.ts
npm --prefix frontend run typecheck
```

### 3. Refactor / Phase gate

- [x] Unit受入32件とmapper補助Unit、DB Integration実装済み56件を回帰する。
- [x] generated file以外の不要な型assertion/重複DTOを削除する。
- [x] task-executorから `/quality-fixer frontend` を呼び、lint/typecheck/Unit/Integrationを修正ループ後に通す。

```bash
npm --prefix frontend run test:s10:unit
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "^(?!.*IT-MIGRATION)"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [x] S-10受入Unit 32/32件とmapper補助UnitがPASSする。
- [x] DB Integration実装済み56/56件がPASSする。
- [x] generated DB型がlocal schemaと一致し、既存client/serverがcompileする。
- [x] normalized request/RPC args/results/database accessに`any`がない。
- [x] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [x] Phase 5の動作確認レベルL2を満たし、Phase 6開始条件が成立する。

## 注意事項

- `database.ts`を手作業で部分追記しない。
- Contract E2E TODOはPhase 6まで変更しない。

## 実行結果（2026-07-14）

- 専用fresh DB `s10_types_task014` にS-02 migration、S-10 migration、seedを適用し、Supabase CLI 2.109.1の`gen types typescript --db-url ... --schema public`で`database.ts`を全面再生成した。CLI生出力の再生成差分がないことを`cmp`で確認後、Biomeで機械整形した（手作業での型追記なし）。
- DB catalogと生成型の双方で`cards.updated_at`、S-10新規8 tables、公開wrapper 11関数のargs/returnsを確認した。`database.typecheck.ts`でcardsと8 tablesのRow/Insert/Update、11 wrapperのArgs/Returns、normalized requestから`commit_import` argsへの接続をcompile契約化した。
- `client.ts` / `server.ts`の`Database` genericを維持した。生成型を除くアプリコードのinternal/trigger function参照は0件、`database.ts` / normalized request / RPC args compile契約の`any`は0件だった。
- `npm --prefix frontend run test:s10:unit`: 32/32 PASS。
- `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts`: 6/6 PASS。
- `npx vitest run src`（`frontend` cwd）: 161/161 PASS。
- 専用DBで`test:s10:integration -- -t '^(?!.*IT-MIGRATION)'`: 56/56 PASS、Contract E2E 5件は既存どおりskip。
- `npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`: PASS。
- Supabase検証用環境変数を明示した`npm --prefix frontend run build`: PASS。既存middleware matcher警告のみ。
- 差し戻し対応としてcompile fixtureのtop-level runtime参照を除去し、引数を受け取る未実行関数内へ型接続を隔離した。`vite-node -c vitest.config.ts`によるmodule import、lint、typecheck、Unit 32/32、非DB 161/161、buildを再実行し、副作用と`ReferenceError`がないことを確認した。
- `/quality-fixer frontend`: `status=approved`。以下の独立fresh DB確認とPhase 1〜5回帰を含む最終品質ゲートを完了した。

### `/quality-fixer frontend` 最終確認

- 独立DB `s10_quality_task014_20260714`を`template0`から作成し、Supabase auth/storage基盤、S-02 migration 2本、S-10 migration全文、`supabase/seed.sql`をすべて`ON_ERROR_STOP=1`で適用した。結果はcards 100件、decks 1件、deck_cards 100件。
- fresh catalogでS-10新規8 tables、`cards.updated_at`、公開wrapper 11関数の引数/戻り値を確認し、生成型側も8 tables / 11 wrappersを保持した。task-executorがSupabase CLI 2.109.1の生出力と`cmp`済みであり、手編集による型追記はない。
- 品質担当環境からのCLI再生成は、キャッシュ済み公式CLI 2.109.1自体を確認できたが、CLI内部DB接続が`ECONNREFUSED`となるsandbox制約で完遂できなかった。既存CLI raw `cmp`証跡をfresh catalogとcompile fixtureで独立照合した。
- S-10 Unit 32/32件、mapper補助Unit 6/6件、非DB 161/161件、lint（90 files）、typecheck、必要envを明示したproduction buildがPASSした。
- DB Integrationは同一差分のtask-executor実行で56/56件PASS。品質担当環境での再実行はVitest配下の子`psql`が`EPERM`となるため、fresh DB適用・catalog probeと既存Green証跡で補完した。
- `database.typecheck.ts`を`vite-node`で実importし、exit 0・出力0・`ReferenceError`/副作用0を確認した。top-levelでRPC mapperを評価せず、型接続は未実行関数内に隔離されている。
- `database.ts` / compile fixture / normalized request・RPC mapperの`any`は0件。生成型を除く`frontend/src`からinternal/context/trigger関数への参照は0件。client/serverの`Database` genericを維持した。
- 差分健全性はTask014対象4ファイルのみ、`git diff --check` PASS。repo内`node_modules` symlinkなし。
