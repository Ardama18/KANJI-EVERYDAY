# Frontend アーキテクチャ（Next.js 14）

## 技術スタック

- Next.js 14 App Router / React 18
- TypeScript
- Tailwind CSS 3
- Supabase SSR client
- Vitest

実バージョンは常に `frontend/package.json` を確認する。

## ディレクトリ構造

```text
frontend/
├── app/
│   ├── (auth)/                 # 認証必須 route group
│   ├── login/、signup/
│   ├── layout.tsx
│   └── page.tsx
└── src/
    ├── actions/
    ├── components/{auth,deck,study}/
    ├── lib/
    └── types/
```

App Router の実 route は `frontend/app` が正本。`frontend/src/app/**/*.test.tsx` は route 実装ではなくページテストである。

## Server / Client Component

- ページ、layout、初期データ取得は Server Component をデフォルトにする。
- state、event handler、browser API が必要な部分だけ Client Component にする。
- `'use client'` をページ全体へ広げない。
- Client Component に secret、service role client、server-only utility を渡さない。
- Server から Client へ渡す props は serializable かつ必要最小限にする。

## ページ責務

- `/`: セッション状態に応じた入口
- `/login`、`/signup`: 認証フォーム
- `/decks`: デッキと New / Learn / Due の一覧
- `/decks/[deckId]`: 対象デッキの概要と開始操作
- `/decks/[deckId]/study`: server shell + `StudyClient` による学習遷移

認証リダイレクトは middleware だけに依存せず、保護ページ / Action 側でも確認する。

## UI 状態

- loading、empty、error、success を区別する。
- 二重送信を防ぎ、処理中の操作可否を明示する。
- Server Action 失敗時に、成功したような optimistic state を残さない。
- 学習の front / back / complete は server のセッション状態から復元できること。
- イラスト pending / failed はプレースホルダに劣化し、評価操作を妨げないこと。

## スタイリングとアクセシビリティ

- 既存の `frontend/app/globals.css` と Tailwind token を優先する。
- 子どもがスマートフォンで使う前提で、主要操作は 48px 以上の touch target を確保する。
- button / link / heading など意味のある HTML を使い、キーボード focus を可視化する。
- 色だけで New / Learn / Due や評価を伝えない。
- 長い日本語、200% zoom、狭い viewport で overflow しないようにする。

## テスト

- component は観測可能な表示と操作をテストする。
- Server Action は別テストにし、UI テストでは境界を mock する。
- route page テストと実 route の配置差を意識し、存在しない module path を前提にしない。
- 実ブラウザ確認が必要な変更は、導入済みでない Playwright を仮定せず手動検証内容を記録する。
