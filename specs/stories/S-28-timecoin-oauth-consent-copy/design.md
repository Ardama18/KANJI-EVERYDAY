# 設計: TimeCoin OAuth 同意画面のREST用途表示

## 現行調査

- `frontend/app/oauth/consent/page.tsx` は `getVerifiedAuthorization()` から `clientName` だけを受け取り、MCP 向け文言をハードコードしている。
- `frontend/src/lib/oauth/server.ts` は Supabase OAuth authorization details の `client.id` を検証しているが、返却 DTO には含めていない。
- `frontend/src/components/oauth/connections-client.tsx` は連携一覧で `この外部AIは直ちにカード操作できなくなります。` と表示している。
- TimeCoin REST API の実装は `frontend/app/api/timecoin/daily-study-status/route.ts` / `frontend/src/lib/timecoin/*` に分離済みで、カード作成・編集・削除を行わない。

## 方針

OAuth client 表示分類を `frontend/src/lib/oauth/client-display.ts` に集約する。

```ts
getOAuthClientDisplay(clientId, clientName)
```

この関数は、登録済み TimeCoin client id `4eaeedb5-f275-43d4-8a97-e00624849443` を検出した場合だけ TimeCoin REST API 用の表示定義を返す。それ以外は既存 MCP / 外部AI 用表示を返す。

client name だけで判定しない。名称は外部 client が同名を名乗れる可能性があるため、表示上の過小説明を避ける。

## UI 表示

### TimeCoin

- heading: `TimeCoin との連携を確認`
- permissions:
  - `本日の学習完了状態の確認`
- description:
  - `標準の本人確認情報（openid / email / profile）を使います。`
  - `TimeCoin には、学習完了判定に必要な contractVersion / date / state / completed だけを共有します。`
  - `デッキ名、カード内容、学習枚数は共有しません。`
- revoke notice:
  - `この連携は直ちに本日の学習完了状態を確認できなくなります。`

### MCP / 外部AI

既存表示を維持する。

- heading: `外部AIとの連携を確認`
- permissions:
  - `デッキ名の参照`
  - `非公開カードの作成・編集・削除`
- description:
  - `標準の本人確認情報（openid / email / profile）を使います。拒否してもアプリ内AI生成は引き続き利用できます。`
- revoke notice:
  - `この外部AIは直ちにカード操作できなくなります。`

## 変更対象

- `frontend/src/lib/oauth/server.ts`
  - `VerifiedAuthorization` と `OAuthConnection` に `clientId` を含める。
- `frontend/src/lib/oauth/client-display.ts`
  - OAuth client 表示分類を追加する。
- `frontend/app/oauth/consent/page.tsx`
  - 表示分類に基づいて heading / permission / description を描画する。
- `frontend/src/components/oauth/connections-client.tsx`
  - 表示分類に基づいて revoke notice を切り替える。
- `frontend/app/(auth)/oauth/connections/page.tsx`
  - ページ heading / 説明を `外部サービス連携` に一般化する。
- `frontend/app/(auth)/layout.tsx`
  - navigation link を `外部サービス連携` に一般化する。
- tests
  - server DTO が `clientId` を返すこと。
  - TimeCoin / MCP の表示分類。
  - source contract で consent と connection の文言出し分けを固定する。

## テスト戦略

Focused test:

```bash
npm --prefix frontend test -- src/lib/oauth/server.test.ts src/lib/oauth/client-display.test.ts src/lib/oauth/consent-ui.test.tsx
```

品質:

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
git diff --check
```

OAuth consent は Supabase hosted authorization id が必要なため、実ブラウザ E2E は本作業の必須 gate に含めない。文言・分類は source / unit test で固定する。
