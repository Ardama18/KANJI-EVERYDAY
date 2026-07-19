---
id: S-14
story_id: S-14
feature: ai-card-remote-mcp-oauth
title: ai-card-remote-mcp-oauth
type: design
version: 1.0.1
created: 2026-07-19
updated: 2026-07-19
github_issue: 11
epic_id: GH-9
parent_epic: 9
parent_story: S-10
---

# 設計書: Supabase OAuth・Remote MCP

## 1. 設計方針

S-14はOAuth/MCP transportだけを新設し、card import・status・管理・undoの意味はAccepted ADR-007/008/009/010とS-10〜S-13へ固定する。現行treeに存在しない共有serviceを再利用済みとは扱わず、Route Handler/Server Actionに分散したorchestrationをtransport非依存application serviceへ抽出し、UIとMCPを同じ契約へ収束する。

最優先の設計gateはHosted Supabase OAuth ServerのMCP 2025-11-25互換性spikeである。Supabase公式資料だけではRFC 8707 `resource`のauthorization/token request間の保持、canonical MCP audience、標準scopeだけのrefresh、既発行access tokenの即時grant失効を証明できない。spikeが失敗した場合はproduction code・dependency・migrationへ進まずblockedとする。OAuth facadeや別Authorization Serverへの変更は本設計外である。

- `source='remote_mcp'`、actor、client、quota免除はtrusted server boundaryで導出し、tool inputから受理しない。
- Bearer access tokenを各requestで署名・issuer・audience・期限・algorithm検証し、session/grant livenessも毎回確認する。
- 検証済みtokenをJWT-scoped Supabase clientへ伝播し、`auth.uid()`、RLS、authenticated wrapperをowner境界にする。service roleを代替にしない。
- standard scopeは`openid email profile`だけとし、8 tool allowlist、`client_id`、active grant、RLSで権限を制限する。
- MCP domain failureはsafeな`isError` tool result、auth failureはHTTP 401、transport/protocol failureはMCP protocol errorとして分離する。
- repo自動テスト、Hosted互換性、実Claude/ChatGPT接続を別gateとし、未実施を成功扱いしない。

## 2. 先行hard gate: Hosted Supabase互換性spike

### 2.1 実施環境と証跡

local emulatorでOAuth Server betaの互換性を代替せず、production設定を模したdisposable/preview Hosted Supabase projectと公開HTTPS preview originを使う。card本文や実ユーザーを用いない合成dataで、日時、git SHA、Supabase projectの非機密識別子、設定値の分類、request/responseのsanitized要約、合否を残す。authorization code、access/refresh token、PKCE verifier、client secret、cookie、署名鍵は保存しない。

### 2.2 合格条件

1. OAuth Server、DCR、custom consent pathを有効にし、authorization server metadataからauthorization、token、registration、JWKS endpointを解決できる。
2. standards-based test clientがDCR後、Authorization Code + S256 PKCEを完了する。`resource=https://<preview-origin>/api/mcp`をauthorization requestとtoken requestの両方へ同一値で送る。
3. consent approveでcode/tokenが発行され、denyではgrant/tokenが作られない。client名、redirect URI、scopeはSupabaseが検証したauthorization detailsと一致する。
4. access tokenがRS256またはES256で署名され、exact issuer、UUID `sub`、`role=authenticated`、`client_id`、`session_id`を持つ。
5. `aud`がcanonical MCP resourceへのexact audience検証を満たし、同じtokenを渡したSupabase Data API/RPCがauthenticated roleとRLSを維持する。
6. custom access token hookを使う場合、公式例のstring audienceと、必要ならarray audienceの実挙動を別々に検証する。`["authenticated", canonical-resource]`は実証前に採用しない。
7. `openid email profile`だけを要求したauthorizationでrefreshが得られ、Claude/ChatGPTの再接続要件を満たす。`offline_access`を暗黙追加しない。
8. `supabase.auth.oauth.revokeGrant(clientId)`相当のsupported APIで対象grantを解除するとsession/refresh tokenが失効し、解除前に発行された未期限切れaccess tokenも、次requestのliveness検査で401になる。
9. DCRを無効化した後は新規client登録を拒否でき、既存grant失効との違いを運用上確認できる。
10. requestごとのgranted scopeを、`client_id`で照合したactive `getUserGrants`相当、またはdocumented custom hook claimから取得できる。JWTに一般的なscope claimがあるとは仮定しない。sourceが3 scopesの完全一致を証明できず、`phone`/custom/unknown scopeを含む場合は不合格とする。

### 2.3 停止条件

上記2〜10のいずれかがSupabaseのdocumented/supported境界で成立しない、または内部auth tableへ未保証の直接依存が必要になる場合は実装を停止する。特にresourceがtoken発行へ伝播しない、audienceとData API RLSを両立できない、standard scopeだけでは実client refreshが成立しない、granted scope/既発行tokenのlivenessを確認できない場合は推測で進めない。

OAuth gate通過後、依存追加前に別のcompile integration spikeを行う。candidate SDK v1とpeer dependencyを一時branch/worktreeでexact pinし、Next 14 Route HandlerのWeb `Request`からSDKへ渡しWeb `Response`を返す最小routeを`npm run typecheck`、Vitest、`npm run build`で検証する。実package exportからadapter APIを確認し、`enableJsonResponse`や特定transport classを仮定しない。Express-onlyならtested bridgeのheader/body/stream/abort/error semanticsを実証するかSDK選択を再検討し、ADRを更新する。

