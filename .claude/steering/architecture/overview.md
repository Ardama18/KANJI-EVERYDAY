# プロジェクトアーキテクチャ概要（まいにち漢字）

## システム構成

```text
Browser
  ├─ Server-rendered pages / Client Components
  └─ Supabase browser client（公開 anon key + user session）
          │
          ▼
Next.js 14 on Vercel
  ├─ App Router / Server Components
  ├─ Server Actions（認証、デッキ、学習、イラスト）
  └─ server-only utilities
          │
          ├─ Supabase Auth
          ├─ Supabase PostgreSQL + RLS
          ├─ Supabase Storage（private `illustrations`）
          └─ Gemini REST API（server only）
```

独立した API サーバーはない。`frontend/` の Next.js アプリが Web とサーバー境界を担い、永続化・認証・Storage は Supabase に委譲する。

## 主要な責務境界

| 境界 | 責務 |
|---|---|
| `frontend/app` | route、layout、SSR、redirect、ページ組み立て |
| `frontend/src/components` | 表示とユーザー操作。永続化の正本を持たない |
| `frontend/src/actions` | 認証済みユースケース、入力検証、所有権確認、データ更新 |
| `frontend/src/lib/srs` | I/O を持たない決定論的な SRS / queue ロジック |
| `frontend/src/lib/supabase` | browser / server / middleware client の生成境界 |
| `frontend/src/lib/illustration` | prompt、安全化、Gemini、Storage の統合 |
| `supabase/migrations` | schema、constraint、RLS、Storage policy の変更履歴 |
| `specs` | 要件と設計判断の正本 |

## データフロー

### 読み取り

`Page (Server Component) → Server Action / server client → Supabase → props → UI`

ページ初期表示は Server Component を優先する。ブラウザでしか必要ない状態だけ Client Component に渡す。

### 更新

`Client Component / Form → Server Action → auth + validation + owner check → Supabase → typed result → UI`

Server Action は公開境界として扱い、呼び出し元 UI を信頼しない。

### 学習セッション

`study_sessions` が永続状態の正本。`StudyClient` は表示状態を持てるが、再開可能性や評価結果をクライアントだけで確定しない。

## 設計原則

- Server Component をデフォルトにし、対話性が必要な最小範囲だけ `'use client'` にする。
- Supabase の RLS とアプリケーション層の所有権検証を重ねる。
- SRS と日付計算は純粋関数として保ち、外部 I/O から分離する。
- 外部画像生成は失敗を前提にし、学習フローをブロックしない。
- 新しい層・依存・サービスは、既存構成で要件を満たせない根拠がある場合だけ追加する。

## 正本

- client 分離: `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- DB / RLS: `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- 認証: `specs/adr/ADR-003-authentication-flow.md`
- SRS: `specs/adr/ADR-004-srs-engine.md`
- 学習状態: `specs/adr/ADR-005-study-session-flow.md`
- イラスト: `specs/adr/ADR-004-illustration-generation-backend-mvp-decisions.md`
