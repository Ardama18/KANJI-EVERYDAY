# ChatGPT MCP 接続トラブルシューティング

この runbook は、ChatGPT の開発者モードから KANJI-EVERYDAY のリモート MCP を追加するときに、接続失敗の原因をレイヤーごとに切り分けるための手順である。

対象は S-14 の Hosted OAuth 互換性確認環境であり、本番稼働を示す文書ではない。secret、token、cookie、認可コード、PKCE verifier、カード本文、原文 prompt、画像 bytes、Storage path は記録しない。PKCE は、認可コードの横取りによる不正な token 交換を防ぐ仕組みである。

## 1. 正常な接続フロー

```text
ChatGPT
  -> Protected Resource Metadata を取得
  -> Supabase OAuth へ DCR（動的クライアント登録）
  -> authorize -> KANJI-EVERYDAY login -> consent
  -> Authorization Code + PKCE で token を取得
  -> /api/mcp を initialize
  -> tools/list で9ツールを取得
  -> tools/call を実行
```

OAuth の認可成功と MCP の接続成功は別のゲートである。consent の「許可」後に ChatGPT が一般的な接続エラーを表示しても、OAuth が失敗したとは限らない。

## 2. ChatGPT 側の正しい設定

| 項目 | 設定 | 注意点 |
| --- | --- | --- |
| MCP URL | `<MCP_PUBLIC_ORIGIN>/api/mcp` | Vercel のデプロイごとに変わる URL ではなく、安定した alias を使う |
| クライアント登録 | DCR | ChatGPT が Supabase OAuth client を動的登録する |
| デフォルトスコープ | `openid`、`email`、`profile` | 3つだけを指定する |
| 基本スコープ | `openid`、`email`、`profile` | 重複指定されても最終要求が同じ3つになることを確認する |
| OAuth issuer | Hosted Supabase の `/auth/v1` | local Supabase を実クライアント接続先にしない |
| OIDC | 有効 | OIDC は OpenID Connect の略で、認証済みユーザー情報を取得する仕組み |

サーバー側の主要設定は次の組み合わせにする。

```dotenv
MCP_ENABLED=true
MCP_PUBLIC_ORIGIN=https://<stable-origin>
MCP_OAUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
MCP_ALLOWED_ORIGIN=https://chatgpt.com
```

`MCP_ALLOWED_ORIGIN` は ChatGPT 単独なら上記の値にする。TimeCoin や Claude など複数 client origin を同時に許可する場合は、`https://chatgpt.com,https://timecoin-cloud.vercel.app,https://claude.ai` のようにカンマ区切りで設定する。`MCP_PUBLIC_ORIGIN` は末尾に path を含めない。canonical resource は常に `<MCP_PUBLIC_ORIGIN>/api/mcp` である。

## 3. 接続成功の判定

次をすべて満たした場合だけ ChatGPT 接続成功とする。

- DCR が成功し、OAuth client が登録される。
- login と consent が完了する。
- token endpoint が HTTP 200 を返す。
- userinfo endpoint が HTTP 200 を返す。
- 未認証の `/api/mcp` が HTTP 401 と Bearer challenge を返す。
- Protected Resource Metadata が HTTP 200 を返し、canonical resource と exact scopes を示す。
- 認証済み `initialize` が HTTP 200 を返し、protocol version `2025-11-25` を合意する。
- 認証済み `tools/list` が HTTP 200 を返し、9ツールを返す。
- 全9 descriptor に `title`、`description`、`inputSchema`、`outputSchema`、`annotations.openWorldHint=false` がある。
- 全9 descriptor の top-level `securitySchemes` と `_meta.securitySchemes` が一致し、scopes が `openid email profile` だけである。
- 少なくとも1つの安全な read tool を実行できる。

HTTP 200 だけでは成功とみなさない。JSON-RPC response body と tool descriptor の内容まで確認する。

## 4. 症状別の切り分け