## 3. 全体構成

```text
Claude / ChatGPT
  ├─ PRM / AS metadata / DCR ───────────────> Supabase OAuth Server (Hosted)
  ├─ authorization_id ──────────────────────> /oauth/consent
  │                                             └─ Supabase OAuth approve / deny
  └─ Bearer JWT + MCP request ──────────────> /api/mcp
                                                ├─ feature / Origin / HTTP validation
                                                ├─ JWT JWKS + iss/aud/time/alg validation
                                                ├─ session + grant liveness validation
                                                ├─ official MCP SDK v1 transport
                                                └─ static 8-tool dispatcher
                                                     └─ application service
                                                          └─ JWT-scoped Supabase client
                                                               ├─ RLS / auth.uid()
                                                               ├─ authenticated RPC
                                                               └─ S-10〜S-13 internal primitive
```

MCP requestはstatelessに処理する。MCP transport sessionを作成する場合もimport batch/jobの永続性には使わず、切断後は`batchId`またはidempotency keyでDB statusを再取得する。

## 4. 変更境界

### 4.1 OAuth / metadata / UI

- `frontend/app/.well-known/oauth-protected-resource/api/mcp/route.ts`: RFC 9728 path-specific Protected Resource Metadata。canonical `resource`、Supabase authorization server issuer、Bearer method、`scopes_supported: ['openid','email','profile']`をexactに返す。
- `frontend/app/.well-known/oauth-protected-resource/route.ts`: client互換性が実接続で必要と確認された場合だけ同一metadataを返すroot alias。別resourceは定義しない。
- `frontend/app/oauth/consent/page.tsx`: `authorization_id`をserverでstrict parseし、Supabase OAuthの`getAuthorizationDetails`相当で検証済みclient/scopesを取得する。
- `frontend/src/actions/oauth-actions.ts`: approve/deny/revokeをserver-onlyで実行する。client由来のclient name、redirect URI、scopeを受理しない。
- `frontend/app/(auth)/oauth/connections/page.tsx`: 本人のgrantだけを一覧し、対象clientの連携解除を提供する。grantのsecret/tokenは表示しない。
- consentはmiddlewareの汎用login redirectへ委ねない。page-levelで未認証を検出し、`authorization_id`だけをstrict validateしてserver-side短命・one-time stateへ保存し、same-originの固定consent routeへlogin後復帰する。復帰後はauthorization detailsを再取得する。connectionsのみ既存保護routeへ追加する。raw return URL、client redirect、任意queryをlogin returnへ渡さない。

Supabase SDKのOAuth API名・戻り値は実装時のinstalled exact versionと公式資料で再確認する。設計上の必要operationはauthorization details取得、approve、deny、user grants一覧、grant revokeであり、存在しないSDK APIを独自実装済みと仮定しない。

### 4.2 MCP transport / auth

- `frontend/app/api/mcp/route.ts`: POST、必要なOPTIONS、GET 405を扱う薄いadapter。flag、Origin、content type、Bearer challengeを先に判定する。
- `frontend/src/lib/mcp/server.ts`: SDK v1のserver/Streamable HTTP transport生成とcapability登録。
- `frontend/src/lib/mcp/tools.ts`: 8 tool descriptorと同一mapによるdispatch。任意RPC/function名の動的呼出しはしない。
- `frontend/src/lib/mcp/auth.ts`: Bearer parse、JWT cryptographic validation、claim validation、session/grant liveness、actor context生成。
- `frontend/src/lib/mcp/metadata.ts`: canonical public resource/issuer/metadata URLを同じconfigから構築する。
- `frontend/src/lib/mcp/error-result.ts`: stable errorからsafe MCP tool resultへの変換。
- `frontend/src/lib/env.ts`: `MCP_ENABLED`、canonical public origin/resource、Supabase OAuth issuer、allowed Originをserver-onlyでstrict parseする。
- `frontend/src/lib/supabase/server.ts`: anon/publishable keyと`accessToken: async () => token`を使うrequest-scoped `createJwtScopedClient`を追加する。token persistence、自動refresh、cookie fallback、service roleを使わない。

SDKはSection 2のcompile spikeが通った場合だけ、`@modelcontextprotocol/sdk` v1系の実装時点stable exact versionとpeer requirementを満たすexact `zod`を`frontend/package.json`/lockfileへ追加する。SDKはprotocol/transportに限定し、S-10 schemaやerrorの正本にはしない。実packageで検証済みのWeb adapterをrequestごとに生成する。server-initiated long-lived SSEを要件にせず、GETは405とする。

### 4.3 共有application service

- `frontend/src/lib/ai-import/service.ts`: preview/commit/statusのtransport非依存use case。`ActorContext`、validated domain input、repositoryを受け、typed successまたは既存safe errorを返す。
- `frontend/src/lib/ai-card-management/service.ts`: deck/list/update/delete/undoの共通use case。現行Server Actionのparse/RPC/error orchestrationを収束する。
- service interfaceは共有するがrepositoryは分離する。UI/app_aiは既存cookie session + service-role互換wrapper repositoryを維持し、remote_mcpはBearer JWT-scoped authenticated wrapper repositoryだけを使う。generic authenticated actorとMCP OAuth actor/client/grant checksを混ぜず、UIをOAuth-specific wrapperへ移さない。
- existing pure modules `schema.ts`、`canonical-request.ts`、`preview-token.ts`、`preview-service.ts`、`async-contract.ts`、management DTO/error mappingをそのまま正本にする。

