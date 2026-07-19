---
id: ADR-011
feature: ai-card-remote-mcp-oauth
type: adr
version: 1.0.1
created: 2026-07-19
updated: 2026-07-19
status: Accepted
based_on: specs/stories/S-14-ai-card-remote-mcp-oauth/requirements.md
related_epic: GH-9
---

# ADR-011: Remote MCPはSupabase OAuth互換性gateとJWT/RLS境界の内側に置く

## ステータス

Accepted

## コンテキスト

S-14はClaude、ChatGPTなどのpublic OAuth clientへ、本人所有のAI private cardだけを扱うRemote MCPを公開する。既存S-10〜S-13にはimport schema、preview HMAC、transactional async commit、status、管理・undo、RLSがある。一方、現行UI import Routeの一部はcookie認証後にservice role専用RPCを呼び、Issueが参照する共通`ai-import/service.ts`はまだ存在しない。このままMCP adapterへ複製すると、Bearer JWTのactor/RLS境界とUIのdomain意味が分岐する。

さらにMCP Authorization仕様2025-11-25はRFC 8707 `resource`をauthorization requestとtoken requestの両方に要求し、resource serverへ発行されたaudienceを厳密に検証する。Supabase OAuth Serverの公式資料はPKCE、DCR、標準scope、`client_id`/`session_id` claim、JWKS、custom access token hookを説明するが、`resource`の保持、MCP resource audienceの発行、標準scopeだけでのrefresh、既発行access tokenの即時grant失効を完全には保証していない。既定access token例の`aud`は`authenticated`であり、custom hook例も文字列audienceだけである。

したがって、repo実装だけで互換性を推測せず、Hosted Supabaseで標準フローを先に実証する必要がある。失敗時に同Story内でOAuth facadeや別Authorization Serverを足すと、認証責務と運用面が大きく変わる。

## 決定事項

### 1. Hosted OAuth/MCP互換性spikeを実装前のhard gateにする

production code、依存、migrationを追加する前に、disposableなHosted Supabase projectと標準OAuth test clientで次を検証する。

- authorization server metadata、DCR、Authorization Code + S256 PKCE、consent approve/denyが成立する。
- canonical resourceを`https://<app-origin>/api/mcp`とし、authorization requestとtoken requestの両方へ同一の`resource`を渡せる。
- access tokenの`iss`、`sub`、`role`、`client_id`、`session_id`、`aud`がMCP resource serverの厳密検証とData APIのauthenticated/RLS利用を同時に満たす。
- custom access token hookでaudienceを変える場合、文字列または配列の実際のHosted挙動、Data API互換性、RS256/ES256署名を確認する。`["authenticated", canonical-resource]`を使えることは公式資料から推定しない。
- `openid email profile`だけでrefreshがClaudeとChatGPTの接続契約を満たす。`offline_access`は要求・追加しない。
- requestごとのgranted scopeを、`client_id`で照合したactive `getUserGrants`相当またはdocumented custom hook claimから取得できる。JWTにscope claimがあるとは仮定しない。
- denyはgrant/tokenを作らず、grant revoke後はsession/refresh tokenが失効し、既発行access tokenも次のMCP requestでliveness検査により拒否できる。

1項目でも満たせない場合はS-14の実装を停止する。OAuth facade、token exchange、別Authorization Serverは今回のscopeに追加せず、新しいADRと再設計を必要とする。

### 2. MCP transportに公式TypeScript SDK v1系を限定採用する

実装時点でMCP 2025-11-25をproduction向けにサポートする`@modelcontextprotocol/sdk` v1系を候補とし、lockfileで解決したexact versionとpeer requirementを満たす`zod`で、Next 14 Web Route Handlerのdependency/compile integration spikeを先に通す。v2 betaは採用しない。

SDKはStreamable HTTP、protocol negotiation、JSON-RPC lifecycle、tools capabilityの処理だけに使用する。domain schema、canonical hash、preview token、RPC、stable error code、OAuth serverはSDK型を正本にしない。spikeは実package exportからWeb `Request`/`Response` adapterをcompile/testし、特定classや`enableJsonResponse` optionを存在確認前に仮定しない。Express-onlyならtested bridgeの安全性を示すか、SDK採用判断を再検討してADRを更新する。MCP transport sessionをbatch/jobの正本にせず、GET SSEを提供しない構成ではGETへ405を返す。

