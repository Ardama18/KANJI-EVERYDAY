---
id: S-13
feature: ai-card-management-undo
type: design
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 14
parent_story: S-10
---

# 設計書: AIカード管理・取り消し

## 1. 設計方針

S-10/S-11の既存契約を拡張し、本人所有の確定済みAI private cardだけを管理する。正本優先順位はAccepted ADR-007/008、S-13 requirements/story、Epic/Issueとし、Issue #14の8 ACに不要な機能は追加しない。

- 既存migrationは変更せず、S-13の変更は1本のforward migrationで追加する。
- 通常のread/mutationはauthenticated Supabase session clientを使用し、service roleは使用しない。
- Server境界のowner確認と入力検証に加え、RLSとDB trigger/RPCを最終防衛線にする。
- 「学習中」はactive `study_sessions`だけを意味する。`review_states`の存在はundo拒否条件にしない。
- DELETEはtombstoneを残し、`user_edited_at`を設定しない明示例外とする。
- Storage objectの物理削除はS-11 cleanupへ委譲し、管理transaction内では行わない。

## 2. 変更境界

### 2.1 UI / Server

- `frontend/app/(auth)/ai/cards/page.tsx`: feature flag、認証、初期一覧取得を行うServer Component。
- `frontend/src/components/ai-card-management/`: 一覧、filter、cursor追加読込、編集、選択、削除確認、undo確認を担うClient Component群。
- `frontend/src/actions/ai-card-management-actions.ts`: 一覧・編集・削除・undoのServer境界。各入口でflag、`auth.getUser()`、入力validationを通す。
- `frontend/src/lib/ai-card-management/`: DTO、cursor、JST日付filter、validation、安全なerror mappingを純粋関数として保持する。
- `frontend/src/lib/env.ts`: `AI_CARD_MANAGEMENT_ENABLED === "true"`だけを有効とする。
- `frontend/middleware.ts`: `/ai`を既存の保護routeと同じ認証境界へ含める。page/action自身の認証も省略しない。
- 既存authenticated navigationへ管理導線を追加し、flag offでは非表示にする。

一覧DTOはcard ID、front/back、skill、pattern、created/updated、source、batch、owner deck/tag、illustration表示状態だけを返す。Storage path、provider body、raw SQL errorを返さず、画像はowner検証後の短命signed URLを用いる。

### 2.2 Database

`supabase/migrations/<timestamp>_s13_ai_card_management_undo.sql`を追加する。既存S-10/S-11 migrationは編集しない。migrationは以下を同時に導入・置換する。

- owner限定一覧のquery/RPCと必要なpartial/index support。
- 1〜100件のatomic bulk delete wrapper/internal primitive。
- 個別削除を同じ強いprimitiveへ収束させる既存`delete_private_card[_internal]`の置換。
- AI由来判定を必須化した`update_imported_card`、`set_card_decks`、`set_card_tags`、`set_card_illustration`のwrapper/internal置換。
- S-11 lifecycle lockを削除前に取得する`undo_import_internal`の置換。
- 直接cards DMLでもactive guard、review reset、編集印、tombstone、共有画像参照管理を迂回できないtrigger/shared predicateの整合。
- 新規RPCのrevoke/grant、function owner、固定`search_path`。

`frontend/src/types/database.ts`はlocal schemaから再生成し、`frontend/src/types/database.typecheck.ts`へS-13 public wrapperの型契約を追加する。

## 3. 認証・owner・AI由来境界

### 3.1 AI管理対象の正本

現存する管理対象cardは、次を全て満たすものに限る。

1. `cards.visibility = 'private'`かつ`cards.owner_user_id = actor_id`。
2. `ai_import_items.owner_user_id = actor_id`、`status = 'finalized'`、`result_card_id = cards.id`。
3. 親`ai_import_batches.owner_user_id = actor_id`、`source IN ('app_ai', 'remote_mcp')`。

public Seed、直接作成private card、別owner、failed/deleted/undone itemは対象外である。unknown/other/publicは同じ404相当へ正規化する。