application serviceはNext `Request/Response`、cookie、MCP SDK type、Supabase clientを引数にしない。adapterがUI/app_ai repositoryまたはremote_mcp repositoryを選び、各repository内部だけで対応client/wrapperを使ってDB errorをsafe codeへ変換する。

### 4.4 Database forward migration

既存S-10〜S-13 migrationを編集せず、S-14 forward migrationでauthenticated-safe wrapperを追加・収束する。

- generic authenticated actor helperはUUID `sub`とauthenticated roleだけを扱う。MCP OAuth境界はTSでissuer/audience/client/session/grant/scopeを検証し、S-14 DB wrapperはpacked claimsの`client_id`/`session_id`とTSから選定したclient contextの一致を再検証する。UI wrapperへOAuth claimを要求しない。
- remote preview wrapper: owner deck、duplicate、upload/illustration relationをread-onlyで検証する。card、reservation、batch、usage、Queueを作らない。
- 現行`commit_import_async`と`get_ai_import_status`にはinternal primitiveがないため、forward migrationで各bodyをowner-only ungranted internal functionへ抽出する。既存service-role wrapperのsignature/挙動を維持し、S-14 authenticated wrapperも同じinternal bodyを呼ぶ。types、fresh migration、S-13→S-14 upgrade testで互換性を固定する。
- remote commit wrapper: trusted sourceを`remote_mcp`へ固定し、同一transaction内でquota免除reservationを作成して抽出済みcommit internalへ渡す。DBはactor、import hash、deterministic generation hash、reservation key、idempotencyを再検証し、失敗時は全rollbackする。HMAC secret/token検証はTSに留める。
- remote status wrapper: actorをimplicitにして抽出済みstatus internalへ委譲する。
- `list_decks`はowner-RLS query（必要なら最小RPC）で`name ASC, id ASC`とし、public/private分類を追加しない。list/delete/undoは既存S-13 public authenticated wrapperを直接使う。新規management wrapperは複合patchを原子的にするupdateだけとする。
- atomic update wrapper: content/illustration/deck/tag patchを1回のtransactionとlock順で適用し、途中成功を許さない。

SECURITY DEFINERを使うwrapper/internalはS-13規約に従い、固定owner、`SET search_path = pg_catalog, pg_temp`、完全修飾名、PUBLIC/anon/internal EXECUTE revoke、必要なwrapperだけのgrantを設定する。抽出internalはservice-roleからも直接実行不可で、互換wrapper経由だけとする。MCP認証でのactive grant照合はSupabaseのsupported APIを優先し、未保証の`auth`内部tableへmigrationが直接依存する設計にはしない。

## 5. OAuth discovery・consent・解除

### 5.1 Discovery chain

1. clientは`/api/mcp`の401 challengeまたは既知URLからpath-specific PRMを取得する。
2. PRMはcanonical `resource=https://<public-origin>/api/mcp`、Supabase authorization server identifier、exact `scopes_supported: ['openid','email','profile']`を返す。`phone`/custom scopeを掲載しない。
3. clientはSupabase authorization server metadataからDCR、authorization、token、JWKS endpoint、S256対応を探索する。
4. DCR済みclientはauthorization requestへcanonical `resource`、`openid email profile`、PKCE challenge、stateを送る。
5. token requestにも同じcanonical `resource`とPKCE verifierを送る。

public originはforwarded headerから組み立てず、server-only環境変数の単一canonical URLを使用する。metadata、challenge、audience validation、Hosted client設定が同じ値を参照する。

### 5.2 Consent UI

画面構造は次の通りとする。

```text
main
  └─ section[aria-labelledby]
      ├─ 見出し「外部AIとの連携を確認」
      ├─ 検証済みclient名
      ├─ 説明「この連携でできること」
      ├─ list
      │   ├─ デッキ名の参照
      │   └─ 非公開カードの作成・編集・削除
      ├─ standard scope補足（openid / email / profile）
      ├─ 拒否してもアプリ内AI生成は利用できる旨
      └─ form
          ├─ 「拒否する」button
          └─ 「許可する」button
```

client表示名とscopeは`authorization_id`を用いたserver-side authorization detailsから取得する。未認証時はstrictなauthorization IDだけをserver-side one-time stateへ結合してloginへ進み、復帰後にdetailsを再取得する。欠落、改ざん、replay、別origin returnは拒否する。未知/期限切れrequestや未知scopeはapprove/redirectせず安全な日本語errorへする。approve/denyはSupabase OAuth Serverの正規operationを使い、redirect targetをquery/bodyから直接使用しない。

320〜360pxとdesktopで横scrollを出さず、操作targetは48px相当、visible focus、semantic heading/list/button、keyboard操作を提供する。長いclient名は折り返し、権限と拒否操作を画面外へ押し出さない。Figma正本は存在しないため、既存global token/componentとrequirementsをUI source of truthとする。

### 5.3 連携解除

connections pageは現在ユーザーのgrantだけをSupabase supported APIで取得し、client名、許可日/状態など非機密情報だけを表示する。解除は対象clientを再確認する確認UIを経てrevokeする。成功後はgrant一覧を再取得し、旧access tokenでのMCP requestが401になることをHosted testで確認する。別ユーザー/clientのgrant識別子は404相当へ正規化する。

## 6. Bearer JWT認証・失効境界

### 6.1 requestごとの検査順