| 症状 | 主に疑うレイヤー | 最初に確認すること |
| --- | --- | --- |
| consent 画面まで進まない | discovery / DCR | MCP URL、Protected Resource Metadata、Supabase の DCR 設定 |
| 「連携を確認できません」 | authorization request | `authorization_id`、有効期限、Host、同じ Hosted Supabase project の session |
| 新規登録で環境設定エラー | Hosted auth / application env | Supabase URL、公開 key、signup 設定、対象 project の一致 |
| 「許可」で client-side exception | consent 実装 | browser console、server log、client-side redirect や Server Action 境界 |
| 「許可」後に ChatGPT が接続エラー | token / MCP / descriptor | token exchange、access token の audience、`initialize`、`tools/list` の順に確認 |
| 接続できたが「アクションなし」 | MCP descriptor | 9ツールの件数と必須 descriptor fields を確認 |
| token 発行後の MCP が401 | authorization boundary | access token の audience、grant、session、exact scopes |
| preview は成功するが commit だけ `UNAUTHORIZED` | preview HMAC / runtime config | Vercel と Supabase の preview 署名secretが同じか、`remote_mcp` batch が作成されたかを確認 |
| 新しいコネクターでも同じエラー | server contract | コネクターを増やさず、直前の失敗レイヤーを修正する |
| 特定ブラウザだけ失敗 | browser state | server-side gate が全て通った後でだけ cookie、拡張機能、キャッシュを疑う |

## 5. 今回つまずいたポイント

### 5.1 OAuth 成功と tool 利用可能は別

login、consent、token exchange が成功しても、ChatGPT はその後に MCP の `initialize` と `tools/list` を検証する。一般的な「接続で問題が発生しました」という表示だけで原因レイヤーを決めない。

### 5.2 access token と ID token の audience は異なる

audience は token の利用先を表す値である。

- access token の `aud` は canonical MCP resource の `<MCP_PUBLIC_ORIGIN>/api/mcp`。
- ID token の `aud` は DCR で登録された OAuth `client_id`。

両方を MCP resource に揃えようとすると OIDC の契約を壊す。

### 5.3 Vercel の URL を固定する

デプロイごとに変わる preview URL を resource、redirect、token audience に使うと、次回デプロイで値が食い違う。`MCP_PUBLIC_ORIGIN` には安定した branch alias または custom domain を設定し、ChatGPT にも同じ origin の `/api/mcp` を登録する。

### 5.4 `authorization_id` は UUID とは限らない

Supabase が渡す authorization ID は opaque identifier、つまり中身を解釈しない識別子として扱う。UUID parser に通さず、許可した文字種と長さだけを検証する。有効期限切れや不正値は安全なエラー画面にする。

### 5.5 consent の確定は server-side POST にする

approve / deny は通常の POST route で server-side に処理し、Supabase が返した公式 redirect だけへ HTTP 303 で遷移する。client component から response や redirect object を直接扱う構成は、ブラウザでの client-side exception を招きやすい。

### 5.6 descriptor は名前と schema だけでは不足する

ChatGPT 互換性のため、各 tool は少なくとも次を返す。

- 人が読める `title` と `description`
- `inputSchema` と実際の `structuredContent` に対応する `outputSchema`
- read / mutation / destructive 性を表す `annotations`
- 外部の未知な対象へアクセスしないことを示す `openWorldHint=false`
- top-level と `_meta` の双方に同じ OAuth `securitySchemes`

KANJI-EVERYDAY は次の9ツールだけを公開する。

1. `list_decks`
2. `create_deck`
3. `preview_card_import`
4. `commit_card_import`
5. `get_import_status`
6. `list_ai_cards`
7. `update_ai_card`
8. `delete_ai_cards`
9. `undo_import_batch`

### 5.7 HTTP boundary を狭めすぎない

ChatGPT と MCP SDK の実リクエストを受けられるよう、現在の実装は JSON として解釈可能な次の Content-Type を許可する。

- header なし、または空
- `application/json`
- `application/json-rpc`
- `text/plain`

Accept は `application/json`、`text/event-stream`、`*/*` を許可する。notification の HTTP 202 と request の HTTP 200 を区別する。

同時に Host と Origin は厳格に検証する。CORS はブラウザから許可する送信元を制限する仕組みであり、`MCP_ALLOWED_ORIGIN` に含まれない Origin は拒否する。

### 5.8 Hosted Supabase と local Supabase の役割は別

MCP のためだけに Hosted Supabase project を2つ用意する必要はない。

- Hosted Supabase: ChatGPT の DCR、login、consent、token、OIDC、実接続 gate。
- local の隔離DB: migration、RLS、RPC、失敗系、繰り返し可能な自動テスト。