### 3.2 RPC security

public wrapperはPostgREST v14が設定するpacked `request.jwt.claims` JSONの`role = authenticated`とUUID形式の`sub`からactorを導出し、caller指定のowner IDは受理しない。missing / malformed claims、role不一致、UUIDでない`sub`は未認証として拒否する。SECURITY DEFINER internalはmigration owner、`SET search_path = pg_catalog, pg_temp`、完全修飾名を使用する。PUBLIC/anon/authenticated/service_roleからinternal EXECUTEをrevokeし、authenticatedにはwrapperだけをgrantする。

既存管理RPCはAI itemの存在を必須化していない経路があるため、新規RPCだけを追加しない。forward migrationで既存wrapper/internalを置換して上記predicateを共有し、非AI private cardを管理できる旧経路を残さない。個別削除もbulk primitiveの1件呼び出しに収束させる。

### 3.3 RLSと直接DML

RLSは既存owner-private policyを維持する。ADR-007互換のためauthenticated ownerによる`cards`直接UPDATE/DELETEを一律revokeしない。その代わり、RPC外でも次をtriggerで強制する。

- public/cross-owner mutation拒否。
- active session対象cardの変更拒否。
- content実変更時だけ全`review_states`削除。
- content/illustration/relation実変更時の`user_edited_at`初回設定。
- DELETE時のtombstone化と`user_edited_at`非設定。
- illustration lifecycle guard/reference tracking。

`deck_cards`と`card_tags`の直接mutation revokeは維持し、relation変更は検証済みRPCだけを通す。DB integration testで既存RPCと直接DML双方を検証し、迂回路がないことを契約化する。

## 4. 一覧・cursor・filter

基準queryはAI管理対象をcard単位で返す。deck/tag filterは`EXISTS`を用い、relation joinによる重複rowをpage対象にしない。

- order: `cards.created_at DESC, cards.id DESC`
- default limit: 20、許可範囲: 1〜100
- queryは`limit + 1`件を取得し、超過時だけ末尾から`nextCursor`を作る。
- cursorは`created_at`と`id`をversion付きJSONとしてServer側でencode/decodeするopaque値。次ページ条件は`(created_at, id) < (cursor_created_at, cursor_id)`。
- 不正・改ざんcursorはvalidation errorとし、内部値をlogしない。
- `deckId`、`tagId`、`source`、`createdFrom`、`createdTo`はAND条件。
- deck/tagは先にowner scopeで存在確認し、unknown/otherを同じ404へする。
- dateはJSTの`YYYY-MM-DD`をUTC半開区間へ変換し、from 00:00以上、to翌日00:00未満とする。

必要indexは実行計画を確認して最小追加する。候補はowner private cardsの`(owner_user_id, created_at DESC, id DESC)` partial indexと、finalized AI itemから`result_card_id`/owner/batch sourceへ到達するindexである。

## 5. 編集transaction

全mutationは対象cardを検証後にrow lockし、`expectedUpdatedAt`でoptimistic conflictを検出する。存在/owner/AI由来確認をactive session確認より先に行い、別owner session情報を漏らさない。

- content: S-10正規化と全項目validation後、実変更時だけcardと`card_key`を更新する。既存`reset_review_state_on_content_change` triggerにより全`review_states`を削除し、Newへ戻す。no-opでは何も更新しない。
- illustration: owner-ready既存illustrationへの付け替え/解除のみ。review stateは維持し、実変更時だけ編集印を付ける。
- tag: 正規化済み0〜10件をowner scopeで作成/再利用し、集合を原子的に置換する。別owner IDは404。no-opでは更新しない。
- deck: owner private deck集合へ原子的に置換する。通常編集で空deckを自動削除しない。review stateは維持する。

## 6. active session guard

activeは`study_sessions.finished_at IS NULL`かつ対象cardが次のいずれかに含まれる状態である。

- `current_card_id`
- `queue_due`
- `queue_learn`
- `queue_new`
- `queue_retry`

