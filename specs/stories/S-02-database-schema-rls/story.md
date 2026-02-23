# S-02: データベーススキーマ & RLS ポリシー

# 要件概要

## 目的
- 「まいにち漢字」の全テーブル（7テーブル）の SQL マイグレーションを作成する
- RLS（Row Level Security）ポリシーを全テーブルに設定し、ユーザーデータの分離を保証する
- Supabase の型定義を生成し、TypeScript コードから型安全にアクセスできるようにする

## 解決する課題
- アプリケーション全体のデータ構造を定義し、後続ストーリー（認証、学習フロー、イラスト）の土台を作る
- RLS によりマルチテナント的なデータ分離を実現する（ユーザーAのデータをユーザーBが参照できない）

# 機能要件の詳細

## 1. テーブル定義

### users_profile
ユーザープロフィール情報。Supabase Auth の `auth.users` と 1:1 対応。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `user_id` | `uuid` | PK, FK → auth.users(id) ON DELETE CASCADE | - | ユーザーID |
| `display_name` | `text` | NOT NULL | - | 表示名 |
| `timezone` | `text` | NOT NULL | `'Asia/Tokyo'` | タイムゾーン |
| `parent_mode_enabled` | `boolean` | NOT NULL | `false` | 保護者モード有効フラグ |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 作成日時 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 更新日時 |

### decks
デッキ（カードの集合）定義。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `id` | `uuid` | PK | `gen_random_uuid()` | デッキID |
| `owner_user_id` | `uuid` | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | - | 所有者 |
| `name` | `text` | NOT NULL | - | デッキ名 |
| `new_limit_per_day` | `integer` | NOT NULL | `10` | 1日の新規カード上限 |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 作成日時 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 更新日時 |

### cards
カードマスタ。読みカードと書きカードは別レコード。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `id` | `uuid` | PK | `gen_random_uuid()` | カードID |
| `owner_user_id` | `uuid` | FK → auth.users(id) ON DELETE CASCADE, NULL可 | `NULL` | 所有者（公開カードはNULL） |
| `visibility` | `text` | NOT NULL, CHECK ('public', 'private') | `'public'` | 公開設定 |
| `skill` | `text` | NOT NULL, CHECK ('reading', 'writing') | - | スキル種別 |
| `pattern` | `text` | NOT NULL, CHECK ('R1', 'R2', 'W1', 'W2') | - | 出題パターン |
| `front_text` | `text` | NOT NULL | - | 表面テキスト（問題） |
| `back_text` | `text` | NOT NULL | - | 裏面テキスト（答え） |
| `illustration_key` | `text` | | `NULL` | イラストキー（illustration テーブルとの紐付け用） |
| `card_key` | `text` | UNIQUE, NOT NULL | - | 重複防止キー |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 作成日時 |

### deck_cards
デッキとカードの中間テーブル。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `deck_id` | `uuid` | NOT NULL, FK → decks(id) ON DELETE CASCADE | - | デッキID |
| `card_id` | `uuid` | NOT NULL, FK → cards(id) ON DELETE CASCADE | - | カードID |
| PK | - | (`deck_id`, `card_id`) | - | 複合主キー |

### review_states
ユーザー×カードの復習状態。SRS ロジックの中核データ。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | - | ユーザーID |
| `card_id` | `uuid` | NOT NULL, FK → cards(id) ON DELETE CASCADE | - | カードID |
| `level` | `integer` | NOT NULL | `0` | SRS レベル（間隔テーブルのインデックス） |
| `due_date` | `date` | NOT NULL | - | 次回復習日（JST基準） |
| `last_rating` | `text` | CHECK ('again', 'hard', 'good') | `NULL` | 最後の評価 |
| `retry_today_count` | `integer` | NOT NULL | `0` | 当日再提示回数 |
| `last_reviewed_at` | `timestamptz` | | `NULL` | 最終レビュー日時 |
| PK | - | (`user_id`, `card_id`) | - | 複合主キー |

### illustrations
イラスト管理テーブル。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `id` | `uuid` | PK | `gen_random_uuid()` | イラストID |
| `owner_user_id` | `uuid` | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | - | 所有者 |
| `illustration_key` | `text` | NOT NULL | - | イラストキー（cards.illustration_key と対応） |
| `status` | `text` | NOT NULL, CHECK ('pending', 'ready', 'failed') | `'pending'` | 生成状態 |
| `storage_path` | `text` | | `NULL` | Supabase Storage 内のパス |
| `prompt` | `text` | | `NULL` | 生成プロンプト |
| `model_info` | `text` | | `NULL` | 使用モデル情報 |
| `created_at` | `timestamptz` | NOT NULL | `now()` | 作成日時 |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | 更新日時 |