local DB のテスト成功を Hosted OAuth の成功証跡として扱わず、Hosted OAuth の成功を DB migration / RLS の成功証跡としても扱わない。

### 5.9 新しいコネクターやブラウザを先に増やさない

DCR を選んでいるため、新しい ChatGPT コネクターを作るたびに Supabase OAuth client が増える可能性がある。server contract が壊れたままなら、コネクター名を変えても同じ場所で失敗する。

修正デプロイ後は、まず同じコネクターで接続を解除して再接続する。server-side gate が全て成功しているのに状態が更新されない場合に限り、コネクター再作成、別ブラウザ、キャッシュ削除の順で試す。

今回の事象では、consent 後に ChatGPT から認証済み MCP request が届いていたため、ブラウザ変更は根本対策ではなかった。

### 5.10 preview 成功・commit `UNAUTHORIZED` は署名secretの二重検証を疑う

リモート MCP の preview token は、Vercel の `AI_PREVIEW_HMAC_SECRET` で署名される。`commit_card_import` では Next.js に加えて、Supabase の `s14_private.remote_mcp_runtime_config` に保存した同じsecretでもHMACを再検証する。HMACは、secretを公開せずにtokenが改ざんされていないことを確認する仕組みである。

Vercel project を新しく作成した場合や環境変数を別projectへ移した場合、両者のsecretがずれると次の症状になる。

- `preview_card_import` は成功し、request hash、reservation key、preview token が返る。
- 同じ内容で直後に `commit_card_import` を実行しても tool result は `UNAUTHORIZED` になる。
- `/api/mcp` 自体は HTTP 200 であり、OAuth access token の401とは異なる。
- `ai_import_batches` に対応する `source='remote_mcp'` の行が作成されず、カードの部分登録もない。

この場合はブラウザ変更やコネクター再作成では直らない。次の順で復旧する。

1. Supabase と Vercel のどちらを署名secretの正本にするか決める。現行運用では Supabase の `s14_private.remote_mcp_runtime_config` を正本とする。
2. secret実値を標準出力、shell history、Markdown、一時的な証跡へ出さず、安全なパイプまたは管理画面で同じ値を Vercel の Production / Preview に設定する。
3. Vercel を再デプロイする。環境変数の更新だけで既存deploymentへ反映済みと判断しない。
4. 同期前に発行した preview token、reservation key、idempotency key を破棄する。
5. `preview_card_import` から新規に実行し、新しく返された値で直後に `commit_card_import` を実行する。
6. `ai_import_batches.source='remote_mcp'` のbatch作成と、対象deckのカード件数を確認する。

request内容が同じなら import request hash が同じになること自体は異常ではない。重要なのは、secret同期後のdeploymentで新しいpreview tokenを発行し直すことである。

2026-07-20 のHosted確認では、secret同期と再デプロイ後に同じChatGPTコネクターからpreviewを作り直し、10件のcommitとdeckへの登録が成功した。コネクター再作成やブラウザ変更は不要だった。

## 6. 推奨する診断順序

順番を飛ばさず、最初に失敗したレイヤーだけを修正する。

### Step 1: 安定した URL と環境変数

- ChatGPT の URL と `MCP_PUBLIC_ORIGIN` が同じ origin を指している。
- `MCP_OAUTH_ISSUER` が同じ Hosted Supabase project を指している。
- `MCP_ALLOWED_ORIGIN` が接続元 client origin を含む。ChatGPT 単独なら `https://chatgpt.com`、複数 client 併用ならカンマ区切りで指定する。
- `MCP_ENABLED=true` である。
- Vercel の `AI_PREVIEW_HMAC_SECRET` と Supabase の remote MCP runtime config が同じ値である。

### Step 2: Protected Resource Metadata

```bash
curl -i "https://<stable-origin>/.well-known/oauth-protected-resource/api/mcp"
```

HTTP 200、resource が `https://<stable-origin>/api/mcp`、scopes が `openid email profile` であることを確認する。

### Step 3: 未認証 challenge

```bash
curl -i \
  -X POST \
  -H 'Origin: https://chatgpt.com' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"diagnostic","version":"1"}}}' \
  "https://<stable-origin>/api/mcp"
```

HTTP 401 と、path-specific metadata URL および exact scopes を含む `WWW-Authenticate` を期待する。token を shell history や Markdown に貼らない。

