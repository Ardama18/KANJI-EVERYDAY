---
id: S-13
feature: ai-card-management-undo
type: plan
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 14
parent_story: S-10
---

# 実装計画: AIカード管理・取り消し

## 1. 実行方針

本計画は`requirements.md`と`design.md`を実装へ移す単一情報源である。Accepted ADR-007/008を優先し、Issue #14の8 ACに必要な範囲だけを実装する。

- 既存migrationは編集せず、S-13 forward migrationを追加する。
- 実装順はDatabase不変条件 → generated types → Server境界 → UI → 検証とする。
- Playwright、`test:e2e`、未導入packageを前提にしない。
- `$ar-core:ship`、PR、merge、issue close、deploy、公開環境migrationは本計画の対象外とする。

## 2. Phase 1: S-13 forward migrationとDB不変条件

### 対象

- `supabase/migrations/<timestamp>_s13_ai_card_management_undo.sql`（新規）
- 参照のみ: S-02、S-10、S-11、S-12の既存migration

### 作業

1. AI管理対象の共有predicateを定義する。
   - actor所有private card。
   - owner一致の`ai_import_items.status='finalized'`かつ`result_card_id=cards.id`。
   - 親batch sourceが`app_ai | remote_mcp`。
   - public、cross-owner、直接作成private card、deleted/undone/failed itemを除外する。
2. owner限定一覧query/RPCを追加する。
   - orderは`cards.created_at DESC, cards.id DESC`。
   - `limit + 1`とstrict tuple cursorを使用する。
   - deck/tagは`EXISTS`で絞り、relation fan-outでcardを重複させない。
   - source/JST日付を含む全filterをAND適用する。
   - 隔離DBの`EXPLAIN`を根拠に最小indexを追加する。
3. 1〜100件のatomic bulk delete wrapper/internal primitiveを追加する。
   - 重複なし`cardId + expectedUpdatedAt`を受理する。
   - 全cardsをUUID順でlockし、owner/private/AI由来/timestamp/activeを全件検証してからDELETEする。
   - 1件でも失敗すればcard/item/relation/review/trackingの変更0を保証する。
   - `ai_enable_internal_context()`でtombstone triggerを抑制しない。
4. 個別削除を同じprimitiveの1件処理へ収束させ、既存`delete_private_card[_internal]`の弱い経路を残さない。
5. `update_imported_card`、`set_card_decks`、`set_card_tags`、`set_card_illustration`の既存wrapper/internalをforward replacementし、全経路でAI由来predicateを必須化する。
6. `undo_import_internal`をforward replacementする。
   - S-11 workerと同じくconcept jobsを先にlockし、`queued` / `processing` jobがあれば全snapshot不変で拒否する。
   - tombstone itemは拒否・削除対象外としてskipする。
   - それ以外の拒否は非tombstone itemの`user_edited_at`と現存cardのactive sessionに限定する。
   - `review_states`の存在確認を追加しない。
   - terminal jobとnon-deleted itemを同一transactionで`undone`へ揃え、保存済みresult再送、監査保持、auto-created deckを空のときだけ削除する既存契約を維持する。
7. active guardをcontent/illustration/tag/deck/個別・複数DELETE/undoの全経路へ適用する。
   - `current_card_id`と`queue_due/learn/new/retry`を確認する。
   - existence/owner確認後に判定し、safe detailはsession ID/deck IDだけにする。
8. 共有画像操作の集合lockを固定する。
   - cards UUID順 → illustrations UUID順 → `ai_illustration_objects` UUID順。
   - bulk deleteとundoは全対象集合を層ごとにlockする。
   - 2→1はready、1→0だけ`delete_pending`。物理削除はS-11 cleanupへ委譲する。
9. 直接DMLの不変条件を確認・補強する。
   - ADR-007互換のowner cards直接DMLを一律revokeしない。
   - triggerでactive guard、content-only review reset、実変更の編集印、DELETE tombstone例外、共有画像trackingを強制する。
   - `deck_cards`/`card_tags`直接mutation revokeは維持する。
