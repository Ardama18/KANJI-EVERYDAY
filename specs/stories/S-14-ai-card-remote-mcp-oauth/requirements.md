---
id: S-14
feature: ai-card-remote-mcp-oauth
type: requirements
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 11
parent_epic: 9
parent_story: S-10
---

# 要件定義書: Supabase OAuth・Remote MCP

## 1. 概要

### 1.1 目的

Claude、ChatGPTなどの外部AIが、既存ユーザーの明示同意を得た場合だけ、既存のAIカードimport・status・管理契約を通じて本人所有のR1/W1 private cardを登録・管理できるRemote MCPを提供する。外部入口を追加しても、認証済みユーザーJWT、RLS、owner-scoped RPCを正本とし、service roleでowner境界を代替しない。

### 1.2 正本と前提

- Accepted ADR-007の共有schema、canonical hash、preview HMAC、冪等性、`source='remote_mcp'`、owner/RLS/error契約を継承する。
- Accepted ADR-008のtransactional async commit、owner-scoped status、concept job、safe error、Queue/Storage lifecycleを変更しない。
- Accepted ADR-009/010のprovider境界、preview後編集拒否、status復元、feature flag分離を壊さない。MCPはアプリ内OpenAI生成を再実装しない。
- S-13のauthenticated JWT actor、AI private card限定一覧・管理RPC、active-session guard、review reset、bulk delete、undo契約を再利用する。
- 現行 `frontend/package.json` にMCP SDKはなく、OpenAI SDKもない。依存追加の要否はDesign/ADRで比較し、導入済みと仮定しない。
- Issueの参照する `frontend/src/lib/ai-import/service.ts` は現行treeに存在しない。preview/commit/status Routeはschema・HMAC・RPCを直接構成し、一部でcookie認証後にservice role clientを使用している。一方、S-13管理Actionはauthenticated session clientとRLSを使用する。本Storyは存在しないserviceを再利用済みと記述せず、既存処理を抽出・収束してUI RouteとMCPが共有できるapplication-service契約を作る。
- OAuth/MCP/Claude/ChatGPTの外部契約は2026-07-19時点の公式一次資料でDesign時に再検証し、repo実装で保証できる範囲とHosted設定・実クライアントでのみ保証できる範囲を分ける。

## 2. 規模とドキュメント判定

- タスクタイプ: `feature` / `security`
- 規模: **large**
- 推定変更ファイル数: **18〜28ファイル**（認証client、MCP transport、consent UI、共有service、環境設定、必要なforward migration/Database型、unit/integration/contract test。仕様文書を除く）
- 影響レイヤー: Next.js Route Handler/Server Component、OAuth/Auth、MCP transport、共有AI import domain、Supabase JWT/RLS/RPC、環境設定、unit/integration/Hosted E2E
- 要件定義書: **必須**（モード: `create`。新機能かつ6ファイル以上）
- ADR: **必須**（OAuth認証・認可境界、Server Action以外の公開API/MCP境界、外部protocol/依存判断、service-role既存境界との収束）
- Design Doc: **必須**（複数のsecurity boundaryとHosted設定を含む大規模変更）
- 作業計画書: **必須**（依存順、repo gate、Hosted release gateを分離する必要がある）

## 3. スコープと優先順位

### Must

