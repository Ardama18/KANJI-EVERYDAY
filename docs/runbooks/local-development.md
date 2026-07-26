# Local development runbook

この runbook は、`KANJI-EVERYDAY` をローカルで起動し、主要 feature flag と品質コマンドの前提を確認するための手順である。secret、token、cookie、実credential、実環境固有URLは記録しない。

## 1. 前提

- Node.js と npm が利用できる。
- `frontend/` の依存関係が導入済みである。
- Supabase の接続先が用意され、必要な migration と seed が適用済みである。
- DB統合テストを実行する場合は、共有DBやproduction DBではなく、migration適用済みの隔離DBを使う。

## 2. 環境変数

`frontend/.env.local.example` を確認し、`frontend/.env.local` を作成する。実値はcommit、ログ、Issue、PR、テスト証跡へ残さない。

必須の公開Supabase設定は次の2件である。

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

server側で必要な値は `SUPABASE_SERVICE_ROLE_KEY` などに設定する。値そのものはこのrunbookに書かない。

## 3. ローカル起動

`frontend/` で Next.js を起動する。

```bash
cd frontend
npm exec -- next dev
```

既定URLは `http://localhost:3000` である。このリポジトリの `frontend/package.json` には `dev` script がないため、`npm run dev` は案内しない。

## 4. Feature flags

feature flag は文字列 `true` のときだけ有効になる。未設定、空文字、`false`、`TRUE`、`1` は無効として扱う。

| Key | 対象 | 有効条件 | 無効時 |
|---|---|---|---|
| `AI_CARD_IMPORT_ENABLED` | AIカードimport受付 | trim後に `true` | 新規import入口を閉じる。既存データは削除しない |
| `AI_CARD_MANAGEMENT_ENABLED` | AIカード管理UI/route | 厳密に `true` | 管理機能を閉じる。前後空白付き ` true ` は無効 |
| `MCP_ENABLED` | MCP endpoint / tool dispatch | trim後に `true` | MCP endpointはfail closedする |

AIカードやMCPを実行するには、flag以外のserver-only secretやprovider設定も必要になる。secret値はexampleやrunbookへ書かない。

## 5. MCP URL settings

MCPを有効にする場合は、次のURL設定も必要である。

| Key | 用途 | 形式 |
|---|---|---|
| `MCP_PUBLIC_ORIGIN` | MCPサーバー自身の公開origin | HTTPS origin。path、query、hash、userinfo不可 |
| `MCP_OAUTH_ISSUER` | Supabase OAuth issuer | HTTPS URLでpathは `/auth/v1` |
| `MCP_ALLOWED_ORIGIN` | 許可するMCP client origin | HTTPS origin。path、query、hash、userinfo不可 |

MCPを使わない通常のローカル起動では、`MCP_ENABLED=false` のままにし、URL設定は空値でよい。

## 6. 品質コマンド

通常はリポジトリルートから次を実行する。

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

`check` は lint、typecheck、Vitest をまとめて実行する。

```bash
npm --prefix frontend run check
```

ただし、現在のVitest inventoryにはDB依存suiteが含まれる。`S10_TEST_DATABASE_URL` が未設定の場合、対象suiteはfail-fastし、`check` 全体も非ゼロ終了し得る。この場合、`check` を成功扱いしてはいけない。

隔離DBがない場合は、次を実行し、DB統合テストは未実行として報告する。

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test -- <対象の非DBテストファイル>
```

`S10_TEST_DATABASE_URL` が共有DBまたはproduction DBを指す可能性がある場合、DB依存suiteを実行しない。共有DBをfallbackに使って品質ゲートを通した扱いにしない。
