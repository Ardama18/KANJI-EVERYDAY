# Frontend アーキテクチャ（Next.js 16）

## 技術スタック

- **フレームワーク**: Next.js 16（App Router）
- **言語**: TypeScript
- **UI**: React 19 + Tailwind CSS 4
- **データ取得**: `apiClient` + custom hooks
- **テスト**: Vitest（unit/integration）+ Playwright（E2E）

## ディレクトリ構成

```
frontend/
├── app/                      # ルーティング、ページ、レイアウト
│   ├── child/
│   ├── parent/
│   ├── layout.tsx
│   └── page.tsx
├── src/
│   ├── components/           # 再利用コンポーネント
│   ├── hooks/                # ドメイン別hooks（api hooks含む）
│   ├── contexts/             # 認証・プロフィール等のContext
│   ├── lib/                  # api-client等の基盤処理
│   └── types/                # フロント固有型
├── middleware.ts             # /api, /auth, /uploads をBackendへプロキシ
├── e2e/                      # Frontend起点のE2E
└── tests/                    # unit / integration
```

命名規則は `.claude/rules/naming-convention.md` を参照。

## データ通信戦略

### 1. クライアント側API呼び出し

- 基本は `src/lib/api-client.ts` の `apiClient<T>()` を使用
- リクエスト先は相対パス（例: `/api/tasks/today`）
- `credentials: include` でCookie認証を維持

### 2. プロキシ方式

- `middleware.ts` が `/api/*`, `/auth/*`, `/uploads/*` を backend に転送
- Cookie を双方向に引き継ぎ、同一オリジン運用を実現

### 3. 画面責務

- `app/*/page.tsx`: 画面エントリとページ構成
- `src/components/*`: UI分割
- `src/hooks/api/*`: API通信・キャッシュ制御

## コンポーネント設計方針

- 対話/状態管理がある箇所は Client Component（`"use client"`）
- 画面単位の専用コンポーネントは `app` 配下に配置する場合あり
  - 例: `parent/approval-center/ApprovalCenterClient.tsx`

## 参照先

- 命名規則: `.claude/rules/naming-convention.md`
- フロントAPIパターン: `.claude/steering/frontend-api-patterns.md`