1. Supabase OAuth 2.1 ServerのAuthorization Code + PKCEとDynamic Client Registrationを使用し、OAuth/MCP discoveryを提供する。
2. `/oauth/consent`でclient名と「デッキ名の参照」「非公開カードの作成・編集・削除」を日本語表示し、許可と拒否を同等に操作可能にする。
3. `/api/mcp`でStreamable HTTP MCPとOAuth protected resource metadataへの標準discovery/challengeを提供する。
4. Bearer JWTを各MCP request/tool executionで検証し、署名、algorithm、issuer、audience、期限、失効、`client_id`、grant状態のいずれかが不正なら副作用前に拒否する。
5. 検証済みBearer JWTをauthenticated Supabase clientへ伝播し、RLSとJWT由来actorを全read/mutationへ適用する。service roleをowner CRUDの代替にしない。
6. 8 toolsをallowlistで公開し、S-10〜S-13の共有schema、preview/commit/status/管理RPC、stable error codeを再利用する。
7. standard scopeは `openid email profile` だけを許可し、custom scopeを作らない。tool allowlist、検証済みJWTの`client_id`、grant、RLSで操作権限を限定する。
8. consent拒否、連携解除、grant/token失効後は既発行tokenによるtool実行も拒否する。
9. `MCP_ENABLED`をexact `true` の場合だけ有効とし、disabled時はMCP endpoint/toolをfail closedで停止する。
10. repo内自動テスト、Hosted Supabase設定検証、Claude/ChatGPT実接続を別gateとして記録し、未実施のHosted/実接続を成功扱いしない。

### Should

- protocol version/feature negotiation、JSON-RPC/MCP入力異常、tool domain error、auth errorを異なる安全な応答として観測できる。
- consent、連携解除、tool errorは次の行動が分かる短い日本語を表示し、内部用語・provider本文を出さない。
- MCP requestは再送・切断を前提に、既存のidempotency/status契約から回復できる。

### Could

- Claude/ChatGPT以外でも同じOAuth 2.1 + MCP標準に準拠するclientを、同じDCR/consent/allowlist境界で接続できる。

### Won't / Out of Scope

- custom OAuth scope、独自scopeによるtool別認可。
- public cardの作成・編集・削除、AIカードの公開・共有。
- client credentialsやservice account等のmachine-to-machine認証。
- R2/W2、選択式、一般問題形式。
- アプリ内OpenAI生成UI、provider、Queue worker、cleanup、SRSの再実装。
- 外部AIがユーザー確認なしで自律的に登録する別経路。
- 本Story内でのproduction deploy、remote migration適用、issue close、ship/merge。

## 4. OAuth・同意・連携解除要件

### REQ-OAUTH-01 Discovery / DCR / PKCE

- WHEN OAuth対応MCP clientが認証情報を探索する場合、THE SYSTEM SHALL MCP protected resource metadataとSupabase OAuth authorization server metadataを標準のdiscovery関係で解決可能にする。
- THE SYSTEM SHALL Authorization Code flowでPKCEを必須とし、client secretを保持できないpublic clientでも安全に接続できるようにする。
- THE SYSTEM SHALL Supabase OAuth ServerのDynamic Client Registrationで登録されたclientだけを認可対象とし、未登録・無効化済みclientを拒否する。
- redirect URI、authorization code、PKCE verifier、state等の検証はSupabase OAuth Serverの正規境界へ委ね、アプリ独自の平行OAuth serverを実装しない。
- DCR有効化、authorization path、redirect URL、signing key/algorithm、grant管理等のHosted dashboard/API設定はrepo codeだけで完了したと表現しない。

### REQ-CONSENT-01 日本語同意・拒否

- `/oauth/consent`はSupabaseから渡された認可requestを検証済みserver境界で解決し、clientの表示名と要求scopeを表示する。
- 同意画面は少なくとも「デッキ名の参照」「非公開カードの作成・編集・削除」を日本語で明記する。
- 許可と拒否はキーボードだけで操作でき、両方に一意なaccessible name、visible focus、二重送信防止を提供する。
- THE SYSTEM SHALL 未認証・期限切れ・改ざん・未知clientのconsent requestを安全に拒否し、client名、redirect先、権限表示をclient入力だけから信用しない。
- WHEN ユーザーが拒否した場合、THE SYSTEM SHALL OAuth errorとして安全に完了し、grant/tokenを作らず、MCP toolを実行不能にする。

### REQ-CONSENT-02 Scope制約

- THE SYSTEM SHALL standard scope `openid email profile` だけを許可し、custom scopeを宣言・要求・保存しない。
- 許可scope外、未知scope、scope escalationを要求するauthorization requestはfail closedで拒否する。
- standard scopeをcard操作権限の根拠にせず、MCP tool allowlist、JWT `client_id`、有効grant、JWT actor、RLSを併用する。

