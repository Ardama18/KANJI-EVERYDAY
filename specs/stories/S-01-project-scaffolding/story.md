# S-01: プロジェクトスキャフォールディング

# 要件概要

## 目的
- 「まいにち漢字」の開発基盤となる Next.js プロジェクトを初期化する
- Supabase との接続基盤（Client ユーティリティ）を構築する
- 後続ストーリー（S-02〜S-04）および E-02・E-03 が依存する共通インフラを整える

## 解決する課題
- プロジェクトのゼロからのセットアップ
- 開発ツールチェーン（TypeScript, Biome, Vitest, Tailwind CSS）の統一設定
- Supabase Client の安全な初期化パターン（サーバー用 / クライアント用の分離）

# 機能要件の詳細

## 1. Next.js プロジェクト初期化

### App Router 構成
- Next.js (App Router) でプロジェクトを作成
- `app/` ディレクトリに基本レイアウトとページを配置
- `src/` ディレクトリに再利用コンポーネント、hooks、lib、types を配置

### 基本ページ構成（スタブ）
- `app/layout.tsx`: ルートレイアウト（HTML, body, フォント設定、Tailwind 適用）
- `app/page.tsx`: トップページ（ログイン前のランディング、またはデッキ一覧へのリダイレクト）
- `app/login/page.tsx`: ログインページ（スタブ、S-03 で実装）
- `app/decks/page.tsx`: デッキ一覧ページ（スタブ、E-02 で実装）

## 2. 開発ツールチェーン設定

### TypeScript
- `tsconfig.json`: strict mode 有効、paths alias 設定（`@/` → `src/`）

### Tailwind CSS
- Tailwind CSS v4 のセットアップ
- グローバル CSS（`app/globals.css`）に Tailwind ディレクティブを設定

### Biome
- `biome.json`: フォーマッタ・リンター設定
- import 整理、セミコロン、インデント等のルール統一

### Vitest
- `vitest.config.ts`: テスト設定
- パスエイリアス解決（`@/` → `src/`）
- テスト対象: `src/**/*.test.ts`, `src/**/*.test.tsx`

## 3. Supabase Client ユーティリティ

### サーバー用 Client（`src/lib/supabase/server.ts`）
- `createServerClient` を使用して Server Components / Server Actions 用の Supabase Client を生成
- Cookie ベースのセッション管理（`@supabase/ssr` パッケージ使用）
- Next.js の `cookies()` API と連携

### クライアント用 Client（`src/lib/supabase/client.ts`）
- `createBrowserClient` を使用してブラウザ用の Supabase Client を生成
- Client Components での使用を想定

### 環境変数
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase プロジェクト URL（クライアント公開可）
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Anon Key（クライアント公開可）
- `SUPABASE_SERVICE_ROLE_KEY`: Service Role Key（サーバー専用、`NEXT_PUBLIC_` 付けない）
- `.env.local.example` を作成し、必要な環境変数を明示

## 4. 基本レイアウト

### ルートレイアウト（`app/layout.tsx`）
- HTML lang="ja" 設定
- メタデータ（title: "まいにち漢字", description）
- viewport 設定（モバイル最適化）
- フォント設定（日本語対応）
- Tailwind CSS のグローバルスタイル適用

## 5. プロジェクト構造

```
app/
  layout.tsx          # ルートレイアウト
  page.tsx            # トップページ
  globals.css         # グローバルスタイル
  login/
    page.tsx          # ログインページ（スタブ）
  decks/
    page.tsx          # デッキ一覧（スタブ）
src/
  lib/
    supabase/
      server.ts       # サーバー用 Supabase Client
      client.ts       # クライアント用 Supabase Client
  types/
    database.ts       # DB型定義（S-02 で生成）
  components/         # 共通コンポーネント
  hooks/              # 共通 hooks
biome.json
vitest.config.ts
tsconfig.json
.env.local.example
```

# 技術要件

## 依存パッケージ
- `next`, `react`, `react-dom`
- `@supabase/supabase-js`, `@supabase/ssr`
- `tailwindcss` (v4)
- `typescript`
- 開発依存: `biome`, `vitest`, `@testing-library/react`（必要に応じて）

## 環境変数の安全管理
- `NEXT_PUBLIC_` 接頭辞付きの変数のみクライアントに公開される
- `SUPABASE_SERVICE_ROLE_KEY` は絶対に `NEXT_PUBLIC_` を付けない
- `.env.local` は `.gitignore` に含める
- `.env.local.example` には値を含めず、キー名のみ記載

## Supabase Client 初期化パターン
- サーバー用: リクエストごとに `createServerClient` で新規インスタンス生成（Cookie 読み書き）
- クライアント用: シングルトンパターンで `createBrowserClient` を再利用

## バリデーション
- 環境変数が未設定の場合、起動時にエラーメッセージを出力

# UIデザイン仕様

## ルートレイアウト
- モバイルファースト: `viewport` メタタグで `width=device-width, initial-scale=1`
- 最小限のスタイル（背景色、フォント設定）
- 子ども向けの明るいカラースキーム（基調色は後続ストーリーで決定、ここでは CSS 変数で定義）

## スタブページ
- 各スタブページは「（実装予定）」テキストと簡単なナビゲーションリンクのみ
- 動作確認が目的であり、デザインは不要