1. `MCP_ENABLED`がexact trueでなければ404相当で終了し、DBへ触れない。
2. method、content type、payload上限、Host/Origin allowlistを検証する。browser Originがある場合はexact allowlist、ないserver clientは仕様に沿って許可する。invalid Originは副作用前に403とする。
3. `Authorization: Bearer <token>`をstrict parseする。複数header、空白token、cookie/query/body tokenは拒否する。
4. JWT headerの`alg`をRS256/ES256へ限定し、Supabase JWKS/`getClaims`相当で署名を検証する。unknown `kid`はJWKS更新後も不明なら拒否する。
5. exact issuer、canonical audience、`exp`、任意`nbf`、UUID `sub`、authenticated role、非空`client_id`/`session_id`を検証する。audienceが配列の場合もcanonical resourceが含まれるだけでなく、Hosted gateで認めた形だけを受理する。
6. current user/sessionとactive client grantをSupabase supported boundaryで照合する。`auth.getUser(token)`相当だけをgrant livenessの代替にせず、grant revokeを確認する。
7. JWT scope claimを仮定せず、Hosted gateで証明したper-request source（`client_id`一致のactive grantまたはdocumented hook claim）からgranted scopeを得る。集合がexact `openid email profile`でなければ拒否し、`phone`/custom/unknownを許可しない。scopeはcard操作権限の根拠にしない。
8. `McpActorContext`とJWT-scoped Supabase clientを作り、初めてMCP protocol/tool dispatchへ進む。

JWKS key materialのHTTP cacheは許容するが、claim検証結果、user、session、grant/scopeのpositive resultはrequest間cacheしない。全HTTP 401は理由を区別せず、`WWW-Authenticate: Bearer resource_metadata="<PRM URL>", scope="openid email profile"`を付ける。

### 6.2 actor contract

```ts
type McpActorContext = Readonly<{
  userId: string
  clientId: string
  sessionId: string
  issuer: string
  audience: string
  scopes: readonly ['openid', 'email', 'profile'] // Hostedで証明したper-request sourceだけから設定
}>
```

raw access tokenはactor/domain objectへ保存せず、request-scoped Supabase client生成時だけ閉じ込める。tool inputに`ownerId`、`userId`、`clientId`、`source`を定義しない。audit logはuser/clientの非可逆相関値、tool、safe code、件数、duration、correlation IDだけをallowlistする。

## 7. Streamable HTTP / MCP protocol

- endpointは`POST /api/mcp`。JSONと仕様で許容されるAccept headerを検査し、SDK v1 transportへ渡す。
- initializeでserver name/version、MCP protocol version、tools capabilityだけを公開する。resource/promptの動的公開はしない。
- stateless JSON responseを基本とし、GET SSEを実装しない場合は405。DELETE sessionもsessionを発行しない構成では405とする。
- SDKが処理する前にもpayload上限とOriginを確認する。request body/tokenをlogしない。
- tools/listとtools/callは同一immutable allowlist mapから導出する。全descriptorにOpenAI OAuth `securitySchemes`を設定し、要求scopeはexact `['openid','email','profile']`とする。8件以外のtool、RPC、tableを名前で動的dispatchしない。
- 初期/transport認証失敗はHTTP 401を維持する。ChatGPTがtool call中に再認証を必要とする場合だけ、tool resultの`_meta["mcp/www_authenticate"]`へ同じBearer challengeを設定する。domain errorへchallengeを付けない。
- tool success/errorは`structuredContent`と互換用serialized JSON textの内容を一致させる。card本文が正規のtool success dataとして必要な場合以外はerror/logに反射しない。

tool result外形は次とする。

```ts
type SafeToolResult<T> = {
  content: [{ type: 'text'; text: string }]
  structuredContent:
    | { ok: true; data: T }
    | { ok: false; error: { code: StableErrorCode; message: string; details?: SafeDetails } }
  isError?: true
}
```

successでは`isError`を省略し、domain failureでは`isError: true`とする。`SafeDetails`はfield、limit、allowed value、本人に関するconflict identifierなどtool別allowlistのみ。unknown exception/codeは`INTERNAL_ERROR`へ変換する。

## 8. 8 toolsの契約

### 8.1 共通規則

inputはstrict objectとし、未知field、型違い、不正UUID、上限超過、未知enumをapplication service呼出し前に拒否する。JSON SchemaはMCP descriptor用に明示するが、runtime validationとcanonical意味は既存domain schemaを正本とする。descriptorとruntime schemaの一致をcontract testする。

tool annotationsは実際の副作用と一致させる。`list_decks`、`preview_card_import`、`get_import_status`、`list_ai_cards`はread-only、`delete_ai_cards`と`undo_import_batch`はdestructive、`commit_card_import`と`update_ai_card`はmutationとする。

全8 descriptorは次の同一security contractを持つ。

```ts
const oauthSecurity = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }]

securitySchemes: oauthSecurity,
_meta: { securitySchemes: oauthSecurity } // OpenAI互換mirror。reauth challengeはtool result側
```

### 8.2 `list_decks`

- input: `{}`
- output: `{ decks: Array<{ id: UUID; name: string }> }`
- owner-RLS query（必要時だけ最小RPC）で本人所有deckを`name ASC, id ASC`で返す。「private deck」という存在しない分類を加えず、他owner/internal列/card本文を含めない。

### 8.3 `preview_card_import`