### REQ-REVOKE-01 連携解除と失効

- ユーザーは自分が許可した外部AI連携を確認し、対象grantを解除できる。
- WHEN consentを拒否するか既存連携を解除した場合、THE SYSTEM SHALL 対象clientのtool実行を副作用前に拒否する。
- WHEN access token/session/grantがSupabase側で失効した場合、THE SYSTEM SHALL cache済みの署名検証結果だけで許可せず、次のMCP requestから401とする。
- 別ユーザー・別clientのgrant情報、token、client secretを一覧・error・logへ露出しない。

## 5. MCP transport・認証要件

### REQ-MCP-01 Streamable HTTP endpoint

- `/api/mcp`はMCP Streamable HTTP transportとして、対応するMCP protocol version、JSON-RPC request/notification/response、session negotiationを公式仕様に従って処理する。
- protected resource metadataはresourceとして `/api/mcp` を表し、未認証requestには標準のHTTP 401とBearer challengeを返す。
- transport/session/protocol上の不正と、認証済みtoolが返すdomain errorを区別する。未知tool、malformed protocol、unsupported protocol versionはMCP protocol errorとして扱ってよいが、既知tool内のvalidation/owner/conflict/provider errorをprotocol errorへ変換しない。
- response body/headerへstack、raw exception、SQL、provider body、secret、token、cookieを含めない。

### REQ-AUTH-01 Bearer JWTの毎回検証

- Authorization headerのBearer access tokenだけをMCP認証入力として受理し、query/body/cookieのtokenを認証へ使わない。
- 各MCP requestで、SupabaseのJWKS/`getClaims`相当の検証により署名、issuer、audience、expiryを検証し、失効・grant状態も確認する。前requestの成功を次requestへ無条件に流用しない。
- productionではRS256またはES256だけをallowlistし、`none`、HS系、未知algorithm、algorithm confusionを拒否する。
- `sub`はUUID形式の既存ユーザー、roleはauthenticated相当、`client_id`は有効な登録client/grantとして検証し、missing/malformed/mismatchを401とする。
- 未認証、期限切れ、not-before違反、失効、署名不正、issuer/audience不一致、未知key/algorithm、無効client/grantはいずれもtool dispatch・DB/Queue mutation前に401とする。
- auth errorは同一の安全な外形へ正規化し、token内容、検証失敗の内部詳細、ユーザー/clientの存在を漏らさない。

### REQ-AUTH-02 JWT伝播・RLS

- 検証済みBearer JWTをSupabase clientのAuthorizationへ伝播し、authenticated role、`auth.uid()`、RLSをread/mutationの正本にする。
- MCP toolはcaller指定のowner IDを受理しない。actorはJWT `sub`/`auth.uid()`からのみ導出する。
- 通常のdeck/card/batch CRUDにservice role clientを使用しない。既存service-role-only commit/status primitiveが必要な場合は、JWT actorとRLS/owner不変条件を維持するauthenticated-safe wrapperまたは同等境界をDesign/ADRで定義し、単にservice roleへuser IDを渡す実装を不可とする。
- SECURITY DEFINER RPCを追加・変更する場合、packed JWT claimsのauthenticated role/sub、固定`search_path`、固定function owner、完全修飾名、internal EXECUTE revoke、必要wrapperだけのgrantを既存S-13規約どおり検証する。
- owner、other authenticated、anonymous、失効token、service roleのactor matrixを持ち、service role成功をowner境界成功の代替証跡にしない。

### REQ-FLAG-01 Feature flag / rollback

