# プロジェクトアーキテクチャ概要（Hapico）

## システム構成

```
┌──────────────────────────────────────────────────┐
│                    Browser                        │
│                 (localhost:3001)                  │
└──────────────────────┬───────────────────────────┘
                       │
             fetch('/api/*', '/auth/*')
                       ↓
┌──────────────────────────────────────────────────┐
│              Next.js Frontend                     │
│                 (localhost:3001)                  │
│  - App Router (`frontend/app`)                    │
│  - UI/Hook/Context (`frontend/src`)               │
│  - middleware で Backend へプロキシ               │
└──────────────────────┬───────────────────────────┘
                       │
             proxy to http://localhost:3000
                       ↓
┌──────────────────────────────────────────────────┐
│               NestJS Backend                      │
│                 (localhost:3000)                  │
│  - Module単位構成 (`backend/src/modules`)         │
│  - Prisma ORM / Session認証                       │
└──────────────────────┬───────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────┐
│                  PostgreSQL                        │
│                (Docker / Local)                   │
└──────────────────────────────────────────────────┘
```

## モノレポ構成

命名規則は `.claude/rules/naming-convention.md` を参照。

| ディレクトリ | 役割 |
|------------|------|
| `frontend/` | Next.js 16 + React 19 のWebアプリ |
| `backend/` | NestJS 11 APIサーバー |
| `shared/types` | 共有型パッケージ（workspace） |
| `e2e/` | ルート配下のE2Eシナリオ |
| `specs/` | ADR / Epic / Story / Plan |

## 技術スタック（現行）

| 分類 | 技術 |
|------|------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | NestJS 11, Prisma 6 |
| DB | PostgreSQL |
| 共通 | TypeScript, npm workspaces |
| テスト | Frontend: Vitest + Playwright / Backend: Jest |

## 設計原則

1. **機能単位の分割**: Backendは `modules/{domain}` で責務を分離
2. **境界の明確化**: Frontendは `app`（ルーティング）と `src`（再利用資産）を分離
3. **型安全性**: DTO・型定義・共有型で契約を明示
4. **最小差分変更**: 既存構造に合わせた拡張を優先
5. **ドキュメント駆動**: `specs/` の設計ドキュメントと実装整合を維持
