# E-01: プロジェクト基盤・認証

## エピック概要

「まいにち漢字」の技術基盤を構築する。Next.js プロジェクトのセットアップ、Supabase 接続、DBスキーマ作成、RLS ポリシー設定、認証フローを実装し、後続エピック（学習フロー・イラスト生成）の土台を整える。

### 目的
- 開発基盤（Next.js + Supabase）を確立し、全エピック共通のインフラを整える
- DBスキーマと RLS ポリシーを構築し、データ分離を保証する
- 認証フロー（ログイン/サインアップ/ログアウト）を実装する
- Seed データ（漢字カード・デッキ）を投入し、E-02 の開発をすぐ開始できる状態にする

### スコープ

**含むもの**:
- Next.js (App Router) プロジェクトセットアップ（Tailwind CSS, Biome, Vitest）
- Supabase プロジェクト接続（Auth / Postgres / Storage）
- 全テーブルの SQL マイグレーション作成
- RLS ポリシー設定（全テーブル）
- Supabase Auth による認証フロー（メール/パスワード）
- サーバー用 / クライアント用 Supabase Client ユーティリティ
- JST 日付ユーティリティ
- Seed データ（小学3年生の漢字カード R1/W1 + デフォルトデッキ）

**含まないもの**:
- 学習フロー UI・ロジック（E-02）
- イラスト生成・表示（E-03）
- 保護者モード（Phase 2 以降）

## 技術スタック

- **ホスティング**: Vercel
- **フレームワーク**: Next.js (App Router), React, Tailwind CSS
- **バックエンド**: Supabase（Auth / Postgres / Storage）
- **テスト**: Vitest
- **共通**: TypeScript, Biome

## 共通設計方針

### DB設計

**テーブル一覧**:

| テーブル | 用途 |
|---------|------|
| `users_profile` | ユーザープロフィール（user_id, display_name, timezone） |
| `decks` | デッキ定義（id, owner_user_id, name, new_limit_per_day） |
| `cards` | カードマスタ（id, owner_user_id, visibility, skill, pattern, front_text, back_text, illustration_key, card_key） |
| `deck_cards` | デッキ-カード中間テーブル（deck_id, card_id） |
| `review_states` | ユーザー×カードの復習状態（user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at） |
| `illustrations` | イラスト管理（id, owner_user_id, illustration_key, status, storage_path, prompt, model_info） |
| `study_sessions` | 学習セッション（id, user_id, deck_id, queue_due/learn/new/retry, current_card_id, revealed） |

### RLS ポリシー方針
- `decks / review_states / study_sessions / illustrations`: owner のみ select/insert/update
- `cards`: `visibility='public'` は全員 select 可、`visibility='private'` は owner のみ
- `users_profile`: 自分のレコードのみ select/insert/update

### 認証方針
- Supabase Auth（メール/パスワード）
- 認証状態は Server Components で検証し、未認証はログインページへリダイレクト
- Supabase Client はサーバー用（`createServerClient`）とクライアント用（`createBrowserClient`）を分離

### カードデータ構造

```
skill: 'reading' | 'writing'
pattern: 'R1' | 'R2' | 'W1' | 'W2'

R1（単語読み）: front_text="温かい", back_text="あたたかい"
W1（ひらがな→漢字）: front_text="あたたかい", back_text="温かい"
```

- 同じ漢字でも読みカード（R1）と書きカード（W1）は別カードとして作成
- `card_key` で重複防止（例: `R1:温かい:あたたかい` のハッシュ）

## ストーリー間で共有する設計・実装

### 共通ユーティリティ
- `src/lib/supabase/server.ts`: サーバー用 Supabase Client
- `src/lib/supabase/client.ts`: クライアント用 Supabase Client
- `src/lib/date.ts`: JST 日付ユーティリティ（today, tomorrow の JST 基準計算）
- `src/types/database.ts`: Supabase 生成型定義

## セキュリティ要件

- RLS を全テーブルに適用し、ユーザーデータを分離
- `SUPABASE_SERVICE_ROLE_KEY` はサーバー専用（`NEXT_PUBLIC_` 接頭辞を付けない）
- 認証ミドルウェアで未認証アクセスをブロック

## テスト戦略

- RLS ポリシー: SQL テストまたは Supabase CLI のテスト機能で検証
- JST 日付ユーティリティ: Vitest で単体テスト
- 認証フロー: 手動確認（MVP段階）

## 想定リスクと対策

| リスク | 影響度 | 発生確率 | 対策 |
|-------|--------|---------|------|
| Supabase 無料枠の制限 | 低 | 低 | MVP 段階では十分、スケール時に有料プランへ |
| Supabase Auth の設定ミスで認証不具合 | 中 | 低 | RLS + ミドルウェアの二重防御 |
| Seed データの漢字情報の正確性 | 中 | 中 | 小3配当漢字表を基に作成、レビューで確認 |

## このエピックのストーリー

- [S-01](../../stories/S-01-project-scaffolding/) - Next.js プロジェクト初期化、Supabase Client ユーティリティ、基本レイアウト
- [S-02](../../stories/S-02-database-schema-rls/) - 全7テーブルの SQL マイグレーション、RLS ポリシー、TypeScript 型定義
- [S-03](../../stories/S-03-authentication-flow/) - ログイン/サインアップ/ログアウト、認証ミドルウェア、users_profile 自動作成
- [S-04](../../stories/S-04-seed-data-and-utilities/) - JST 日付ユーティリティ、小3漢字 Seed データ（R1/W1）、デフォルトデッキ