### study_sessions
学習セッション管理。セッション中のキュー状態を JSONB で保持。

| カラム | 型 | 制約 | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| `id` | `uuid` | PK | `gen_random_uuid()` | セッションID |
| `user_id` | `uuid` | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | - | ユーザーID |
| `deck_id` | `uuid` | NOT NULL, FK → decks(id) ON DELETE CASCADE | - | デッキID |
| `queue_due` | `jsonb` | NOT NULL | `'[]'` | Due キュー（card_id の配列） |
| `queue_learn` | `jsonb` | NOT NULL | `'[]'` | Learn キュー |
| `queue_new` | `jsonb` | NOT NULL | `'[]'` | New キュー |
| `queue_retry` | `jsonb` | NOT NULL | `'[]'` | Retry キュー |
| `current_card_id` | `uuid` | FK → cards(id) | `NULL` | 現在表示中のカードID |
| `revealed` | `boolean` | NOT NULL | `false` | 裏面表示済みフラグ |
| `created_at` | `timestamptz` | NOT NULL | `now()` | セッション開始日時 |
| `finished_at` | `timestamptz` | | `NULL` | セッション完了日時 |

## 2. インデックス

- `cards`: `card_key` に UNIQUE インデックス（テーブル定義に含む）
- `cards`: `illustration_key` にインデックス
- `review_states`: `(user_id, due_date)` にインデックス（due カード検索の高速化）
- `deck_cards`: `card_id` にインデックス（カード→デッキ逆引き）
- `study_sessions`: `(user_id, finished_at)` にインデックス（アクティブセッション検索）

## 3. RLS ポリシー

### users_profile
- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id`
- `UPDATE`: `auth.uid() = user_id`

### decks
- `SELECT`: `auth.uid() = owner_user_id`
- `INSERT`: `auth.uid() = owner_user_id`
- `UPDATE`: `auth.uid() = owner_user_id`

### cards
- `SELECT`: `visibility = 'public' OR (visibility = 'private' AND auth.uid() = owner_user_id)`
- `INSERT`: `visibility = 'private' AND auth.uid() = owner_user_id`
- `UPDATE`: `visibility = 'private' AND auth.uid() = owner_user_id`

### deck_cards
- `SELECT`: デッキの owner であること（`EXISTS (SELECT 1 FROM decks WHERE decks.id = deck_cards.deck_id AND decks.owner_user_id = auth.uid())`）
- `INSERT`: 同上
- `UPDATE`: 同上

### review_states
- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id`
- `UPDATE`: `auth.uid() = user_id`

### illustrations
- `SELECT`: `auth.uid() = owner_user_id`
- `INSERT`: `auth.uid() = owner_user_id`
- `UPDATE`: `auth.uid() = owner_user_id`

### study_sessions
- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id`
- `UPDATE`: `auth.uid() = user_id`

## 4. updated_at 自動更新トリガー

`users_profile`, `decks`, `illustrations` に対して、`UPDATE` 時に `updated_at` を自動更新するトリガー関数を作成。

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## 5. Supabase Storage バケット

- バケット名: `illustrations`
- アクセス: 非公開（private）
- RLS: 認証済みユーザーのみアクセス可能

## 6. TypeScript 型定義

- Supabase CLI の `supabase gen types typescript` で自動生成
- 生成先: `frontend/src/types/database.ts`
- 生成された型を Supabase Client の初期化時にジェネリクスとして渡す

# 技術要件

## マイグレーション管理
- Supabase CLI の `supabase migration new` でマイグレーションファイルを作成
- または `supabase/migrations/` ディレクトリに SQL ファイルを直接配置
- マイグレーションファイルは日時プレフィックス付き（例: `20260223000000_create_tables.sql`）
- テーブル作成 → インデックス作成 → RLS 有効化 → RLS ポリシー作成 → トリガー作成 の順序

## RLS 有効化
- 全テーブルで `ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;` を実行
- ポリシー未設定のテーブルへのアクセスはデフォルトで拒否される

## 型定義の生成と使用
- `supabase gen types typescript --local > frontend/src/types/database.ts`
- 生成された `Database` 型を `createServerClient<Database>(...)` のように使用