### 3. OAuth resourceと認証検査を単一境界へ固定する

- Protected Resource Metadataをpath-specific well-known URLから提供し、canonical resourceは公開originの正規化済み`/api/mcp` URL、`scopes_supported`はexact `['openid','email','profile']`とする。互換aliasを提供する場合も同じmetadataを返す。
- 全HTTP 401は`WWW-Authenticate: Bearer resource_metadata="...", scope="openid email profile"`でchallengeする。
- Authorization headerのBearer tokenだけを受理する。cookie、query、bodyのtokenは認証へ使用しない。
- 各requestでJWKS/`getClaims`相当の署名検証を行い、production algorithmをRS256/ES256にallowlistし、exact issuer、canonical audience、`exp`/`nbf`、authenticated role、UUID `sub`、`client_id`、`session_id`を検証する。
- JWKS key cacheは許容するが、認証成功、session/grant livenessをrequest間でcacheしない。
- livenessは現在のsessionとactive grantをSupabaseのdocumented/supported境界で照合する。granted scopeも`client_id`で照合したactive grant、またはdocumented custom hook claimのうちHosted gateで証明したsourceから毎回得る。JWT scope claimを仮定しない。内部auth table形状を未検証のままapplication契約にしない。
- 検証済みaccess tokenをSupabase clientの`accessToken` callbackへ渡し、`auth.uid()`、RLS、authenticated wrapperを全toolのread/mutationへ適用する。service role clientへcaller user IDを渡してowner境界を代替しない。

### 4. standard scopeではなくallowlist、client/grant、actor、RLSで認可する

要求scopeは`openid email profile`だけとし、`phone`、未知scope、custom scopeを拒否する。8 tool descriptorすべてへOpenAI OAuth `securitySchemes`とexact 3 scopesを付ける。初期認証はHTTP 401で返す。ChatGPT実clientがtool call中のreauth challengeを要求する場合だけ、tool resultの`_meta["mcp/www_authenticate"]`で同じchallengeを返す。card操作の認可は8 toolの静的allowlist、検証済みJWTの`client_id`、active grant/session、JWT actor、RLS、owner-scoped RPCで行う。

### 5. transport非依存application serviceへUIとMCPを収束する

既存S-10〜S-13のschema/RPC/error契約を抽出してapplication serviceとrepository境界を設け、UI Route/Server ActionとMCP adapterを同じ意味へ収束させる。`source='remote_mcp'`はMCP trusted adapterが固定する。既存service-role-only import primitiveは直接公開せず、JWT actorをDB側で導出するauthenticated wrapperへ収束する。

previewはwrite-freeとし、TS application serviceが`AI_PREVIEW_HMAC_SECRET`でremote token v2を発行・検証する。remote token v2はverified `client_id`へ結合し、UI token v1を維持してcross-client replayを拒否する。さらにauthenticated remote commit wrapperはDB-local `app.ai_preview_hmac_secret` GUCで同じpreview token HMACを再検証し、MCP Routeを通らないData API直叩きではcommitできないfail-closed境界にする。DBはactor/hash/reservation/idempotencyを原子的に再検証する。現行`commit_import_async`/`get_ai_import_status`はinternal primitiveではないため、bodyをungranted owner-only internalへ抽出し、既存service-role wrapperを互換維持した上でS-14 authenticated wrapperを追加する。UI/app_ai repositoryとremote_mcp repositoryを分け、UIをOAuth wrapperへ移さず、MCPではservice roleを使わない。管理はS-13 public wrapperを直接再利用し、複合patchだけatomic wrapperを追加する。

### 6. domain errorはtool result、auth/protocol errorは各層で返す

- auth failureはtool dispatch前のHTTP 401とし、`isError`へ降格しない。
- malformed JSON-RPC、unsupported protocol、unknown toolはMCP protocol errorとする。
- 認証済み既知toolのvalidation、owner、conflict、service failureは`isError: true`のtool resultで、既存stable codeとallowlist済みdetailだけを返す。
- stack、SQL/provider body、token、secret、card本文をresponse/logへ含めない。

### 7. feature flagとHosted revokeを別々のrollback境界にする