- input: `{ request: AiImportRequest }`
- S-10のR1/W1、1〜50件、正規化、duplicate、deck/upload owner検証をwrite-freeで実行する。
- output: normalized request/cards、warnings、`previewToken`、`expiresAt`、canonical `cardReservationKey`、`importRequestHash`。previewではDB reservationを書かない。
- existing UI token v1を維持し、remote MCPはtoken v2を発行する。v2 HMAC payloadをdomain separator、owner、verified `client_id`、normalized canonical request/hash、`cardReservationKey`、expiryへ結合し、別client replayを拒否する。`AI_PREVIEW_HMAC_SECRET`はTS application serviceだけが保持し、DBへ渡さない。

### 8.4 `commit_card_import`

- input: `{ request, previewToken, cardReservationKey, importRequestHash, idempotencyKey, confirmedWarnings: true }`
- TS serviceがv2 token、owner、verified client、hash、normalized request、expiryを検証する。`confirmedWarnings`は既存canonical fieldを使いexact trueのみ。
- authenticated remote commit wrapperが`source='remote_mcp'`とquota免除を固定し、exempt reservation作成とS-11 async commitを同一transactionで行う。
- `generation_request_hash`はUTF-8 domain separator `kanji-everyday:remote-mcp:generation:v1`、固定長hex `importRequestHash`、正規化UUID `client_id`のlength-prefixed canonical bytesをSHA-256してserverで決定的に導出する。tool inputから受けず、DBはactor/import hash/card reservation/idempotencyと共に原子的に再検証する。
- outputは既存`CommitAsyncResponse { batchId, status, statusUrl }`へexact adapter-mapする。`idempotentReplay`など未定義fieldを追加しない。同一owner/key/hashは同じbatchを返し、別hashは`CONFLICT`。

### 8.5 `get_import_status`

- input: `{ batchId: UUID } | { idempotencyKey: string }`のexactly one。
- S-11 strict DTOと外部stateだけを返す。Queue/process memoryを参照せず、別owner/unknownは同一safe not-foundへする。

### 8.6 `list_ai_cards`

- input: S-13のopaque cursor、limit 1〜100、deck/tag/source/JST date filterのstrict subset。
- S-13のAI finalized private predicate、`created_at DESC, id DESC`、既定20をそのまま使用する。
- outputはS-13 safe DTOと`nextCursor`。Storage path、provider data、別owner relationを含めない。

### 8.7 `update_ai_card`

- input: `{ cardId, expectedUpdatedAt, patch }`。patchはcontent、illustration、deck IDs、tag IDsまたはtag namesの明示fieldだけを許可し、空patchとtag mode混在を拒否する。
- DBの単一atomic wrapperがS-13 content/illustration/deck/tag internal primitiveを共有lockの内側で適用する。一部だけ成功しない。
- content実変更だけcard key/review reset、relation/illustrationだけではreview維持、全実変更で既存編集印、no-opで更新なしを守る。

### 8.8 `delete_ai_cards`

- input: `{ cards: Array<{ cardId: UUID; expectedUpdatedAt: string }> }`、重複なし1〜100。
- S-13 atomic bulk delete、AI private predicate、active guard、tombstone、共有画像cleanup契約をそのまま使用する。1件の失敗で全rollbackする。

### 8.9 `undo_import_batch`

- input: `{ batchId: UUID }`
- S-13のowner、edited/active/job guard、tombstone skip、画像reference、auto deck、保存済み冪等resultを使用する。別owner/unknownを同形にする。

## 9. import・管理serviceへの収束

### 9.1 import flow

```text
list_decks
  -> preview_card_import (pure normalize + read-only owner validation + HMAC)
  -> user confirms in AI conversation
  -> commit_card_import (HMAC/hash/owner recheck + atomic exempt reserve/async commit)
  -> get_import_status (owner-scoped DB status)
```

UI adapterの`app_ai`とMCP adapterの`remote_mcp`は同じservice interface/domain schemaを使うが、repositoryとtrusted source policyは分離する。MCPはOpenAI generation、source upload、Queue worker、image providerを呼び直さない。remote previewはS-10のapp generation quota reservationを作らず、remote commit transactionだけが免除reservationを作る。

### 9.2 owner-safe repository

repository methodはactor/user IDをtool inputから受けない。remote repositoryはJWT-scoped PostgREST/RPCでDB側`auth.uid()`を導出し、service roleを使わない。UI/app_ai repositoryはOAuth-specific claim/wrapperへ移さず既存service-role互換wrapperを保つ。抽出internalへのPUBLIC/anon/authenticated/service_role direct EXECUTEをrevokeし、UI互換wrapperとS-14 authenticated wrapperだけが到達する。

### 9.3 concurrency / idempotency

- commitはowner + idempotency keyの既存unique/lock契約を使用し、same hash replayは同値、different hashはconflict。
- update/deleteは`expectedUpdatedAt`、UUID順lock、active session guardを使用する。
- undoはS-11/S-13のjob→card→illustration→tracking→batch lock順と保存結果を使う。
- auth/grantがcommit transaction開始後に失効するraceは、request開始時livenessとJWT/RLSを必須とし、短いtransactionを維持する。失効後の次requestは必ず拒否する。厳密な同時失効transaction cancellationを要件に追加しない。

## 10. error・privacy・観測性