- `MCP_ENABLED`はtrim後のexact `true`だけをenabledとし、未設定、空、`false`、その他の値はdisabledとする。
- disabled時は `/api/mcp` とtool executionを404相当で停止し、新しいDB/Queue mutationを行わない。OAuth/DCR/grantを停止・失効する運用手順は別途実行する。
- disabled時もアプリ内AI生成、既存batch status、worker/cleanup、AIカード管理、deck/studyを停止・削除しない。
- rollbackはrepo flag、Hosted DCR無効化、既存grant/token失効の3境界を個別に確認し、いずれも未確認なら完全rollback済みと表現しない。

## 6. 共有service・8 tools要件

### REQ-SERVICE-01 共通契約への収束

- UI RouteとMCPは `frontend/src/lib/ai-import/schema.ts`、canonical hash、preview token、`async-contract.ts`、AI import/management error code、S-10〜S-13 RPCを同じ意味で使用する。
- 現在分散しているpreview/commit/status/management orchestrationは、transport非依存のapplication-service境界へ抽出または収束し、HTTP UI adapterとMCP adapterが同義ロジックを複製しない。
- 共通serviceはtransport固有のcookie/JSON-RPC/HTTP responseをdomain契約へ持ち込まず、actor context、validated input、typed result/safe errorを受け渡す。
- MCP SDKを導入する場合でも、SDK固有型を共有domain schema/RPC/errorの正本にしない。SDK非導入案を含め、現行dependenciesとの比較と更新リスクをADRへ記録する。

### REQ-TOOL-01 Tool allowlist / schemas

- 公開tool名は次の8件だけとし、任意関数名・RPC名・table名を動的dispatchしない。
  1. `list_decks`
  2. `preview_card_import`
  3. `commit_card_import`
  4. `get_import_status`
  5. `list_ai_cards`
  6. `update_ai_card`
  7. `delete_ai_cards`
  8. `undo_import_batch`
- 各toolは厳密なinput schemaを公開し、未知field、型不一致、上限超過、未知enum、malformed UUID/cursor/idempotency keyを副作用前に拒否する。
- schema descriptionはprivate R1/W1だけが対象であり、preview後にのみcommitできること、owner外IDを操作できないことを明示する。
- tool listと実行dispatchは同一allowlistから導出し、flag offまたは未認証時にhidden toolの別経路実行を許さない。

### REQ-TOOL-02 `list_decks`

- JWT ownerが参照可能な本人所有deckだけを返し、public/他owner/存在しないdeckを返さない。
- card import先を識別できる最小限のdeck ID・名称を返し、card本文、他owner情報、内部列を含めない。
- emptyは成功した空一覧、認証・DB障害はerrorとして区別する。

### REQ-TOOL-03 `preview_card_import`

- S-10のR1/W1 schema、1〜50件、正規化、重複、deck owner、upload、read-only Stage 1検証、canonical hash、30分preview HMACを再利用する。
- previewはcard、deck、batch、item、tag、usage、Queue messageを作成しない。MCP外部生成card/uploadのquota免除はtrusted `source='remote_mcp'` contextからのみ導出し、tool inputの免除flagを受理しない。
- 成功時はnormalized cards、warning、preview token、expiryと次のcommitに必要なopaque値だけを返す。secret、raw hash material、DB内部値は返さない。

### REQ-TOOL-04 `commit_card_import`

- 有効なpreview token、同じowner、同じnormalized request/hash、未期限切れ、ユーザーのAI会話上の明示確定、idempotency keyを必須とする。
- previewなし、token改ざん、owner/request差し替え、期限切れ、別owner deck/uploadは副作用なしで拒否する。
- `source='remote_mcp'`をtrusted adapterが設定し、client/tool inputからsourceを選ばせない。
- 成功時はS-11 async commitを使用して2秒以内を目標に `batchId` とqueued statusを返し、画像/provider処理完了を同期的に待たない。
- 同一owner/key/hash再送は同じbatch/statusを返し、新しいcard、batch、job、message、quotaを作らない。同一key別hashは`CONFLICT`とする。

### REQ-TOOL-05 `get_import_status`