既存`ai_session_card_ids`/`ai_assert_card_inactive`を共有し、UUIDでないqueue値は無視する。content、illustration、tag、deck、個別/複数DELETE、undoの全てで同一transaction中に確認する。1件でも該当すれば全操作をrollbackし、allowlist済みsession ID/deck IDだけを409 detailとして返す。`review_states`の存在はこのguardにもundo拒否にも使用しない。

## 7. atomic bulk delete

入力は重複しない1〜100件の`{cardId, expectedUpdatedAt}`とする。処理順は次の通り。

1. 入力全件を検証し、UUID昇順に正規化する。
2. 全cardsをUUID昇順でlockする。不足、public、cross-owner、非AI、timestamp不一致が1件でもあればmutation前に失敗する。
3. 全cardのactive sessionを確認し、該当があれば全体を失敗する。
4. 対象illustration IDの完全集合を作り、S-11 canonical helperでillustrations UUID昇順、`ai_illustration_objects` UUID昇順にlockする。
5. 全cardを1transactionでDELETEする。既存tombstone triggerを通し、`ai_enable_internal_context()`による抑制は使わない。
6. 削除件数を返す。

全件検証後までDELETEしないため、unknown/owner/AI/active/conflictのどの失敗でもcard、item、review/relation、trackingの増減は0である。DELETEは`ai_import_items.status='deleted'`、`result_card_id=NULL`、`deleted_card_id`、`deleted_at`を記録するが、`user_edited_at`を新規設定しない。

## 8. 共有画像のlockとcleanup

illustration付け替え、個別/複数DELETE、undoは常に次の集合lock順を守る。

1. cards UUID昇順
2. illustrations UUID昇順
3. `ai_illustration_objects` UUID昇順

複数cardを扱うときは1件ずつ交互にlockせず、対象集合を確定して層ごとにlockする。S-11の`ai_s11_lock_illustration_lifecycle(uuid[])`とreference triggerを再利用する。参照2→1はready維持、1→0だけを`delete_pending`とする。Storage削除はtransaction外の既存cleanupがowner/path/lease/reference 0を再確認して行う。

## 9. batch undo

`undo_import_internal`をforward migrationで置換し、既存のowner、監査、冪等result、auto deck契約を保ちながらS-11 lock順を追加する。

1. owner/sourceを確認後、S-11 workerと同じく対象batchの`ai_import_concept_jobs`を最初にlockする。`queued` / `processing` jobが1件でもあれば副作用0のconflictとして全体拒否する。
2. tombstone itemを除く現存cardを確定し、cards→illustrations→trackingの集合lockを取得した後にbatch/itemsをlockして対象集合を再検証する。既にundoneなら保存済み`undo_result`を返す。
3. tombstoneは拒否・削除対象外でskip件数へ含める。`user_edited_at IS NOT NULL`のitemが1件でもあれば`CARD_MODIFIED`で全体拒否する。
4. 現存cardがactive session対象なら`ACTIVE_SESSION`で全体拒否する。
5. cardとbatch由来の関連を削除し、owner内で不要になったtagを整理する。auto-created deckは空の場合だけ削除し、手動deckや他batch利用deckは保持する。
6. non-deleted itemとterminal `succeeded` / `failed` jobを同一transactionで`undone`へ遷移させ、claim / terminal fieldsを解放する。
7. batchをundoneとして監査保持し、冪等な結果を保存する。

`review_states`が存在するだけでは拒否しない。本文編集時のreview reset契約は別途維持する。

## 10. error / rollback flag

Server側でDB errorをsafe codeへ変換し、raw message/stackをclientへ渡さない。unknown/public/cross-ownerのcard/deck/tag/illustration/batchは同じ404形状、active/conflictは安全な409、validationは400相当とする。active detailはsession ID/deck IDだけを許可する。

flag offではnavigationを隠し、page/read/mutationを404相当にしてDBへ触れない。migrationや既存dataは保持し、AI作成、status、worker、cleanup、deck/studyは停止しない。

## 11. テスト設計