| failure layer | response | code/detail |
|---|---|---|
| feature disabled | 404相当 | bodyは固定・DB未接触 |
| missing/invalid/expired/revoked JWT | HTTP 401 + Bearer challenge | 理由を区別しない |
| invalid Origin | HTTP 403 | allowlistを開示しない |
| malformed MCP/unknown tool | MCP protocol error | SDKの安全な標準code |
| known tool validation/owner/conflict | tool `isError: true` | 既存stable code + allowlist detail |
| unknown DB/provider/internal error | tool `isError: true` | `INTERNAL_ERROR`、correlation IDのみ |

`VALIDATION_ERROR`、`DUPLICATE_IN_REQUEST`、`DUPLICATE_EXISTING`、`DECK_NOT_FOUND`、`DECK_AMBIGUOUS`、`QUOTA_EXCEEDED`、S-13 `NOT_FOUND`、`ACTIVE_SESSION`、`CARD_MODIFIED`、`CONFLICT`、`SERVICE_UNAVAILABLE`、`UNAUTHORIZED`、`INTERNAL_ERROR`を既存意味で使用する。canonical mappingはdeck=`DECK_NOT_FOUND`、card/batch/tag/illustrationおよびcross-owner/unknown=`NOT_FOUND`、optimistic/idempotency mismatch=`CONFLICT`（card timestampは`CARD_MODIFIED`）、active study=`ACTIVE_SESSION`とする。resourceの存在をmessage/detailで区別しない。

token、code、verifier、cookie、secret、private signing material、raw JWT/claims全体、card front/back、tag、provider body、Storage path、SQL/stackをlog/metric/errorへ出さない。structured logはcorrelation ID、tool、safe code、duration、件数、非可逆user/client相関だけとする。

## 11. feature flag・rollback

`MCP_ENABLED`はtrim後のexact `true`だけenabled。未設定、空、`false`、その他はdisabledである。ADR-011どおりPRMはflagに関係なく固定metadata（exact 3 scopes）を返す。一方、disabled時は`/api/mcp`のinitialize/toolsを含め404相当で停止し、consent approveも拒否して新規grant/mutationを作らない。

完全rollbackの確認単位は次の3つである。

1. repo: `MCP_ENABLED=false`でendpoint/tool/consent approve停止。
2. Hosted OAuth: DCRを無効化して新規client登録停止。
3. grants/tokens: 全既存grantをrevokeし、session/refresh tokenと旧access token liveness拒否を確認。

いずれか未確認なら完全rollback済みと表現しない。rollback後もアプリ内AI生成、既存batch status、worker/cleanup、AI card管理、deck/studyを継続する。

## 12. テスト設計

### 12.1 Unit / contract（repo内、少なくとも8件）

Vitestで最低限次を自動化する。

1. exact 8 tool descriptor、tools/listとdispatch同一allowlist、unknown tool拒否。
2. 各input schemaの未知field、UUID、limit、union exactly-one、empty patch、confirmation exact true。
3. stable error→`isError`、structured/text一致、unknown exception sanitization。
4. Bearer header strict parse、cookie/query/body token非採用。
5. RS256/ES256 fixtureのsignature、issuer、canonical audience、exp/nbf、role、sub、client/session validation。
6. HS/none/unknown alg、unknown kid、JWKS rotation/malformed JWT拒否。
7. session/grant liveness success/revoke/lookup failureをcacheせず401にする境界。
8. PRMのcanonical resourceとexact scopes、全401 challengeの`scope="openid email profile"`、`phone`/custom scope非掲載。
9. `MCP_ENABLED` exact trueとfail-closed、disabled時repository未呼出し。
10. consent authorization details、login往復でauthorization_id保持、missing/tamper/replay/cross-origin return拒否、approve/deny。
11. 全8 descriptorのOpenAI OAuth securitySchemes exact scopes、initial 401とtool-level `_meta["mcp/www_authenticate"]` reauth分離、ChatGPT linking/reauth fixture。
12. SDK compile spike後のinitialize/protocol negotiation、POST JSON、GET/DELETE 405、Origin allowlist。
13. UI/MCP adapterが同じapplication service interface/result mapperを使い、別repositoryを選ぶcontract。

### 12.2 DB / application integration（repo内、少なくとも10件）

既存S-10〜S-13 testkitとisolated Supabaseを再利用する。

1. owner JWTでlist_decks、other/anon非表示。
2. remote preview成功とcard/reservation/batch/usage/Queue snapshot不変。
3. previewなし、改ざん、期限切れ、request/owner差し替えで副作用0。
4. remote commitでtrusted source、exempt reservation、batch/items/jobs/messageが既存S-11契約どおりatomic作成。
5. same idempotency key/hash replayで増分0、different hash conflict。
6. statusをbatch ID/idempotency keyで取得し、other/unknown同形。
7. list_ai_cardsのAI private predicate、cursor/filter、other/public/direct card除外。
8. atomic updateのcontent reset、relation/image review維持、no-op、conflict/active/all rollback。
9. atomic bulk delete 1/100、other/unknown/active/conflictで全snapshot不変。
10. undo success/replay、edited/active/job拒否、tombstone skip、other/unknown同形。
11. authenticated wrapper/internal grants、packed claim missing/malformed/client/session/audience mismatch。
12. JWT-scoped clientのRLS actor matrix: owner、other authenticated、anon、service role direct wrapper/internal。
13. UI RouteとMCPで同じnormalized preview/hash/status/error codeになるcontract。
14. commit/status body抽出後の既存service-role wrapper互換、S-14 authenticated wrapper、internal ungranted、migration fresh chain/S-13→S-14 upgrade、Database typecheck。
15. remote token v2のclient binding/cross-client replay、UI token v1互換、deterministic generation hashをtool inputから上書き不能。