10. security hardeningを既存規約へ合わせる。
    - wrapperはJWT authenticated/subからactorを導出する。
    - internalはmigration owner、固定`search_path`、完全修飾名。
    - PUBLIC/anon/authenticated/service_roleからinternal EXECUTEをrevokeし、authenticatedへwrapperのみgrantする。

### 完了条件

- 新規/既存RPC/直接DMLのいずれからもowner、AI由来、active、tombstone、review reset、共有画像不変条件を迂回できない。
- bulk deleteとundoがall-or-nothingかつcanonical lock順である。
- 既存migrationファイルに変更がない。

## 3. Phase 2: Database型とDB contract

### 対象

- `frontend/src/types/database.ts`
- `frontend/src/types/database.typecheck.ts`

### 作業

1. Phase 1 migration適用後のlocal schemaからDatabase型を再生成する。
2. 一覧、bulk delete、置換したmanagement/undo wrapperの引数・戻り値を確認する。
3. `RequiredPublicWrapper`相当のcompile-time assertionへS-13 wrapperを追加する。
4. UI用の手書きDTOとgenerated DB rowを分離し、Storage path/raw errorをclient contractへ混入させない。

### 完了条件

- ServerコードでRPC名/引数/戻り値のcastや`any`を使わず型解決できる。
- type assertionが旧wrapperを含む全公開契約の存在を保証する。

## 4. Phase 3: Server boundary / validation

### 対象

- `frontend/src/actions/ai-card-management-actions.ts`（新規）
- `frontend/src/lib/ai-card-management/types.ts`（新規候補）
- `frontend/src/lib/ai-card-management/validation.ts`（新規候補）
- `frontend/src/lib/ai-card-management/cursor.ts`（新規候補）
- `frontend/src/lib/ai-card-management/errors.ts`（新規候補）
- `frontend/src/lib/ai-card-management/service.ts`（必要時のみ）
- `frontend/src/lib/env.ts`
- `frontend/middleware.ts`

### 作業

1. exact `true`の`AI_CARD_MANAGEMENT_ENABLED` helperを追加する。
2. `/ai`を既存認証middleware境界へ追加する。
3. 各read/mutation入口でflag → `auth.getUser()` → validation → owner scoped DB callの順を共通化する。
4. cursorをServer専用opaque formatでencode/decodeし、不正値をvalidation errorへする。
5. limit、UUID、source、JST日付、content、tag、deck、illustration、bulk 1〜100、重複、expected timestampを副作用前に検証する。
6. 一覧、content/illustration/tag/deck編集、個別/複数DELETE、undoのactionを実装する。
7. authenticated session clientだけを使用し、service roleを通常owner CRUDへ使わない。
8. signed image URLはowner検証後だけ発行し、DTOからStorage path/bytesを除外する。
9. unknown/public/cross-ownerを同じ404形状へ、active/conflictをsafe 409へ、validationを400相当へmapする。active detailはsession ID/deck IDだけをallowlistする。
10. flag offではread/mutationともDBへ触れず404相当にする。

### 完了条件

- UIがDB clientやraw row/errorへ直接依存しない。
- 未認証、flag off、cross-owner、invalid入力でmutation 0が確認できる。

## 5. Phase 4: UI

### 対象

- `frontend/app/(auth)/ai/cards/page.tsx`（新規）
- `frontend/src/components/ai-card-management/*`（新規）
- 既存authenticated navigation component（実装時に`rg`で特定し、最小変更）
- 必要なpage/component test

### 作業

