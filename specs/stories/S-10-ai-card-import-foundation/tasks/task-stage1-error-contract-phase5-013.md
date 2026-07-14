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

- [x] `frontend/src/lib/ai-import/schema.ts`
- [x] `frontend/src/lib/ai-import/canonical-request.ts`
- [x] `frontend/src/lib/ai-import/errors.ts`
- [x] `frontend/src/lib/ai-import/errors.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `UT-SCHEMA-01〜10`を失敗テストへ置換し、shape全件issue、1/50/51、client ID、R1/W1、Han、pair、tag、deck/image union、trusted field拒否を検証する。
- [x] `errors.test.ts`へP1000〜P1008/42501/named 23505/unknown、owner存在秘匿、safe detail/redactionの失敗テストを追加する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-SCHEMA"
npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts
```

### 2. Green Phase

- [x] `unknown`を再帰的に絞り込み、成功時だけcase保持表示値/normalized tag/card key/skillを持つbranded resultを返す。
- [x] items 1..50、text 1..200、client/concept ID 1..64、tag 0..10かつ1..30、正規化後重複、concept/pattern pairを全件収集する。
- [x] R1 front/W1 backのHanをUnicode Script相当で検証しBMP外Hanを許可する。
- [x] deck `id|name|create`とimage `none|ai|upload`を排他的unionにする。
- [x] source/quota免除/未知fieldを拒否し、client input、trusted context、DB wrapper argsを別型にする。
- [x] error mapperはDesignの11 codeを区別し、named constraintだけ分類、unexpectedだけ`INTERNAL_ERROR`にする。

### 3. Refactor Phase

- [x] schema/normalization/canonicalで同じ正規化・上限定数を重複定義せず循環依存を避ける。
- [x] `any`、`as`多用、環境変数/DB/network参照、token/request/card本文/SQL/stack露出を除く。

## 完了条件

- [x] `UT-SCHEMA-01〜10`がPASSし、S-10受入Unit 32/32件が実テスト化される。
- [x] mapper補助Unitが全安定code、named duplicate、unknown fallback、redactionをPASSする。
- [x] 不正入力ではnormalized branded resultを返さず、全issueにfield path/ruleがある。
- [x] TypeScript client requestからtrusted fieldを構築できない。
- [x] `npm --prefix frontend run typecheck`がPASSする。
- [x] 動作確認レベルL1を満たす。

## 注意事項

- DB lookupが必要なowner重複/deck/upload/quotaはpure schemaへ混ぜない。
- adapter、Route Handler、UI、Remote MCP transportを追加しない。

## 完了証跡（2026-07-14）

- Red: `schema.ts` / `errors.ts`未実装により、UT-SCHEMA suiteとmapper suiteの失敗を確認した。
- Schema: UT-SCHEMA 10/10件PASS。shape/未知fieldを全件収集し、全issueへpath/ruleを付与する。items/text/client・concept ID/tag/pair/Han/排他的union/batch card-key重複を検証する。
- 成功契約: 表示値のcaseを保持し、normalized tag、R1/W1 skill、既存`computeCardKey`によるSHA-256 keyを持つruntime symbol branded resultだけを返す。
- 型境界: `ClientImportRequestInput`、`TrustedImportContext`、`CommitImportWrapperArgs`を分離し、client schemaはsource/owner/quota/reservation/未知fieldを拒否する。
- Mapper: 補助Unit 6/6件PASS。P1000〜P1008/42501、named `cards_private_owner_card_key_uidx`だけの23505、unknown fallback、safe detail allow-list、owner/resource秘匿とredactionを確認した。
- 回帰: S-10 Unit 32/32件PASS、frontend non-DB 161/161件PASS、lint PASS（89 files）、typecheck PASS、`git diff --check` PASS。
- 静的監査: runtime validator依存、`any`、環境変数、DB/networkアクセスを追加していない。productionの`as`は安定code tupleの`as const` 1件だけである。

### DB detail / wrapper型差し戻し対応

- Red: P1000の実Postgres detail JSON文字列`{"field":"items","rule":"invalid"}`でpathが欠落するmapper testと、nullable reservation keyを拒否するcompile契約が失敗することを確認した。
- P1000: `detail.path`を優先し、DBの`detail.field`をfallbackとして公開`path/rule`へ正規化する。SQL本文など未許可fieldは引き続き破棄する。
- P1002: `itemId`をUUID限定せず、`SAFE_ID_PATTERN`かつ1〜64文字のclient item IDとしてallow-listする。UUIDも同じ安全ID契約に含まれる。
- Wrapper型: `CommitImportWrapperArgs.cardReservationKey`を非NULLの`string`に変更し、UT-SCHEMA-10内のcompile契約で保証する。
- 再回帰: mapper 6/6件、UT-SCHEMA-10、S-10 Unit 32/32件、frontend non-DB 161/161件、lint（89 files）、typecheckがすべてPASSした。