- owner-scoped batch IDまたは既存契約で許すidempotency keyから、S-11のstrict status DTOを返す。
- batchは `queued | processing | completed | partial | failed | undone`、itemは `queued | processing | succeeded | failed | undone` の既存外部状態を使用する。
- 別owner、存在しない、malformed batch IDは存在を漏らさない安全なnot-found/validation errorとする。
- Queue可視性やprocess memoryを正本にせず、owner-scoped DB statusから切断後も同じ結果を再取得できる。

### REQ-TOOL-06 `list_ai_cards`

- S-13のAI private card限定predicate、`created_at DESC, id DESC` cursor、既定20/最大100、deck/tag/source/date filterを再利用する。
- JWT ownerの確定済み現存AI private cardだけを返し、public、直接作成、deleted/undone/failed、別owner cardを含めない。
- Storage path/provider情報を返さず、必要最小限のcard/deck/tag/illustration安全状態だけを返す。

### REQ-TOOL-07 `update_ai_card`

- S-13のcontent、illustration、tag、deck管理契約のうちtool schemaで明示したpatchだけを許可し、未知fieldを拒否する。
- content実変更時だけcard key再計算・review state resetを行い、illustration/tag/deckだけの変更ではreview stateを維持する。全実変更で既存`user_edited_at`契約を守る。
- active session、duplicate、updated-at conflict、公開/別owner/未知relation IDを既存stable errorで副作用なしに拒否する。
- operationは原子的であり、複数relationの一部だけを成功させない。

### REQ-TOOL-08 `delete_ai_cards`

- S-13の1〜100件atomic bulk delete、AI private card predicate、updated-at conflict、active-session guard、tombstone、共有画像cleanup契約を再利用する。
- 1件でも公開/別owner/未知/active/conflictなら全件を副作用なしで拒否し、別ownerの存在を漏らさない。
- 削除で新しい`user_edited_at`を設定せず、undoがdeleted tombstoneをskipできる状態を保持する。

### REQ-TOOL-09 `undo_import_batch`

- JWT ownerだけが本人所有batchをundoでき、S-13のedited/active/queued-processing job拒否、deleted tombstone skip、共有画像reference、空auto deck、冪等stored resultを再利用する。
- 拒否時はjob、claim、card、item、batch、relation、tag、deck、illustration trackingを変更しない。
- 既にundoneの同一owner batchは同じ成功結果を返し、別owner/未知batchは存在秘匿する。

### REQ-ERROR-01 Tool result / stable error

- 認証済みでprotocolとして正しい既知toolのdomain failureは、MCP protocol errorではなくtool resultの `isError: true` と機械可読なstable `code`、安全な短文message、allowlist detailで返す。
- 既存の `VALIDATION_ERROR`、`DUPLICATE_IN_REQUEST`、`DUPLICATE_EXISTING`、`DECK_NOT_FOUND`、`DECK_AMBIGUOUS`、`QUOTA_EXCEEDED`、`ACTIVE_SESSION`、`CARD_MODIFIED`、`CONFLICT`、`SERVICE_UNAVAILABLE`、`UNAUTHORIZED`、`INTERNAL_ERROR`等を同じ意味で再利用する。
- unknown exception/error codeは `INTERNAL_ERROR`へ正規化し、correlation ID以外の内部detail、stack、SQLSTATE本文、provider response/body、secret、token、card本文を返さない。
- HTTP 401になるauth failureをtool domain `isError`へ降格して接続を成功扱いしない。

## 7. 非機能要件

### NFR-SEC-01 Security / privacy

- token、authorization code、PKCE verifier、cookie、client secret、signing key、JWKS private material、card front/back、tag、provider body、Storage pathをlog/metric/errorへ出さない。
- 監査情報はoperation/tool、safe code、非機密client ID、user/client相関の非可逆識別子、件数、duration、correlation IDだけをallowlistする。
- open redirect、CSRF、consent request差し替え、token replay/algorithm confusion、IDOR、scope escalation、dynamic tool/RPC dispatchを脅威モデルとテストに含める。
- bearer tokenをbrowser client bundle、localStorage、MCP tool resultへ保存・反射しない。

