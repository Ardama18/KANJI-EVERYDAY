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
- `SECURITY DEFINER` 関数を作成・置換する migration は、固定 `search_path`、完全な function signature を使った `ALTER FUNCTION ... OWNER TO s10_migration_owner`、不要 role からの revoke、必要 role への grant を同じ migration に含める。
- function owner は SQL 本文の静的確認だけで合格にしない。隔離 local DB と適用対象 Hosted Supabase の `pg_proc` / `pg_roles` を照合し、許可 owner 以外の `SECURITY DEFINER` 関数が0件であることを確認する。
- local migration ledger と実 schema がずれている場合、関数やtableの存在だけを根拠に適用済みと判断しない。対象 migration の効果を確認し、隔離DBに限ってledger修復または再構築を行い、共有環境では勝手に履歴を編集しない。
- PostgREST v14経由のpublic wrapperでJWT actorを直接検証する場合は、packed `request.jwt.claims` JSONの`role`と`sub`を正本とし、単独の`request.jwt.claim.role` / `request.jwt.claim.sub`だけに依存しない。malformed、role不一致、UUIDでない`sub`を未認証として扱い、packed claimsを設定した実RPCで検証する。
- RPCの必須引数は`NULL`を明示的に拒否する。`NOT BETWEEN`、`<>`、正規表現などの比較だけではSQLの三値論理により`NULL`が`UNKNOWN`となり、validationを通過し得る。
- S-11 workerと交差するbatch lifecycle mutationは、workerと同じ`ai_import_concept_jobs`先行のlock順を守る。`queued` / `processing` jobがあれば副作用0で全体拒否し、terminal job、item、batchの状態変更は同一transactionで整合させる。
