# Supabase PostgreSQL / RLS / Storage 設計規約

## 変更の単位

schema 変更は `supabase/migrations/` の新規 SQL migration として追加し、適用済み migration を書き換えない。変更時は次を一体で確認する。

- table / column / constraint / index
- RLS enablement と CRUD policy
- Storage bucket / object policy
- `frontend/src/types/database.ts`
- `supabase/seed.sql`
- Server Action とテスト
- 関連 requirements / design / ADR

## column と制約

- 必須の domain data は `NOT NULL` にする。
- default は domain 上常に妥当な値にだけ設定する。欠損を隠すための空文字・0・空 JSON は使わない。
- enum 相当の text は `CHECK` constraint で許容値を固定する。
- owner data は `user_id` / `owner_user_id` を明示し、`auth.users` との参照整合性を持たせる。
- `created_at` / `updated_at` は timezone aware な型を使い、更新規則を明示する。
- JST の学習日を表す `due_date` と絶対時刻を表す timestamp を混同しない。

## RLS

- application table は原則 RLS を有効にする。
- public card の select 例外以外は owner scoped を基本とする。
- `USING`（既存行）と `WITH CHECK`（新しい行）を操作ごとに検討する。
- join table は直接の owner column がなくても、親 table への `EXISTS` 等で境界を証明する。
- service role を通常経路で使い RLS を迂回しない。
- policy 変更には少なくとも owner 成功、別ユーザー拒否、未認証拒否の検証を持つ。

## 現行 table

- `users_profile`
- `decks`
- `cards`
- `deck_cards`
- `review_states`
- `illustrations`
- `study_sessions`

詳細は `20260223000000_s02_schema_rls.sql` と ADR-002 を正本とする。

## Storage

- `illustrations` bucket は private。
- object path は `{user_id}/{illustration_id}.png`。
- path の先頭 owner と `auth.uid()` を policy で照合する。
- 閲覧は server で有効期限付き signed URL を発行する。
- DB row を削除 / 変更する場合、Storage object の孤児化と逆方向の不整合を検討する。

## migration 品質

- 可能な限り transaction 内で完結させる。
- destructive change、table rewrite、lock、既存データの backfill を明記する。
- `IF EXISTS` / `IF NOT EXISTS` は本来検知すべき drift を隠さない範囲で使う。
- seed は同じ環境へ再実行でき、重複や他ユーザー data の破壊を起こさないようにする。
- index は実 query、join、owner filter、unique constraint に根拠があるものだけ追加する。
- `INSERT ... ON CONFLICT (column...)` を使う場合は、同じ column 順の unique / exclusion constraint が全対象環境に存在することを migration と検証で保証する。constraint drift を `ON CONFLICT` の変更で隠さない。
- seed 実行前に migration version と必要 constraint を確認する。空 DB だけでなく既存 local / preview schema への適用結果も検証する。