### NFR-REL-01 冪等性・切断回復

- commit、delete、undo等の再送は既存の冪等/atomic契約に従い、network切断・response lossで重複cardや部分mutationを作らない。
- statusは切断後に同じbatchへ再接続できる。MCP transport session喪失をbatch消失として扱わない。

### NFR-UI-01 Consent accessibility

- consent/連携解除UIは320〜360px幅とdesktopで横scrollを生じさせず、主要操作は48px相当のtouch target、visible focus、semantic label、keyboard操作を提供する。
- client名や日本語説明が長い場合も権限と拒否操作を隠さず、色だけで許可/拒否/失効状態を表現しない。

### NFR-COMPAT-01 Client / protocol compatibility

- ClaudeとChatGPTの本番相当clientで、discovery、DCR、PKCE、consent、tool list、実flow、revocation後401を各1回以上確認する。
- client固有extensionを共有domain契約へ混在させず、標準MCP/OAuth経路を優先する。
- Supabase OAuth Server beta、MCP version、Claude/ChatGPT connector仕様の変更をrelease前に公式一次資料と実接続で再確認する。

## 8. テスト要件

### 8.1 Unit（少なくとも8件追加）

最低限、次をrepo内Vitestで自動化する。

1. 8 tool名とinput schema/未知field/境界値。
2. tool allowlistとunknown tool拒否。
3. tool result `isError` / stable error mapping / unknown exception sanitization。
4. Bearer header parseとcookie/query token非採用。
5. JWT署名/issuer/audience/expiry/algorithm/client_id claim validation fixture。
6. JWKS key rotation/unknown keyとmalformed token。
7. `MCP_ENABLED` exact-true / fail-closed matrix。
8. protected resource metadata/Bearer challenge/protocol version validation。
9. consent表示modelがclient名と日本語権限を安全に生成し、未知scopeを拒否する。
10. secret/stack/provider body/card本文がerror/log DTOへ入らないこと。

### 8.2 Integration（少なくとも10件追加）

repo内で自動化可能なmock/contract/隔離DB testとして、最低限次を検証する。

1. OAuth discovery -> DCR contract -> PKCE/consent callbackの自動化可能範囲。
2. valid JWTの署名/issuer/audience/expiry/client_id検証とJWT-scoped Supabase client伝播。
3. 未認証・期限切れ・署名不正・issuer/audience不一致・unsupported algorithmの401と副作用0。
4. grant/token失効fixtureで次requestが401となること。
5. owner Aの `list_decks -> preview -> commit -> status` とprivate R1/W1登録。
6. previewなし、改ざん、期限切れ、request/owner差し替えの副作用0。
7. 同一idempotency key/hash再送と別hash conflict。
8. `list_ai_cards`のowner/cursor/filterとpublic/cross-owner非表示。
9. `update_ai_card`のcontent reset/relation keep/active/duplicate/conflict/owner境界。
10. `delete_ai_cards`のatomic bulk/active/cross-owner/tombstone/共有画像契約。
11. `undo_import_batch`の成功/refusal/retry/idempotence/owner境界。
12. 全8 toolsのsafe error shape、protocol errorとの分離、内部情報非露出。
13. `MCP_ENABLED=false`でendpoint/tool副作用0、既存app AI/status/management継続。

### 8.3 Hosted / real-client E2E（2件、release hard gate）

- **E2E-CLAUDE**: Hosted Supabase OAuth/DCR/PKCE/consentを使う実Claude connectorで、discovery、tool list、`list_decks -> preview -> commit -> status`、別owner ID拒否、token/grant失効後401を確認する。
- **E2E-CHATGPT**: 同じ項目を実ChatGPT connectorで確認する。
- 実client、Hosted Supabase、dashboard設定、実token/grant失効が必要なため、Vitest/mock成功で代替しない。未実施・client側制約・beta仕様差異は明記し、成功数へ含めない。
- 証跡には日時、対象environment/projectの非機密識別、client種類/version、接続したHTTP/OAuth/DB/Queue境界、各stepの期待/実結果、失効確認を記録し、token/secret/card本文を含めない。

