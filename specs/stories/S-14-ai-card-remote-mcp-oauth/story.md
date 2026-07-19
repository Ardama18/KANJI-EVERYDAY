---
id: S-14
feature: ai-card-remote-mcp-oauth
type: story
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 11
parent_epic: 9
parent_story: S-10
---

# S-14: Supabase OAuth・Remote MCP

## ユーザーストーリー

既存の「まいにち漢字」ユーザーとして、ClaudeやChatGPTへ明示的に同意したうえで、自分のデッキを参照し、AIが作ったR1/W1の非公開カードをプレビュー後に登録・管理したい。なぜなら、アプリ内のowner境界と安全なimport契約を保ったまま、普段使う外部AIからカード作成を完結したいから。

## 解決する課題

- S-10〜S-13には共有schema、preview HMAC、冪等commit、async status、管理RPC、RLSがあるが、外部AIが利用できるOAuth認可済みRemote MCP transportはない。
- 外部AIへ与える権限をユーザーが日本語で確認・拒否・解除でき、失効後は既発行tokenでも操作できない境界が必要である。
- 現行のUI Routeは一部でcookie認証後にservice role RPCを呼ぶ一方、MCPではBearer JWTを毎回検証してRLSへ伝播しなければならない。owner境界をservice roleへ置き換えてはならない。
- Issueが参照する `frontend/src/lib/ai-import/service.ts` は現行treeに存在しないため、既存処理を複製せず、UI RouteとMCPが同じapplication-service契約へ収束する境界を定義する必要がある。

## スコープ

### 対象

- Supabase OAuth 2.1 Server、Authorization Code + PKCE、Dynamic Client RegistrationによるClaude/ChatGPT接続
- OAuth discovery、protected resource metadata、Bearer challengeを含むMCP認証discovery
- `/oauth/consent` の日本語同意・拒否UIと、既存grantの連携解除
- `/api/mcp` のStreamable HTTP MCP endpoint
- 署名・issuer・audience・期限・失効・`client_id`を毎回検証するBearer JWT境界
- JWTを伝播したauthenticated Supabase client、RLS、owner-scoped RPCによる8 tools
- S-10〜S-13のschema、preview、async status、管理、stable error codeの再利用
- `MCP_ENABLED`、DCR無効化、grant失効による段階的rollback
- repo内自動検証とHosted Supabase/実Claude/実ChatGPT release gateの分離

### 対象外

- custom OAuth scope
- public card操作、AIカードの公開・共有
- machine-to-machine client credentials
- アプリ内OpenAI生成UI、Queue worker、R2/W2、一般問題形式の再実装
- ship、merge、issue close、deploy

## 受入条件

1. ClaudeとChatGPTがOAuth discovery、DCR、Authorization Code + PKCE、日本語consentを完了してRemote MCPへ接続できる。
2. 未認証、期限切れ、失効、署名不正、issuer/audience不一致、許可されない署名方式のtokenはMCP tool実行前に401となる。
3. `list_decks -> preview_card_import -> commit_card_import -> get_import_status` の実フローで、本人所有deckへR1/W1 private cardを登録できる。
4. previewなし、preview token改ざん・期限切れ・内容差し替え、および別ユーザーのdeck/card/batch IDは副作用なしで拒否される。
5. 同一owner・同一idempotency key・同一requestの再送でbatch/card/messageが増えず、別requestでのkey再利用はconflictとなる。
6. 8 toolsが既存の共有schema、status、管理、stable error codeを利用し、tool domain errorはMCP protocol errorではなく `isError` tool resultとして返り、内部stack/provider body/secretを返さない。
7. consent拒否、ユーザーによる連携解除、grant/token失効後は全toolを実行できない。
8. 本番のaccess tokenはRS256またはES256だけを受理し、それ以外のalgorithmは拒否される。

## ロールバック

`MCP_ENABLED=false`でMCP endpointとtool実行をfail closedで停止する。Hosted Supabase側ではDCRを無効化し、既存grant/tokenを失効する。既存カード、batch、アプリ内AI生成、worker、管理画面、学習機能は継続可能とする。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/11
- Parent Epic: https://github.com/Ardama18/KANJI-EVERYDAY/issues/9
- Parent Story: `specs/stories/S-10-ai-card-import-foundation`
- Related Stories: S-11、S-12、S-13
- Accepted ADR: ADR-007、ADR-008、ADR-009、ADR-010
