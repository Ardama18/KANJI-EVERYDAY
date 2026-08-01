# 実行計画: TimeCoin OAuth 同意画面のREST用途表示

## Phase 1: OAuth client DTO と表示分類

対象:

- `frontend/src/lib/oauth/server.ts`
- `frontend/src/lib/oauth/server.test.ts`
- `frontend/src/lib/oauth/client-display.ts`
- `frontend/src/lib/oauth/client-display.test.ts`

実装:

- `VerifiedAuthorization` に `clientId` を追加する。
- `OAuthConnection` に既存どおり保持している `clientId` を表示分類へ利用する。
- `getOAuthClientDisplay(clientId, clientName)` を追加する。
- TimeCoin 判定は client id `4eaeedb5-f275-43d4-8a97-e00624849443` で行う。
- TimeCoin / MCP の表示定義を unit test で固定する。

## Phase 2: consent / connection UI の出し分け

対象:

- `frontend/app/oauth/consent/page.tsx`
- `frontend/src/components/oauth/connections-client.tsx`
- `frontend/app/(auth)/oauth/connections/page.tsx`
- `frontend/app/(auth)/layout.tsx`
- `frontend/src/lib/oauth/consent-ui.test.tsx`

実装:

- consent page で表示分類を使い、heading / permission / description を描画する。
- TimeCoin の場合は REST API の共有範囲だけを表示する。
- MCP client の既存文言は維持する。
- connection revoke notice は TimeCoin と MCP で出し分ける。
- connection page の見出しは `外部サービス連携` に一般化する。
- authenticated layout の連携リンクも `外部サービス連携` に一般化する。

## Phase 3: 検証

Focused test:

```bash
npm --prefix frontend test -- src/lib/oauth/server.test.ts src/lib/oauth/client-display.test.ts src/lib/oauth/consent-ui.test.tsx
```

Static checks:

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
git diff --check
```

必要に応じて、build は Supabase public env を明示して実行する。

## 完了条件

- issue #90 の受入条件を満たす。
- TimeCoin 用 consent に MCP のカード操作文言が出ない。
- MCP 用 consent には既存カード操作文言が残る。
- secret / token / authorization code を source、test、log に残さない。
- 変更範囲が plan の対象ファイルに収まる。