### 8.4 品質・回帰command

- 現行 `frontend/package.json` の既存scriptだけを使用し、新しいtest scriptや未導入Playwrightを前提にしない。
- 対象testは `npm --prefix frontend run test -- <path>` 等、既存 `test` script経由で実行する。
- 最終repo gateは `npm --prefix frontend run check` と、Route Handler/Server Component/env/bundling変更のため `npm --prefix frontend run build` とする。
- 既存auth、deck、S-10〜S-13 import/status/management、study regressionを維持する。

## 9. Repo自動化とHosted release gateの分離

| 境界 | repo内で自動化する事項 | Hosted/手動release gate |
|---|---|---|
| OAuth discovery/metadata | route/metadata/challenge schema、URL関係、unknown scope fixture | 実Supabase issuer/authorization/token/DCR endpoint discovery |
| DCR / PKCE | request/response contract、state/PKCE/consent handler fixture | dashboardでOAuth Server/DCR有効化、実client登録、redirect URI、code exchange |
| JWT/JWKS | signed fixture、issuer/audience/expiry/algorithm/client_id、JWKS rotation | Hosted signing key/issuer/audience、RS256/ES256、実失効反映時間 |
| Consent | component/server contract、拒否、副作用0、a11y | Supabase authorization pathからの実遷移、実client名/scope、許可/拒否 |
| Tools / RLS | Vitest contract、隔離DB actor matrix、全8 tools、idempotency | Hosted migration/grant/RLS、worker/Queueを接続した実card/status/管理flow |
| Revocation | revoke-state fixtureと次request401 | ユーザー連携解除、grant/token失効、DCR無効化後の実client拒否 |
| Client E2E | client非依存contract fixture | Claude 1件、ChatGPT 1件の実接続hard gate |

- Hosted dashboard変更、remote migration、DCR有効化/無効化、grant失効、実Claude/ChatGPT接続はこの設計・計画ゲートでは実行しない。
- Hosted gateが未実施でもrepo実装の検証結果は報告できるが、AC-01、AC-07、AC-08および実client互換を完了扱いにしない。
- 接続先が不明なSupabase projectへmigration/reset/config変更を行わない。

## 10. ACトレーサビリティ

| Issue AC | 対応要件 | 必須検証 |
|---|---|---|
| AC-01 Claude/ChatGPT discovery・DCR・PKCE・consent | REQ-OAUTH-01, REQ-CONSENT-01〜02, REQ-MCP-01, NFR-COMPAT-01 | repo contract + Hosted Claude/ChatGPT各1件 |
| AC-02 token異常401 | REQ-AUTH-01〜02 | unit signed fixture + integration副作用0 + Hosted失効 |
| AC-03 list→preview→commit→status | REQ-TOOL-02〜05 | 隔離DB integration + Hosted実client各flow |
| AC-04 preview/owner境界 | REQ-TOOL-03〜09, REQ-AUTH-02 | 改ざん/期限/owner actor matrix、全snapshot不変 |
| AC-05 idempotency | REQ-TOOL-04, NFR-REL-01 | concurrent/retry同hash、別hash conflict、副作用件数 |
| AC-06 共通schema/error・内部非露出 | REQ-SERVICE-01, REQ-TOOL-01, REQ-ERROR-01 | 全8 tools error matrix、protocol/domain分離、sanitization |
| AC-07 consent拒否・連携解除 | REQ-CONSENT-01, REQ-REVOKE-01 | reject副作用0、revoke fixture + Hosted次request401 |
| AC-08 RS256/ES256 | REQ-AUTH-01 | algorithm allowlist unit + Hosted signing config/実JWT確認 |

## 11. Rollback要件