### Step 4: DCR、login、consent、token

ChatGPT から接続を開始し、Hosted Supabase 側で次を順に確認する。

1. OAuth client がDCRで登録された。
2. 同じ Hosted project のユーザーで login できた。
3. consent で正しい deck/card 権限が表示された。
4. approve 後の token endpoint が200になった。
5. userinfo endpoint が200になった。

token、認可コード、cookie、authorization ID の実値は証跡へ保存しない。

### Step 5: MCP initialize

認証済みリクエストが `/api/mcp` に到達し、HTTP 200 と protocol version `2025-11-25` を返すことを確認する。401なら access token の audience、active grant、active session、exact scopes を確認する。

### Step 6: tools/list

HTTP status だけでなく response body を確認する。

- tool 数は9。
- tool 名は固定 allowlist と一致する。
- 全9件に `title`、`description`、`inputSchema`、`outputSchema` がある。
- `openWorldHint=false` である。
- top-level と `_meta` の `securitySchemes` が一致する。

「利用できるアクションはありません」は、まずこのレイヤーの不整合を疑う。

### Step 7: 最小の tool call、commit、revoke

1. `list_decks` のような read-only tool を1回実行する。
2. deck がない場合だけ `create_deck` を実行する。
3. `preview_card_import` を実行し、内容を確認する。
4. 同じpreview結果を使って直後に `commit_card_import` を実行する。
5. `get_import_status` をterminal状態までpollし、対象deckのカード件数と `remote_mcp` batch を確認する。
6. 接続を解除する。
7. 旧 access token が次の request で401になることを確認する。

preview成功後にcommitだけ `UNAUTHORIZED` になり、対応する `remote_mcp` batch が0件なら、Step 5へ戻るのではなく5.10の署名secret整合性を確認する。

## 7. 証跡とログ

記録してよいもの:

- 実行日時
- 対象 git SHA
- secretを含まない public URL
- Hosted Supabase project ref
- client 名と version
- OAuth / MCP の処理段階
- HTTP status
- MCP protocol version
- tool 名、tool 件数、descriptor の有無を示す boolean
- secretや個人情報を含まないエラー分類

記録してはいけないもの:

- API key、client secret、HMAC secret
- access token、refresh token、ID token
- authorization code、PKCE verifier、cookie
- authorization ID の実値
- カード本文、原文 prompt、画像 bytes、Storage path
- ユーザーのメールアドレスなどの個人情報

chat、issue、console、screen capture に credential を貼った場合は、その credential を失効・再発行してから作業を続ける。

## 8. 再発防止チェックリスト

- [ ] MCP URL は安定した origin の `/api/mcp` である。
- [ ] Protected Resource Metadata と Bearer challenge は path-specific URL を使う。
- [ ] scopes は `openid email profile` だけである。
- [ ] access token と ID token の audience を混同していない。
- [ ] consent の authorization ID を opaque identifier として扱う。
- [ ] approve / deny は server-side POST と公式 redirect を使う。
- [ ] `initialize` は MCP `2025-11-25` で成功する。
- [ ] `tools/list` は9件を返し、全 descriptor の必須項目を満たす。
- [ ] top-level と `_meta` の OAuth security schemes が一致する。
- [ ] HTTP status だけでなく JSON-RPC body を検証する。
- [ ] Vercel と Supabase の preview 署名secretを同じ値で管理している。
- [ ] 署名secret変更後に再デプロイし、同期前のpreview tokenを再利用していない。
- [ ] preview、commit、status poll、`remote_mcp` batch作成、対象deckのカード件数を一続きで確認した。
- [ ] server contract を直す前にコネクターを増やしていない。
- [ ] ログと証跡に secret、個人情報、カード内容を残していない。
- [ ] Hosted live-client gate と local DB gate を別々に記録する。

## 9. 関連資料

- [AIカード import release runbook](./ai-card-import.md)
- [ADR-011: Supabase OAuth remote MCP security boundary](../../specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md)
- [S-14 requirements](../../specs/stories/S-14-ai-card-remote-mcp-oauth/requirements.md)
- [S-14 design](../../specs/stories/S-14-ai-card-remote-mcp-oauth/design.md)
- [OpenAI Apps SDK: Authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI Apps SDK: Build your MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [MCP Authorization specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Streamable HTTP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