### 12.3 Hosted Supabase gate

Section 2をproduction codeより先に実施し、release前に同じ項目をproduction-like previewで再確認する。OAuth Server/DCR/dashboard signing key、resource/audience、Data API RLS、refresh、deny/revoke、old access token 401はrepo mockの成功で代替しない。

### 12.4 実client E2E release gate（2件）

- Claude: discovery→DCR→PKCE→日本語consent→tools/list→実import flow→revoke後401。
- ChatGPT Developer Mode:同じ標準flow、tool discovery/call、refresh/reconnect、revoke後401。

各証跡にclient/version、日時、git SHA、public MCP URL、Hosted project識別子、実行tool、safe result、revoke結果、未検証項目を記録する。実client/Hostedが利用できなければ未実施としてrelease gateを失敗/保留にし、repo test成功へ合算しない。

### 12.5 実装後に使用する既存command

新しいpackage scriptは作らない。testは`frontend/src/**/*.test.ts(x)`配下へ置き、現行`frontend/vitest.config.ts`と`frontend/tsconfig.json`のinclude対象であることを確認する。`specs/`配下へ置く場合だけ両configへ明示追加し、`npm run check`が実行/型検査するcontract testを置く。既存scriptだけを使う。

```sh
npm --prefix frontend run test -- <S-14 unit/integration test paths>
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run check
npm --prefix frontend run build
```

## 13. EARS受入条件・トレーサビリティ

| ID | EARS受入条件 | 設計境界 | 主な検証 |
|---|---|---|---|
| AC-01 | WHEN ClaudeまたはChatGPTがresourceを探索する場合、THE SYSTEM SHALL path-specific PRMからSupabase AS metadata、DCR、S256 PKCE、consentへ到達させる。 | 2, 5 | Hosted + 実client E2E |
| AC-02 | WHEN authorization/token requestを行う場合、THE SYSTEM SHALL 両方へ同一canonical RFC 8707 resourceを要求し、発行tokenのaudienceをexact検証する。 | 2, 5, 6 | Hosted resource/aud test |
| AC-03 | WHEN consentを表示する場合、THE SYSTEM SHALL 検証済みclient名とデッキ参照・private card作成/編集/削除を日本語表示し、拒否を同等操作として提供する。 | 5.2 | unit/component + browser |
| AC-04 | IF tokenが未認証、期限切れ、失効、署名/issuer/audience/algorithm/client/session/grant不正である場合、THE SYSTEM SHALL tool dispatch前に401を返す。 | 6 | JWT unit + Hosted revoke |
| AC-05 | WHEN MCP toolがDBへ接続する場合、THE SYSTEM SHALL 検証済みJWTをrequest-scoped Supabase clientへ伝播し、actorを`auth.uid()`とRLSから導出する。 | 4.2, 4.4, 6 | actor/RLS matrix |
| AC-06 | WHEN standard scopeが要求される場合、THE SYSTEM SHALL PRM、401 challenge、8 tool security schemesをexact `openid email profile`にし、`phone`/custom scopeを拒否する。 | 5, 6, 7 | scope/descriptor tests |
| AC-07 | WHEN ownerがlist→preview→commit→statusを実行する場合、THE SYSTEM SHALL本人deckへR1/W1 private cardを既存async flowで登録する。 | 8, 9 | integration + 2 E2E |
| AC-08 | IF previewが無い、改ざん/期限切れ/差替え、または他owner IDである場合、THE SYSTEM SHALL副作用0のsafe errorを返す。 | 8.3, 8.4 | snapshot integration |
| AC-09 | WHEN同一owner/key/hashのcommitを再送する場合、THE SYSTEM SHALL同じbatchを返しcard/job/messageを増やさず、別hashなら`CONFLICT`にする。 | 8.4, 9.3 | idempotency integration |
| AC-10 | WHEN既知toolのdomain failureが起きる場合、THE SYSTEM SHALL protocol errorではなく`isError`とstable safe codeを返す。 | 7, 10 | mapper/SDK contract |
| AC-11 | IF未知toolまたはmalformed MCP requestである場合、THE SYSTEM SHALL安全なMCP protocol errorを返しdomain serviceを呼ばない。 | 7 | SDK contract |
| AC-12 | WHEN update/delete/undoを行う場合、THE SYSTEM SHALL S-13のAI private/owner/active/conflict/atomic/cleanup契約を再利用する。 | 8.7〜8.9 | DB integration |
| AC-13 | WHEN consentを拒否またはgrantを解除する場合、THE SYSTEM SHALL grant/tokenを新規利用不能にし、旧access tokenの次requestを401にする。 | 2, 5.3, 6 | Hosted deny/revoke + E2E |
| AC-14 | IF `MCP_ENABLED`がexact trueでない場合、THE SYSTEM SHALL fixed PRMを維持しつつendpoint/tool/approveをfail closedで停止し、アプリ内AI機能を継続する。 | 11 | unit + app regression |
| AC-15 | WHILE productionでMCPを有効にする場合、THE SYSTEM SHALL RS256またはES256署名だけを受理する。 | 2, 6 | Hosted signing + JWT unit |
| AC-16 | WHEN error/logを生成する場合、THE SYSTEM SHALL stack、SQL/provider body、secret、token、card本文を含めない。 | 7, 10 | sanitization tests |
| AC-17 | WHEN Hosted/実client gateが未実施または不合格の場合、THE SYSTEM SHALL受入完了と判定しない。 | 2, 12 | evidence checklist |
| AC-18 | WHEN request scopeを判定する場合、THE SYSTEM SHALL Hostedで証明したactive grant/hook sourceだけを使い、JWT scope claimを仮定しない。 | 2, 6 | Hosted grant/source test |
| AC-19 | WHEN ChatGPTがtool-level reauthを要求する場合、THE SYSTEM SHALL `_meta["mcp/www_authenticate"]`で同じchallengeを返し、初期認証はHTTP 401のままにする。 | 7 | ChatGPT linking/reauth |
| AC-20 | WHEN remote preview tokenを検証する場合、THE SYSTEM SHALL v2をverified clientへ結合してcross-client replayを拒否し、UI v1を維持する。 | 8, 9 | token contract test |
| AC-21 | WHEN SDK候補を採用する場合、THE SYSTEM SHALL Next 14 Web Route compile/test/build spikeに合格したadapterだけを使用する。 | 2, 4, 7 | compile integration spike |

