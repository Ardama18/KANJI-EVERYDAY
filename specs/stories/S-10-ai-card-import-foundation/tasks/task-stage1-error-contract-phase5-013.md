# タスク: Stage 1 schemaとTypeScript error contractを実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 5
- 依存: `tasks/task-undo-lock-matrix-phase4-012.md`（Phase 4 quality approved）
- 提供成果物: `schema.ts`, `errors.ts`, UT-SCHEMA 10件、mapper補助Unit
- 関連AC: AC-02, AC-06, AC-09、UT-SCHEMA-01〜10
- サイズ: 標準（4-5ファイル）

## 実装内容

外部runtime validatorを追加せず、`unknown`入力を全件検証してfield path issueを返し、成功時だけbranded normalized requestを生成するStage 1 schemaを実装する。client schema/canonical requestからtrusted fieldを排除し、DB SQLSTATE/constraintを11の安定codeへ安全に写像する。

## 対象ファイル

- [ ] `frontend/src/lib/ai-import/schema.ts`
- [ ] `frontend/src/lib/ai-import/canonical-request.ts`
- [ ] `frontend/src/lib/ai-import/errors.ts`
- [ ] `frontend/src/lib/ai-import/errors.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `UT-SCHEMA-01〜10`を失敗テストへ置換し、shape全件issue、1/50/51、client ID、R1/W1、Han、pair、tag、deck/image union、trusted field拒否を検証する。
- [ ] `errors.test.ts`へP1000〜P1008/42501/named 23505/unknown、owner存在秘匿、safe detail/redactionの失敗テストを追加する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-SCHEMA"
npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts
```

### 2. Green Phase

- [ ] `unknown`を再帰的に絞り込み、成功時だけcase保持表示値/normalized tag/card key/skillを持つbranded resultを返す。
- [ ] items 1..50、text 1..200、client/concept ID 1..64、tag 0..10かつ1..30、正規化後重複、concept/pattern pairを全件収集する。
- [ ] R1 front/W1 backのHanをUnicode Script相当で検証しBMP外Hanを許可する。
- [ ] deck `id|name|create`とimage `none|ai|upload`を排他的unionにする。
- [ ] source/quota免除/未知fieldを拒否し、client input、trusted context、DB wrapper argsを別型にする。
- [ ] error mapperはDesignの11 codeを区別し、named constraintだけ分類、unexpectedだけ`INTERNAL_ERROR`にする。

### 3. Refactor Phase

- [ ] schema/normalization/canonicalで同じ正規化・上限定数を重複定義せず循環依存を避ける。
- [ ] `any`、`as`多用、環境変数/DB/network参照、token/request/card本文/SQL/stack露出を除く。

## 完了条件

- [ ] `UT-SCHEMA-01〜10`がPASSし、S-10受入Unit 32/32件が実テスト化される。
- [ ] mapper補助Unitが全安定code、named duplicate、unknown fallback、redactionをPASSする。
- [ ] 不正入力ではnormalized branded resultを返さず、全issueにfield path/ruleがある。
- [ ] TypeScript client requestからtrusted fieldを構築できない。
- [ ] `npm --prefix frontend run typecheck`がPASSする。
- [ ] 動作確認レベルL1を満たす。

## 注意事項

- DB lookupが必要なowner重複/deck/upload/quotaはpure schemaへ混ぜない。
- adapter、Route Handler、UI、Remote MCP transportを追加しない。