1. Server Componentでflagと認証を確認し、初期一覧を取得する。
2. owner AI card一覧、20件初期表示、次cursor読込、deck/tag/source/JST登録日filterを提供する。
3. content、既存owner-ready illustration、tag、deck編集を提供する。
4. 1ページ内の1〜100件選択、削除確認、atomic bulk deleteを提供する。
5. batch undoの影響と拒否理由を安全な情報だけで表示する。
6. loading、empty、filter 0、pending、validation、404、conflict、errorを区別し、pending中の二重送信を防ぐ。
7. flag offで導線を非表示にし、route直アクセスも404相当にする。
8. mobile 320〜360px/desktopで横scrollを防ぎ、48px相当touch target、visible focus、semantic label、keyboard操作、色以外の状態表現を実装する。

### 完了条件

- AC-1〜8のowner journeyをUIから実行できる。
- 危険操作は確認後にだけ実行され、失敗時に選択/入力を安全に回復できる。

## 6. Phase 5: Unit / component / Server contract tests

### 対象

- `frontend/src/lib/ai-card-management/*.test.ts`
- `frontend/src/actions/ai-card-management-actions.test.ts`
- `frontend/src/components/ai-card-management/*.test.tsx`
- `frontend/src/app/(auth)/ai/cards/page.test.tsx`またはrepo既存配置規約に合うpage test
- `frontend/src/types/database.typecheck.ts`

### 作業と対応

- cursor/limit/同一timestamp/filter AND/JST日付: AC-2。
- AI-only DTO、auth/owner/404、flag off: AC-1/8。
- content実変更/no-op、relation編集でreview stateを触らないServer contract: AC-3。
- active safe detailと全mutation error mapping: AC-4/6。
- bulk入力、削除/undo二重送信、tombstone skip/result DTO: AC-5/7。
- loading/empty/error/pending、keyboard/focus、mobile向けcomponent behavior: UI非機能要件。

既存Vitest、Testing Library、faked Supabase clientの規約を使う。Playwrightを追加しない。

### 完了条件

- 追加unit/component/contract testがpassし、型assertionがpassする。

## 7. Phase 6: DB integration / migration / concurrency tests

### 対象

- `specs/stories/S-13-ai-card-management-undo/tests/helpers/*`（S-10 testkit/jobsを再利用または最小adapt）
- `specs/stories/S-13-ai-card-management-undo/tests/ai-card-management-undo.int.test.ts`
- `specs/stories/S-13-ai-card-management-undo/tests/ai-card-management-undo.contract.test.ts`
- `frontend/vitest.config.ts`
- `frontend/package.json`（S-13 suite用scriptが必要な場合だけ）

### DB test matrix

1. forward migration: fresh、S-12まで適用済みschemaからupgrade、意図的failure/rollback。
2. auth/RLS: anon/owner/other/service、wrapper/internal grants、public/unknown同形。
3. AI限定: 新旧全management RPCと直接アクセスでAI/non-AI/public/cross-owner matrix。
4. review/edit: 4 content列それぞれreset、no-opとillustration/tag/deckでkeep、transaction failure rollback。
5. direct DML: active guard、content reset、編集印、DELETE tombstone非編集例外、relation direct write拒否。
6. active: current + due/learn/new/retry、invalid queue値、単独/bulk/undo全snapshot不変。
7. bulk: 1件/100件、重複、missing、owner、AI、timestamp、active失敗、成功件数、全件原子性。
8. undo: queued/processing job拒否と全snapshot不変、terminal job/itemのundone整合、edited拒否、active拒否、`review_states`だけでは許可、tombstone skip、同一result再送、auto deck empty/retained、不要tag。
9. illustration: 2→1 ready、1→0 delete_pending、cleanup前reattach、cleaning/deleted attach拒否。
10. concurrency: edit/delete/undo/cleanup交差でcards→illustrations→tracking順、deadlockなし、reference count非負、部分commitなし。

isolated DB URLがない場合はDB suiteを成功扱いにせず、未実行の境界・必要な接続条件を明記する。接続先不明のDBへreset/applyしない。

### 完了条件

- fresh/upgrade/atomicity/RLS/concurrencyの実行証拠が揃う、または外部前提不足が明確に未検証として記録される。