## 14. 実装対象候補

- `frontend/package.json` / lockfile（SDK v1とpeer dependencyのexact pinのみ）
- `frontend/src/lib/env.ts`
- `frontend/src/lib/supabase/server.ts`
- `frontend/src/lib/mcp/*`
- `frontend/src/lib/ai-import/service.ts`
- `frontend/src/lib/ai-card-management/service.ts`
- `frontend/app/api/mcp/route.ts`
- `frontend/app/.well-known/oauth-protected-resource/api/mcp/route.ts`
- `frontend/app/oauth/consent/page.tsx`
- `frontend/app/(auth)/oauth/connections/page.tsx`
- `frontend/src/actions/oauth-actions.ts`
- 既存AI import Route / AI management Actionの共通serviceへの収束
- `frontend/middleware.ts`
- `supabase/migrations/<timestamp>_s14_remote_mcp_authenticated_wrappers.sql`
- `frontend/src/types/database.ts` / `database.typecheck.ts`
- S-14 unit/DB integration/contract test files（原則`frontend/src/**/*.test.ts(x)`。`specs/`配置時は`frontend/vitest.config.ts`/`tsconfig.json`を更新）

## 15. 外部設定・repo境界

| 項目 | repoで自動化可能 | Hosted/手動確認が必要 |
|---|---|---|
| PRM、MCP route、tool/schema/error | 実装・Vitest | public HTTPSでclient discovery |
| JWT cryptographic/claim validation | fixture test | 実JWKS、signing rotation、RS/ES |
| OAuth Server/DCR/PKCE | client-side contract mock | dashboard有効化、実metadata/registration |
| consent UI/actions | component/contract test | Hosted authorization_id approve/deny |
| resource/audience | exact config/unit test | authorization/token pass-throughと発行claim |
| JWT-scoped RLS | isolated DB actor test | Hosted Data APIで実token確認 |
| refresh/revoke | boundary mock | Claude/ChatGPT refresh、old token liveness |
| rollback | flag regression | DCR disable、全grant/session/token失効 |

## 16. リスクと未解決事項

### 実装開始を止める外部リスク

- Supabase OAuth ServerがRFC 8707 resourceをtoken audienceへ反映できるか未証明。
- MCP exact audienceとSupabase Data APIの`authenticated` audience/RLSを同一tokenで両立できるか未証明。
- standard scopeだけでChatGPT/Claudeのrefreshが成立するか未証明。
- active grantまたはdocumented hookからrequestごとのexact granted scopeを取得できるか未証明。
- revoked grantを既発行access tokenの次requestでsupported APIから判定できるか未証明。

これらはSection 2のhard gateで解消する。解消できない場合はblockedであり、設計内のfallback実装はない。

### gate通過後に実装時確定する事項

- SDK v1とzodのexact versionはNext 14 Web Route compile integration spike合格後だけ固定する。Express-onlyで安全なbridgeを実証できなければSDK採用を再検討し、v2 betaへ自動移行しない。
- Supabase OAuth SDK operationのexact API surfaceとgrant/session liveness照合経路はHosted spikeでdocumented/supported形を確定する。
- root PRM aliasはClaude/ChatGPT実接続で必要な場合だけ同一metadata aliasとして追加し、canonical resourceを増やさない。

## 17. 公式参照資料（2026-07-19確認）

- Supabase OAuth Server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase OAuth getting started: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Supabase OAuth flows: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- Supabase MCP authentication: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- Supabase token security: https://supabase.com/docs/guides/auth/oauth-server/token-security
- Supabase JWT/JWKS: https://supabase.com/docs/guides/auth/jwts
- Supabase sessions: https://supabase.com/docs/guides/auth/sessions
- Supabase revoke grant: https://supabase.com/docs/reference/javascript/oauth-server-revokegrant
- MCP Authorization 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP Streamable HTTP 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Tools 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP TypeScript SDK v1: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
- Anthropic Remote MCP custom integrations: https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers
- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI MCP server guide: https://developers.openai.com/apps-sdk/build/mcp-server

## 18. 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-07-19 | 1.0.0 | 初版。Hosted hard gate、OAuth/resource/JWT/RLS、SDK v1、8 tools、consent/revoke、test/release gateを定義 |
| 2026-07-19 | 1.0.1 | exact scope/challenge/security schemes、scope証明元、SDK compile spike、RPC抽出、repository分離、consent継続、preview v2、canonical commit/error/test契約を補強 |