1. repoでは `MCP_ENABLED=false` によりMCP endpoint/toolを停止し、既存アプリ経路が継続することを自動検証する。
2. HostedではDCRを無効化し、新規client registrationを停止する。
3. 既存grant/tokenを失効し、既接続clientの次requestが401になることを確認する。
4. OAuth/MCP停止時も既存AI card、batch、Queue message、学習状態を削除せず、アプリ内生成・status・管理・workerを継続する。
5. 既存migrationを巻き戻さず、DB/RPC変更が必要な場合はforward-fixを使用する。

## 12. リスクと軽減策

| リスク | 影響 | 軽減要件 |
|---|---|---|
| Supabase OAuth Server/DCR beta仕様の変更 | discovery/consent/失効がclientと不一致 | 公式一次資料のDesign時再検証、Hosted Claude/ChatGPT hard gate |
| JWKS検証だけで失効を見逃す | 解除後もtool実行可能 | 各requestで失効/grant状態を確認し、署名cacheだけを認可にしない |
| service roleによるowner境界代替 | cross-user read/write | JWT-scoped client、RLS、authenticated wrapper、actor matrix |
| custom scopeなしによる過大権限 | clientがcard操作を拡張 | 8 tool allowlist、`client_id`、grant、RLS、consent日本語表示 |
| UI/MCP orchestration重複 | schema/error/idempotency drift | transport非依存serviceへ収束、同一contract test |
| MCP/SDK仕様変動 | transport incompatibility/依存更新負担 | SDK有無をADRで比較、protocol fixtureと実client gate |
| token/内部情報漏洩 | account/secret侵害 | allowlist log/error、Bearer非反射、sanitization test |
| contract testをE2Eと誤報 | release判断誤り | repo/Hosted/実client gateを分離し未実施を明記 |

## 13. 解決済み解釈とDesignで確定する事項

### 要件として固定する解釈

- `service.ts`は現時点で存在しない。新設の有無はDesignで決めるが、UI/MCPが共通application-service契約へ収束することは必須である。
- MCPは外部AIが生成済みのcardをimportする入口であり、アプリ内OpenAI Responses生成や画像providerを再実装しない。
- standard scopeは `openid email profile`だけとし、tool別custom scopeは作らない。
- owner認可はJWT + RLS + owner-safe RPCであり、service roleへcaller owner IDを渡すだけの実装は不可である。
- consent拒否、連携解除、token/grant失効後のtool拒否はrepo fixtureだけでなくHosted release gateを必要とする。

### Design/ADRで確定する事項

- 2026-07-19時点の公式仕様に基づくprotected resource metadata、authorization server metadata、DCR、consent handler、revocationの正確なURL/parameter/response契約。
- JWTの期待issuer/audience、JWKS取得・cache/rotationと失効確認を組み合わせる具体方式。
- MCP SDKを追加するか、既存dependencyとWeb標準でtransportを実装するか。
- service-role-onlyのS-10/S-11 commit/status primitiveを、JWT/RLS要件を壊さず再利用するauthenticated wrapper/権限設計。
- `update_ai_card`が複数patchを1transactionで扱う具体input/response schema。
- 連携解除UIをSupabase提供画面へ委ねる範囲と、アプリ側に必要な表示/操作境界。

上記事項は解釈を推測して実装せず、公式資料・現行Hosted capability・既存RPC grantを照合して設計する。実現不能または要件と公式contractが衝突する場合はハード停止して上流要件へ戻す。

## 14. 完了条件

- Issue #11の8 ACがACトレーサビリティ表のrepo自動検証とHosted/実client証跡へ追跡される。
- OAuth/Auth/RLS/MCP境界は新規Accepted ADR、Design Doc、plan、code/testで一体に定義される。
- 8 toolsが共有service/schema/error/RPCを利用し、MCP固有の同義domain実装を持たない。
- Unitが少なくとも8件、Integrationが少なくとも10件追加され、全自動testが成功する。
- `npm --prefix frontend run check` と `npm --prefix frontend run build` が成功する。
- Hosted Claude/ChatGPT E2E各1件、連携解除/失効、production RS256/ES256が成功証跡を持つ。未実施ならrelease未完了として明記する。