## 8. Phase 7: 全体品質ゲート

リポジトリルートから次を実行する。

```bash
npm --prefix frontend run check
npm --prefix frontend run build
```

S-13 DB scriptsをPhase 6で追加した場合だけ、その実名でintegration/fresh/upgrade/failureを実行する。存在未確認のscript名を実行しない。

### 完了条件

- lint、typecheck、Vitestが0 error。
- App Router/Server境界変更を含むproduction buildが成功する。
- DB suite結果と未検証外部境界が記録される。

## 9. Phase 8: 実ブラウザ確認

Playwrightを仮定せず、`frontend/`の既存dev serverを実ブラウザで確認する。利用可能な外部browser runnerがある場合も、導入なしで使用できる範囲に限る。

### 証跡へ記録する項目

- URL、git SHA、日時。
- desktop viewportと360x800付近のmobile viewport。
- 接続したauth/DB/HTTP/Storage/cleanup境界。
- flag on/off、owner/other owner actor。
- 未接続・未検証の外部境界。

### journey

1. owner AI cardだけの一覧、同時刻cursor、複合filter、empty/error。
2. content編集でNew、illustration/tag/deck編集でreview維持。
3. active current/queue cardの編集・削除拒否とsafe detail。
4. 複数選択削除の成功と1件失敗時の全体不変。
5. 未編集かつ稼働中jobなしのbatch undo、edited/active/queued/processing拒否、tombstone skip、再送同値。
6. public/cross-owner/unknown card/deck/tag/illustration/batchの同じ404体験。
7. 共有画像2→1/1→0のDB statusとcleanup handoff。Storage物理削除未確認をDB成功だけで完了扱いにしない。
8. keyboard、focus、touch target、mobile横scroll、pending二重送信防止。

### 完了条件

- AC-1〜8のブラウザ証跡が揃い、未検証境界が明示される。

## 10. AC-to-phase対応

| AC | 実装Phase | 自動検証 | 実ブラウザ |
|---|---|---|---|
| AC-1 AI owner private限定 | 1, 3, 4 | Unit/Server contract、DB actor/RLS/AI matrix | owner/other/public一覧・直アクセス |
| AC-2 cursor pagination | 1, 3, 4 | cursor/filter unit、DB同一timestamp union | 複合filterと追加読込 |
| AC-3 contentだけNew | 1, 3, 4 | DB trigger/直接DML、action/component | contentとrelation各編集 |
| AC-4 active guard | 1, 3, 4 | current+4 queues、全mutation rollback | safe conflict表示 |
| AC-5 未編集undo | 1, 3, 4 | DB job/item/card/relation/tag/image/auto deck | undo確認とcleanup handoff |
| AC-6 edited/active/job拒否 | 1, 3 | `user_edited_at`/active/queued/processing snapshot不変。review_statesのみは成功 | 拒否理由と副作用0 |
| AC-7 再送・削除skip | 1, 3, 4 | tombstone skip、保存result同値 | 個別削除後undo再送 |
| AC-8 存在秘匿 | 1, 3, 4 | ID種別ごとのunknown/other/public同形 | route/actionの同じ404 |

## 11. 実装完了ゲート

- designのDatabase/UI/Server/型境界が計画外変更なく実装されている。
- 既存RPCと直接DMLを含め、AI由来・owner・active・tombstone・review reset・共有画像不変条件の迂回路がない。
- bulk deleteとundoのatomicity、canonical lock順、冪等性がDB integrationで確認されている。
- unit/component/Server contract/DB migration・integration・concurrencyが成功し、`check`と`build`が成功している。
- 実ブラウザdesktop/mobile証跡と、Storage cleanup等の未検証境界が区別されている。
- 実装完了後はcode-reviewer → 指摘修正 → `$ar-core:quality-fixer`の順で品質サイクルを実施する。ship/PR/deployは別指示がない限り行わない。