### 11.1 Unit / component (Vitest)

- cursor encode/decode、tuple paging、limit 1/20/100、不正cursor。
- JST date半開区間、filter AND、UUID/source/input validation。
- DTOとsafe 404/409 mapping、active detail allowlist、flag exact true。
- 一覧のloading/empty/error/追加読込、編集no-op、bulk/undo確認、pending二重送信、keyboard/focus。
- Server Actionのflag/auth/owner前処理、成功・validation・404・409・DB failure。

### 11.2 DB integration / migration

S-10 DB testkit/jobsを再利用し、S-13用Vitest suiteを追加する。

- fresh chain、S-12 schemaからのupgrade、意図的failureでforward migrationを検証する。
- anon/owner/other/service actorとwrapper/internal grants、RLS、unknown/public同形を検証する。
- 新旧全管理RPCで非AI private cardを拒否し、既存RPC迂回を残さない。
- 直接cards DMLでactive guard、content reset、relation keep、編集印、DELETE tombstone例外を検証する。
- bulk 1/100、重複、timestamp/owner/AI/active失敗時の全snapshot不変を検証する。
- active current + 4 queuesとinvalid queue値を検証する。
- undoのedited拒否、active拒否、review_statesのみでは許可、tombstone skip、再送同値、auto deck保持/削除を検証する。
- 共有object 2→1、1→0、cleanup前再attach、およびedit/delete/undo並行時のlock順・deadlockなし・reference count非負を検証する。

### 11.3 Contract / 実ブラウザ

Vitest contract testでServer境界からDB RPC/DTO/error mappingまでをfaked clientまたは隔離Supabaseで検証する。Playwrightや未導入`test:e2e`は仮定・追加しない。

実装後は既存開発serverを実ブラウザで開き、owner journeyとして一覧/filter/cursor、4種編集、bulk delete、undo、404、flag offをdesktopと360x800付近のmobileで確認する。URL、git SHA、viewport、接続したDB/HTTP/Storage/cleanup境界、未検証境界を証跡へ記録する。

## 12. ACトレーサビリティ

| AC | 設計境界 | 主な検証 |
|---|---|---|
| AC-1 AI owner private限定 | 3, 4 | actor/RLS matrix、非AI・public拒否、route direct access |
| AC-2 cursor pagination | 4 | 同時刻、limit、全page union、filter AND |
| AC-3 contentだけNew | 5, 3.3 | 4 content列reset、no-op/image/tag/deck keep、直接DML |
| AC-4 active session guard | 6 | current+4 queues、全mutation rollback、安全detail |
| AC-5 未編集batch undo | 8, 9 | card/relation/tag、last reference、auto deck、cleanup handoff |
| AC-6 edited/active/job拒否 | 6, 9 | `user_edited_at`、active、queued/processing jobで全snapshot不変。review_statesのみは拒否しない |
| AC-7 再送・削除skip | 7, 9 | tombstone skip、保存result同値、副作用増分0 |
| AC-8 存在秘匿 | 3, 10 | card/deck/tag/illustration/batchのunknown/other/public同形 |

## 13. 実装対象候補

- `supabase/migrations/<timestamp>_s13_ai_card_management_undo.sql`
- `frontend/src/types/database.ts`
- `frontend/src/types/database.typecheck.ts`
- `frontend/src/lib/env.ts`
- `frontend/middleware.ts`
- `frontend/app/(auth)/ai/cards/page.tsx`
- `frontend/src/actions/ai-card-management-actions.ts`
- `frontend/src/lib/ai-card-management/*`
- `frontend/src/components/ai-card-management/*`
- `frontend/package.json` / `frontend/vitest.config.ts`（既存VitestへのS-13 suite登録のみ）
- `specs/stories/S-13-ai-card-management-undo/tests/*`（unit/DB integration/contract）

## 14. 未解決事項

実装を停止する未解決事項はない。indexの最終形だけは隔離DBの`EXPLAIN`で確認し、要件を変えずに最小構成を選ぶ。
