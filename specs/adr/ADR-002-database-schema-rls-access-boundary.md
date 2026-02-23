---
id: ADR-002
feature: database-schema-rls-access-boundary
type: adr
version: 1.1.0
created: 2026-02-23
status: Accepted
based_on: specs/stories/S-02-database-schema-rls/requirements.md
related_epic: specs/epics/E-01-project-foundation-auth/epic.md
---

# ADR-002: S-02のDB公開境界とRLS既定拒否モデルを採用

## ステータス

Accepted

## コンテキスト

S-02では、7テーブルのスキーマ定義とRLS境界をMVPの土台として固定する必要がある。`requirements.md` v1.1.0 を唯一の正とし、`story.md` と `epic.md` に残る旧記述より優先する。

本ストーリーで特に設計判断が必要な論点は以下:

1. DB型定義の配置先をどこに固定するか
2. `illustrations` を公開共有対象にするか、owner scoped privateに固定するか
3. `cards` の書き込み権限をどこまで許可するか
4. DELETEポリシー未指定時の扱いを明示するか
5. `gen_random_uuid()` の利用方針として `pgcrypto` 有効化を互換性ポリシーとして固定するか
6. `illustrations.illustration_key` の非ユニーク方針を仕様として固定するか

## 決定事項

1. DB型定義の生成先は `frontend/src/types/database.ts` に固定する。
2. `cards` 以外の業務テーブル（`users_profile`, `decks`, `deck_cards`, `review_states`, `illustrations`, `study_sessions`）は、MVPで owner scoped private を基準にする。
3. `illustrations` のStorageオブジェクトも owner scoped private に揃え、DB行との境界整合を必須とする。
4. `cards` は `visibility='public'` を未認証ユーザーを含む全員SELECT可としつつ、書き込みは `visibility='private'` かつ所有者本人のみに限定する。
5. DELETEは `cards` 私有行の所有者DELETEのみ明示許可し、その他DELETEはポリシー未定義としてdefault denyに委ねる。
6. UUID既定値列で `gen_random_uuid()` を使う互換性・運用ポリシーとして、マイグレーション冒頭で `pgcrypto` を有効化する。
7. `illustrations.illustration_key` は意図的に非ユニーク（UNIQUE制約なし）として扱い、将来要件まで重複許容を維持する。

## 根拠

### 検討した選択肢

#### 選択肢1: 共有優先モデル（`cards` と `illustrations` をpublic read）
- 利点
  - 共有素材の再利用性が高い
  - 参照ポリシーの説明が単純
- 欠点
  - v1.1.0の `illustrations` private要件に反する
  - 誤公開リスクが高く、MVPの最小権限原則に反する

#### 選択肢2: 完全owner privateモデル（`cards` もpublic readなし）
- 利点
  - セキュリティ境界が最も厳格
  - RLS条件が単純化しやすい
- 欠点
  - 要件の「公開カード再利用」を満たせない
  - 後続ストーリーでカード配布導線を再設計する必要が出る

#### 選択肢3（採用）: ハイブリッド境界モデル（`cards`のみpublic read、`illustrations`はowner private）
- 利点
  - 要件v1.1.0をそのまま満たす
  - 共有対象を `cards` に限定し、露出面を最小化できる
  - DELETEのallow list化で意図しないデータ破壊を防げる
  - 型定義の参照先を単一化し、実装の解釈差分を抑止できる
- 欠点
  - RLSポリシー数が増え、検証項目が多くなる
  - Futureで `illustrations` 公開要件が追加された場合は追加ADRが必要

### 比較マトリクス

| 評価軸 | 選択肢1 共有優先 | 選択肢2 完全private | 選択肢3 ハイブリッド（採用） |
|---|---|---|---|
| 要件適合性 | 低 | 中 | 高 |
| セキュリティ（最小権限） | 中 | 高 | 高 |
| 後続ストーリー整合性 | 中 | 低 | 高 |
| 運用の明確性 | 中 | 高 | 高 |
| 実装/検証コスト | 中 | 低 | 中 |

### 決定理由