`MCP_ENABLED`はtrim後exact `true`だけを有効とする。false時はmetadata以外のMCP endpoint/toolをfail closedで停止し、新規mutationを行わない。完全rollbackはrepo flagに加え、Hosted DCR無効化と既存grant/session/refresh token失効を確認する。アプリ内AI生成、既存batch/worker/cleanup、管理、学習は継続する。

## 根拠と選択肢

### 選択肢1（採用）: 公式SDK v1 + Supabase OAuth hard gate + JWT/RLS application service

- 利点: protocol driftをSDKへ委ね、既存domain/RLSを正本に保ち、外部互換性の推測を実装へ持ち込まない。
- 欠点: Hosted spikeが通るまで実装を開始できず、SDKとpeer dependencyが追加される。

### 選択肢2: Streamable HTTP/JSON-RPCを手書きする

- 利点: dependencyを追加せず、必要なmethodだけを実装できる。
- 欠点: protocol negotiation、notification、error、transport仕様の追随責務がrepoへ入り、Claude/ChatGPT間の差異を生みやすい。

### 選択肢3: v2 beta/full frameworkまたはOAuth facadeを先行導入する

- 利点: 将来APIやOAuth差異を独自層で吸収できる可能性がある。
- 欠点: production向け安定性が不足し、Authorization Server責務、token exchange、秘密管理、監査を新設してS-14のscopeを超える。

| 評価軸 | 採用案 | 手書きtransport | beta/facade |
|---|---:|---:|---:|
| MCP仕様追随 | 高 | 低 | 中 |
| 既存domain/RLS再利用 | 高 | 中 | 低 |
| OAuth互換性の証拠 | 高 | 低 | 中 |
| scope/運用増加 | 中 | 低 | 高 |

## 影響

### ポジティブ

- service roleをowner認可へ使わず、外部AIもアプリと同じdomain/RLS不変条件を通る。
- Supabase OAuth betaの未証明部分をrelease後の障害ではなく、最初のgateで検出できる。
- SDK更新とdomain変更を分離し、8 toolのschema/error意味をS-10〜S-13へ固定できる。

### ネガティブ

- Hosted Supabaseと実clientを用いる手動/半自動gateが必要で、repo testだけでは受入完了にならない。
- authenticated import wrapper、atomic management patch、JWT-scoped client、consent/revoke UIの追加が必要になる。
- requestごとのsession/grant liveness照合には外部I/Oが加わる。

### 中立

- OAuth Server/DCR/署名鍵設定はHosted運用対象であり、migrationやNext.js codeだけでは完了しない。
- MCP transportはstatelessでも、import batchの冪等性とstatusはDBにより維持される。

## 実装への指針

- compatibility spikeのsanitized evidence、Hosted project識別子、日時、設定、未検証事項をrelease gateへ残す。token/code/verifier/secretは保存しない。
- originをallowlistし、Streamable HTTP requestのHost/Origin取り違えとDNS rebindingを防ぐ。
- consent client名/scopes/redirectはSupabaseの検証済みauthorization detailsから表示し、query文字列を信用しない。
- SDK dependency導入時は`frontend/package.json`とlockfileを同時に更新し、既存scriptだけでtest/check/buildする。

## 関連情報

- `specs/adr/ADR-007-ai-card-import-foundation.md`
- `specs/adr/ADR-008-ai-card-async-queue-image-processing.md`
- `specs/adr/ADR-009-openai-card-generation-safety-boundary.md`
- `specs/adr/ADR-010-ai-card-preview-source-status-ui-boundary.md`
- `specs/stories/S-14-ai-card-remote-mcp-oauth/design.md`
- Supabase OAuth Server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase MCP authentication: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- Supabase JWT: https://supabase.com/docs/guides/auth/jwts
- Supabase sessions: https://supabase.com/docs/guides/auth/sessions
- MCP Authorization 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP TypeScript SDK v1: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
- Anthropic custom integrations: https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers
- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth

## 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-07-19 | 1.0.0 | 初版。Hosted互換性hard gate、SDK v1限定採用、JWT/session/grant/RLS境界、rollbackを決定 |
| 2026-07-19 | 1.0.1 | exact scope/challenge/tool security、scope証明元、Next 14 SDK spike、RPC body抽出、client-bound preview v2を明確化 |