- `requirements.md` v1.1.0 で合意済みの境界は「公開は `cards` のみ」であり、これを崩すと受入条件の再解釈が発生する。
- PostgreSQLのRLSはポリシーで許可されない操作を拒否できるため、DELETE allow list方式と相性が良い。
- `illustrations` はStorageオブジェクトも含むため、DB行だけを公開側に寄せると境界不整合が起きる。MVPでは両方owner scoped privateで統一する。
- `gen_random_uuid()` を利用する既存SQL方言との互換性を保ち、ローカル/CI/Supabase環境差分を抑えるため、`pgcrypto` 有効化を運用ポリシーとして固定する。
- `illustrations.illustration_key` はカード再利用や将来の生成フローで重複しうる識別子であり、MVPで一意制約を入れると要件外の制限になる。
- 型定義配置先を `frontend/src/types/database.ts` に固定することで、S-01で整備済みのSupabaseクライアント層との統合が単純になる。

## 影響

### ポジティブな影響

- 公開/非公開データ境界を1文で説明できる（`cards` public read-only、その他owner private）。
- DELETE権限が明示許可方式になり、運用事故時の影響範囲を最小化できる。
- フロントエンドが単一の `Database` 型を参照でき、型契約の分岐を回避できる。

### ネガティブな影響

- ポリシーが増えるため、RLS検証テストの整備コストが上がる。
- `illustrations` 公開共有が必要になった時点で、新たな設計判断と移行作業が必要になる。

### 中立的な影響

- `story.md`/`epic.md` の旧記述との差分は残るが、S-02では requirements v1.1.0 を優先規約として扱う。

## 実装への指針

- マイグレーションは `CREATE EXTENSION IF NOT EXISTS pgcrypto;` を先頭に置く。
- 7テーブルすべてでRLSを有効化し、テーブルごとに最小権限ポリシーを定義する。
- DELETEポリシーは `cards` 私有行owner用のみ作成し、その他テーブルにDELETEポリシーを追加しない。
- `illustrations` はDBポリシーとStorageポリシーを同じowner scoped private条件で揃える。
- `illustrations.illustration_key` はUNIQUE制約を付与しない（非ユニーク運用）。
- 型生成コマンドは次を基準に統一し、`public` スキーマを明示する。

```bash
# Local Supabaseを参照する場合（推奨）
supabase gen types typescript --local --schema public > frontend/src/types/database.ts

# CI等でリモートprojectを参照する場合の等価コマンド
supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" --schema public > frontend/src/types/database.ts
```

- Supabaseクライアント初期化で `Database` ジェネリクスを利用する。

## 受入条件（EARS）

- 遍在型: システムは `frontend/src/types/database.ts` をDB型定義の唯一の生成先として扱うこと。
- 遍在型: システムは `users_profile`, `decks`, `deck_cards`, `review_states`, `illustrations`, `study_sessions` をowner scoped privateとして扱い、非所有者/未認証のSELECT/INSERT/UPDATEを拒否すること。
- 選択型: もし `cards.visibility='public'` なら、システムはその行を未認証ユーザーを含む全ユーザーにSELECT許可し、書き込み操作は拒否すること。
- 選択型: もし `cards.visibility='private'` なら、システムは所有者本人にのみINSERT/UPDATE/DELETEを許可すること。
- 遍在型: システムは `illustrations` のDB行とStorageオブジェクトをowner scoped privateとして扱うこと。
- 遍在型: システムは `illustrations.illustration_key` にUNIQUE制約を付与せず、非ユニーク運用を維持すること。
- 不測型: もしDELETEポリシーが明示されていないテーブル操作が実行された場合、システムはRLS既定拒否として操作を失敗させること。
- 契機型: UUID既定値付きテーブルを作成するとき、システムは互換性・運用ポリシーとして `pgcrypto` 有効化後に `gen_random_uuid()` を利用可能にすること。

## 参考資料

- Supabase Docs, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Docs, Storage Access Control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase JS Reference, `storage.createBucket` (`public` option): https://supabase.com/docs/reference/javascript/storage-createbucket
- Supabase CLI Reference, `supabase gen types`: https://supabase.com/docs/reference/cli/supabase-gen-types
- PostgreSQL Docs, `CREATE POLICY`: https://www.postgresql.org/docs/current/sql-createpolicy.html
- PostgreSQL Docs, UUID Functions: https://www.postgresql.org/docs/current/functions-uuid.html
- PostgreSQL Docs, `CREATE EXTENSION`: https://www.postgresql.org/docs/current/sql-createextension.html

## 関連情報

- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- `specs/stories/S-02-database-schema-rls/requirements.md`
- `specs/stories/S-02-database-schema-rls/design.md`
