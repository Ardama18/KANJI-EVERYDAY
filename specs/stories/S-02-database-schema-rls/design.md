---
id: S-02
feature: database-schema-rls
type: design
version: 1.1.0
created: 2026-02-23
based_on: specs/stories/S-02-database-schema-rls/requirements.md
---

# データベーススキーマ & RLS Design Document

## 概要

S-02では、Supabase(PostgreSQL + Storage)上に7テーブルの永続化契約を定義し、RLSで公開/非公開境界を確定する。要件定義書 v1.1.0 を唯一の正とし、`cards` のみ public read（未認証ユーザーを含む）、`illustrations` を含むその他データを owner scoped private として実装可能な設計に落とし込む。

この設計は、S-01で整備済みの `frontend/src/lib/supabase/*` を前提に、`frontend/src/types/database.ts` を単一の型契約として接続する。

## 背景とコンテキスト

### 仕様優先順位

- 最優先: `specs/stories/S-02-database-schema-rls/requirements.md` (v1.1.0)
- 参考: `specs/stories/S-02-database-schema-rls/story.md`, `specs/epics/E-01-project-foundation-auth/epic.md`
- 差分解決ルール: 要件書と不整合がある場合は要件書を採用

### 前提となるADR

- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
  - Supabaseクライアント分離（server/browser）とenvフェイルファスト方針
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
  - S-02の公開境界、DELETE allow list、`pgcrypto` 有効化、型配置固定

### 合意事項チェックリスト

#### スコープ
- [x] 7テーブルのスキーマ契約（PK/FK/NOT NULL/DEFAULT/CHECK/INDEX）
- [x] 全7テーブルのRLS有効化
- [x] `cards`: public read-only + private owner write
- [x] `illustrations`: DB行/Storageともに private + owner scoped
- [x] DELETEは `cards` 私有行owner以外をdefault deny
- [x] `pgcrypto` 有効化と `gen_random_uuid()` 前提
- [x] 型生成先 `frontend/src/types/database.ts` 固定

#### 非スコープ
- [x] 認証UI/ログイン処理（S-03）
- [x] Seed投入/JSTユーティリティ（S-04）
- [x] 学習アルゴリズム実装（SRS計算等）
- [x] イラスト公開共有機能（Future）

#### 制約
- [x] 既存コード変更は最小差分（S-01のSupabaseクライアント構成を維持）
- [x] RLSは許可ポリシー明示方式（未定義操作は拒否）
- [x] 型契約の参照先を単一化し、複数型ファイルへの分散を禁止

## 解決する問題

- 後続ストーリーが依存するDB契約を先に固定しないと、認証/学習機能の実装が各所で再解釈される。
- 公開データと私有データの境界が曖昧なままだと、RLSポリシーの過剰許可や実装ブレが発生する。
- 型生成先が複数化すると、フロント実装で不整合な `Database` 型を参照するリスクが高まる。

## 要件

### 機能要件

- 7テーブルを要件定義の契約どおりに作成する。
- `pgcrypto` を有効化して `gen_random_uuid()` を利用可能にする。
- `users_profile`, `decks`, `illustrations` に `updated_at` 自動更新トリガーを設定する。
- 全テーブルでRLSを有効化し、公開/所有者境界を要件どおりに実装する。
- Storage `illustrations` バケットをprivateにし、owner scopedアクセス制御を設定する。
- DB型定義を `frontend/src/types/database.ts` に生成する。

### 非機能要件

- **セキュリティ**: privateデータへの非所有アクセスを拒否する。
- **信頼性**: FK整合性とRLS境界が再現可能な検証シナリオを持つ。
- **保守性**: 型定義とポリシー意図をドキュメントだけで追跡できる。
- **拡張性**: Futureの公開範囲拡張時に追加ポリシーで拡張可能。

## 受入条件（AC）

- AC-01（遍在型）: システムは `users_profile`, `decks`, `cards`, `deck_cards`, `review_states`, `illustrations`, `study_sessions` の7テーブルを、要件定義書AC#1の列契約・制約・インデックスで保持すること。
- AC-02（契機型）: マイグレーションが開始されたとき、システムは `pgcrypto` を有効化し、`gen_random_uuid()` 利用列の作成を成功させること。
- AC-03（契機型）: `users_profile`, `decks`, `illustrations` の行が更新されたとき、システムは `updated_at` を自動更新すること。
- AC-04（遍在型）: システムは7/7テーブルでRLSを有効化すること。
- AC-05（選択型）: もし `cards.visibility='public'` なら、システムは未認証ユーザー（anonymous）を含む全ユーザーにSELECTを許可し、INSERT/UPDATE/DELETEを拒否すること。
- AC-06（選択型）: もし `cards.visibility='private'` なら、システムは所有者本人にのみINSERT/UPDATE/DELETEを許可すること。
- AC-07（遍在型）: システムは `illustrations` をprivate + owner scopedとして扱い、非所有者/未認証のSELECT/INSERT/UPDATE/DELETEを拒否すること。
- AC-08（遍在型）: システムは `users_profile`, `decks`, `deck_cards`, `review_states`, `study_sessions` のSELECT/INSERT/UPDATEを所有者本人（または自分自身）のみに制限すること。
- AC-09（不測型）: もしDELETEポリシーが明示されていないテーブルDELETEが試行された場合、システムは操作を拒否すること。
- AC-10（遍在型）: システムはStorageバケット `illustrations` をprivateで作成し、オブジェクトアクセスをowner scopedに制御すること。
- AC-11（遍在型）: システムは `illustrations.illustration_key` にUNIQUE制約を付与しないこと。
- AC-12（契機型）: 型生成コマンドが実行されたとき、システムは7テーブルを含む型を `frontend/src/types/database.ts` に出力すること。

### AC-01 スキーマ契約マトリクス（要件AC#1トレース）

| テーブル | PK | FK | NOT NULL | DEFAULT | CHECK | INDEX要件 |
|---|---|---|---|---|---|---|
| `users_profile` | `user_id` | `user_id -> auth.users(id) ON DELETE CASCADE` | `user_id`, `display_name`, `timezone`, `parent_mode_enabled`, `created_at`, `updated_at` | `timezone='Asia/Tokyo'`, `parent_mode_enabled=false`, `created_at=now()`, `updated_at=now()` | なし | `PK(user_id)` |
| `decks` | `id` | `owner_user_id -> auth.users(id) ON DELETE CASCADE` | `id`, `owner_user_id`, `name`, `new_limit_per_day`, `created_at`, `updated_at` | `id=gen_random_uuid()`, `new_limit_per_day=10`, `created_at=now()`, `updated_at=now()` | なし | `PK(id)` |
| `cards` | `id` | `owner_user_id -> auth.users(id) ON DELETE CASCADE`（`owner_user_id` はNULL可） | `id`, `visibility`, `skill`, `pattern`, `front_text`, `back_text`, `card_key`, `created_at` | `id=gen_random_uuid()`, `visibility='public'`, `owner_user_id=NULL`, `illustration_key=NULL`, `created_at=now()` | `visibility IN ('public','private')`, `skill IN ('reading','writing')`, `pattern IN ('R1','R2','W1','W2')` | `PK(id)`, `UNIQUE(card_key)`, `INDEX(illustration_key)` |
| `deck_cards` | 複合PK `(deck_id, card_id)` | `deck_id -> decks(id) ON DELETE CASCADE`、`card_id -> cards(id) ON DELETE CASCADE` | `deck_id`, `card_id` | なし | なし | `PK(deck_id, card_id)`, `INDEX(card_id)` |
| `review_states` | 複合PK `(user_id, card_id)` | `user_id -> auth.users(id) ON DELETE CASCADE`、`card_id -> cards(id) ON DELETE CASCADE` | `user_id`, `card_id`, `level`, `due_date`, `retry_today_count` | `level=0`, `retry_today_count=0`, `last_rating=NULL`, `last_reviewed_at=NULL` | `last_rating IN ('again','hard','good')` | `PK(user_id, card_id)`, `INDEX(user_id, due_date)` |
| `illustrations` | `id` | `owner_user_id -> auth.users(id) ON DELETE CASCADE` | `id`, `owner_user_id`, `illustration_key`, `status`, `created_at`, `updated_at` | `id=gen_random_uuid()`, `status='pending'`, `storage_path=NULL`, `prompt=NULL`, `model_info=NULL`, `created_at=now()`, `updated_at=now()` | `status IN ('pending','ready','failed')` | `PK(id)`（`illustration_key` に `UNIQUE` を持たない） |
| `study_sessions` | `id` | `user_id -> auth.users(id) ON DELETE CASCADE`、`deck_id -> decks(id) ON DELETE CASCADE`、`current_card_id -> cards(id)` | `id`, `user_id`, `deck_id`, `queue_due`, `queue_learn`, `queue_new`, `queue_retry`, `revealed`, `created_at` | `id=gen_random_uuid()`, `queue_due='[]'`, `queue_learn='[]'`, `queue_new='[]'`, `queue_retry='[]'`, `current_card_id=NULL`, `revealed=false`, `created_at=now()`, `finished_at=NULL` | なし | `PK(id)`, `INDEX(user_id, finished_at)` |

## 既存コードベース分析

### 実装パスマッピング

| 種別 | パス | 説明 |
|---|---|---|
| 既存 | `specs/stories/S-02-database-schema-rls/requirements.md` | S-02要件の唯一の正 |
| 既存 | `frontend/src/lib/supabase/server.ts` | server向けSupabaseクライアント初期化 |
| 既存 | `frontend/src/lib/supabase/client.ts` | browser向けSupabaseクライアント初期化 |
| 既存 | `frontend/src/lib/supabase/server.test.ts` | serverクライアント初期化テスト |
| 既存 | `frontend/src/lib/supabase/client.test.ts` | browserクライアント初期化テスト |
| 新規 | `supabase/migrations/{timestamp}_s02_schema_rls.sql` | 7テーブル/インデックス/RLS/トリガー/extension |
| 新規 | `supabase/migrations/{timestamp}_s02_storage_illustrations.sql` | private bucketとStorageポリシー |
| 新規 | `frontend/src/types/database.ts` | Supabase生成DB型 |
| 更新候補 | `frontend/src/lib/supabase/server.ts` | `createServerClient<Database>()` の型適用 |
| 更新候補 | `frontend/src/lib/supabase/client.ts` | `createBrowserClient<Database>()` の型適用 |

### 統合境界の約束

- データ公開境界:
  - `cards` のみ public read対象（未認証ユーザーを含む）
  - それ以外の業務テーブルは owner private
- 書き込み境界:
  - `cards` は private行 ownerのみ書き込み可
  - `cards` 公開行は read-only
- 削除境界:
  - 明示許可は `cards` private owner DELETEのみ
  - その他DELETEは未定義のまま拒否
- 型境界:
  - フロント実装は `frontend/src/types/database.ts` を単一参照

## 設計

### 変更影響マップ

```yaml
変更対象: Supabase schema / policy / storage / frontend type contract
直接影響:
  - supabase/migrations/*_s02_schema_rls.sql
  - supabase/migrations/*_s02_storage_illustrations.sql
  - frontend/src/types/database.ts
  - frontend/src/lib/supabase/server.ts
  - frontend/src/lib/supabase/client.ts
間接影響:
  - S-03認証フローのユーザーデータアクセス可否
  - S-04 seed投入時のFK整合性
  - フロント側クエリ実装時の型エラー検知
波及なし:
  - S-01スタブ画面 (`app/page`, `app/login/page`, `app/decks/page`)
  - 環境変数検証ロジック (`frontend/src/lib/env.ts`)
```

### アーキテクチャ概要

```mermaid
flowchart LR
  Client[Any User (authenticated or anonymous)] --> FE[frontend/src/lib/supabase/*]
  FE --> DB[(PostgreSQL)]
  FE --> ST[(Supabase Storage: illustrations bucket)]

  DB --> U[users_profile]
  DB --> D[decks]
  DB --> C[cards]
  DB --> DC[deck_cards]
  DB --> R[review_states]
  DB --> I[illustrations]
  DB --> S[study_sessions]

  Auth[(auth.users)] --> U
  Auth --> D
  Auth --> C
  Auth --> R
  Auth --> I
  Auth --> S

  C -.public read only.-> Client
  I -.owner only.-> Client
  ST -.owner only access.-> Client
```

### データフロー

1. Migration実行時に `pgcrypto` を有効化し、7テーブルとインデックスを作成する。
2. テーブル作成後にRLSを有効化し、テーブル単位ポリシーを適用する。
3. `cards` はpublic readとprivate owner writeを分離したポリシーで運用する。
4. `illustrations` はDB行とStorageオブジェクトをowner scoped privateで統一する。
5. 型生成コマンドで `frontend/src/types/database.ts` を更新し、Supabaseクライアントで再利用する。

### 統合点一覧

| 統合点 | 場所 | 旧実装 | 新実装 | 切り替え方法 |
|---|---|---|---|---|
| DB DDL実行 | `supabase/migrations/*` | 該当なし | 7テーブル + 制約 + index + trigger + extension | forward migration適用 |
| RLS認可 | 各テーブルpolicy | 該当なし | owner/private + cards public readモデル | policy作成後に検証SQL実行 |
| Storage認可 | `storage.buckets` / `storage.objects` policy | 該当なし | `illustrations` private + owner scoped | bucket作成 + policy適用 |
| Frontend型連携 | `frontend/src/lib/supabase/{server,client}.ts` | untyped client | `Database` ジェネリクス適用 | 型生成後にimport更新 |

### インターフェース変更マトリクス

| 区分 | インターフェース | 変更種別 | 変換必要性 | 互換性確保 |
|---|---|---|---|---|
| 既存 | `createServerClient()` | 更新候補 | あり（generic追加） | 関数名は維持し戻り値を型強化 |
| 既存 | `createBrowserClient()` | 更新候補 | あり（generic追加） | 関数名は維持し戻り値を型強化 |
| 新規 | `frontend/src/types/database.ts` | 追加 | なし | 参照先を単一固定 |
| 新規 | RLS policy set (7 tables) | 追加 | なし | SQLポリシー名の一貫命名 |

### データ契約（Data Contract）

```yaml
入力:
  - migration SQL:
      tables:
        - users_profile
        - decks
        - cards
        - deck_cards
        - review_states
        - illustrations
        - study_sessions
      extension: pgcrypto
      policies: tableごとのRLS policy
  - storage config:
      bucket: illustrations
      public: false
      scope: owner only

出力:
  - PostgreSQL schema + constraints + indexes
  - RLS enforcement on all 7 tables
  - storage access boundary
  - frontend/src/types/database.ts

不変条件:
  - cards public row is read-only
  - cards public row can be selected by authenticated and anonymous users
  - cards private row write/delete is owner only
  - illustrations row/object is owner scoped private
  - unspecified DELETE remains denied
  - type output path is fixed to frontend/src/types/database.ts
```

### RLS操作マトリクス（AC-04〜AC-09）

| テーブル | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `users_profile` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `policy未定義 -> default deny` |
| `decks` | `auth.uid() = owner_user_id` | `auth.uid() = owner_user_id` | `auth.uid() = owner_user_id` | `policy未定義 -> default deny` |
| `cards` | `visibility='public'` は全員（anonymous含む）許可。`visibility='private'` は `auth.uid() = owner_user_id` のみ | `visibility='private' AND auth.uid() = owner_user_id` | `visibility='private' AND auth.uid() = owner_user_id` | `visibility='private' AND auth.uid() = owner_user_id` のみ明示許可（allow-list） |
| `deck_cards` | `EXISTS (SELECT 1 FROM decks WHERE decks.id = deck_cards.deck_id AND decks.owner_user_id = auth.uid())` | SELECTと同条件 | SELECTと同条件 | `policy未定義 -> default deny` |
| `review_states` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `policy未定義 -> default deny` |
| `illustrations` | `auth.uid() = owner_user_id`（non-owner/anonymousは拒否） | `auth.uid() = owner_user_id` | `auth.uid() = owner_user_id` | `policy未定義 -> default deny` |
| `study_sessions` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `policy未定義 -> default deny` |

## 実装計画

### 実装アプローチ

**選択したアプローチ**: ハイブリッド（Schema-first + Policy-hardening + Type-contract integration）  
**選択理由**: DDL依存関係を先に確定し、RLS境界を後段で厳格化したうえで、最後にフロント型契約へ接続する順序が最も手戻りが少ない。

#### アプローチ決定プロセス（Phase 1-4）

1. **Phase 1: 問題分解**
   - 依存関係の起点はDDL（FK/PK/INDEX）であり、RLSや型生成はその後続である。
2. **Phase 2: 候補比較**
   - A: policy-first
   - B: schema-first
   - C: hybrid
3. **Phase 3: リスク評価**
   - policy-firstはテーブル未確定時に再定義コストが高い。
   - schema-first単独は認可不備の発見が遅れる。
   - hybridは初期コストが中程度だが、検証順序が明確。
4. **Phase 4: 選択**
   - C（hybrid）を採用。

### 技術的依存関係と実装順序

1. **`pgcrypto` 有効化**
   - 技術的理由: `gen_random_uuid()` を使うDDLより前に必要。
2. **7テーブル作成（PK/FK/DEFAULT/CHECK）**
   - 技術的理由: policyの対象関係を確定するため。
3. **`updated_at` トリガー関数・トリガー作成（AC-03実装）**
   - 技術的理由: `users_profile`, `decks`, `illustrations` の更新時刻保証をDDLと同じマイグレーション単位で固定するため。
4. **インデックス作成**
   - 技術的理由: クエリ特性（due検索、カード逆引き、セッション検索）を満たすため。
5. **RLS有効化 + policy定義**
   - 技術的理由: テーブル定義確定後に最小権限境界を適用するため。
6. **Storage bucket/policy定義**
   - 技術的理由: `illustrations` のDB境界と同時にアクセス境界を揃えるため。
7. **型生成とフロント統合**
   - 技術的理由: 実スキーマ確定後の型を反映してコンパイル安全性を担保するため。

### 並列実装可能な要素

- RLS検証SQLの作成と、frontend側の型適用コード改修は並列化可能（前提: マイグレーションのテーブル名が確定していること）。
- Storage policy検証シナリオは、DB policy検証と独立して実行可能。

### 統合ポイントとE2E確認

#### Phase 0: Migration統合
1. 新規マイグレーションを適用する。
2. 7テーブル、必須制約、指定インデックス、`pgcrypto` 有効化を確認する。
3. `update_updated_at_column()` 関数と、`users_profile` / `decks` / `illustrations` の3トリガー作成を確認する（AC-03実装トレース）。
4. 3テーブルそれぞれで `UPDATE ... RETURNING updated_at` を実行し、更新時刻が進むことを確認する（AC-03検証トレース）。

#### Phase 1: RLS境界統合
1. owner / non-owner / unauthenticated の3パターンで `SELECT/INSERT/UPDATE/DELETE` を検証する。
2. `cards` で public read-only と private owner write/delete が再現されることを確認する。
3. DELETE未指定テーブルで操作拒否されることを確認する。

#### Phase 2: Storage統合
1. `illustrations` バケットが private 設定で作成されていることを確認する。
2. ownerのみオブジェクト操作可、non-owner/unauthenticated拒否を確認する。

#### Phase 3: Frontend型統合
1. `frontend/src/types/database.ts` が7テーブルを含んでいることを確認する。
2. `frontend/src/lib/supabase/{server,client}.ts` で `Database` 型利用後に型チェックを通す。

### ACトレーサビリティマトリクス

| AC | 実装成果物 | 検証ポイント |
|---|---|---|
| AC-01 | `supabase/migrations/*_s02_schema_rls.sql`（7テーブルDDL、制約、INDEX） | Phase 0-2でテーブル定義/制約/INDEXをSQL検証 |
| AC-03 | `update_updated_at_column()` + 3テーブルトリガー（`users_profile`, `decks`, `illustrations`） | Phase 0-3/4で作成確認と `updated_at` 変化検証 |
| AC-04〜AC-09 | `CREATE POLICY` 群（RLSマトリクス準拠） | Phase 1でowner/non-owner/anonymousの操作結果検証 |
| AC-10 | `*_s02_storage_illustrations.sql`（private bucket + owner scoped policy） | Phase 2でbucket属性とアクセス境界を検証 |
| AC-12 | `frontend/src/types/database.ts` + Supabase client generic適用 | Phase 3で型生成結果と型チェック通過を検証 |

### 移行戦略

- 本ストーリーは新規基盤構築のため、前方マイグレーションのみで運用する。
- 破壊的変更は避け、要件外の公開境界追加（例: `illustrations` public化）はFutureで別ストーリー/別ADRとして扱う。

## テスト戦略

### 単体テスト

- SQL関数（`updated_at` trigger function）の挙動を対象テーブルごとに検証する。

### 統合テスト

- テーブル作成後の制約検証（PK/FK/CHECK/DEFAULT/INDEX）をSQLで実施する。
- `users_profile` / `decks` / `illustrations` のトリガー作成有無と `updated_at` 自動更新をSQLで実施する（AC-03）。
- RLSをowner/non-owner/unauthenticatedで検証する。

### E2Eテスト

- Supabaseローカル環境でMigration適用から認可検証まで一連実行する。
- 型生成後にフロント型チェックを実行し、実装契約が接続されていることを確認する。

### パフォーマンステスト

- `review_states(user_id, due_date)`、`deck_cards(card_id)`、`study_sessions(user_id, finished_at)` のクエリでインデックス利用計画を確認する。

## セキュリティ考慮事項

- 最小権限原則: 必要な操作だけをpolicyで明示許可する。
- 共有領域の限定: public readは `cards` のみに限定する。
- 二重境界: `illustrations` はDB行とStorageオブジェクトを同じowner境界で整合させる。
- default deny: DELETEを含む未定義操作は許可しない。

## 今後の拡張性

- `illustrations` 公開共有が必要になった場合は、DB policyとStorage policyをセットで拡張する。
- 型定義を将来shared packageへ分割する場合でも、S-02時点では `frontend/src/types/database.ts` を唯一の正とする。

## 代替案の検討

### 代替案1: 先に型生成だけ固定してDDL/RLSを後追いする

- **利点**: フロント実装が先行できる。
- **欠点**: 型と実DB境界が乖離しやすく、認可不備を検出しづらい。
- **不採用理由**: S-02は基盤整備ストーリーであり、実スキーマとRLS確定を先行させる必要がある。

## リスクと軽減策

| リスク | 影響度 | 発生確率 | 軽減策 |
|---|---|---|---|
| `story.md` 旧記述を参照して `illustrations` を公開扱いで実装する | 高 | 中 | 要件v1.1.0優先をDesign/ADR両方に明記する |
| DELETE policyの過剰追加でデータ破壊面が広がる | 高 | 中 | DELETE allow listを `cards private owner` のみに固定する |
| 型生成先がぶれて実装が複数型を参照する | 中 | 中 | 生成先を `frontend/src/types/database.ts` に固定し、レビュー観点にする |
| `pgcrypto` 未有効のままDDLが走りUUID既定値で失敗する | 中 | 低 | migration冒頭に `CREATE EXTENSION IF NOT EXISTS pgcrypto` を配置する |

## 参考資料

- `specs/stories/S-02-database-schema-rls/requirements.md` (v1.1.0)
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- Supabase Docs, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Docs, Storage Access Control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase JS Reference, `storage.createBucket`: https://supabase.com/docs/reference/javascript/storage-createbucket
- Supabase CLI Reference, `supabase gen types`: https://supabase.com/docs/reference/cli/supabase-gen-types
- PostgreSQL Docs, `CREATE POLICY`: https://www.postgresql.org/docs/current/sql-createpolicy.html
- PostgreSQL Docs, UUID Functions: https://www.postgresql.org/docs/current/functions-uuid.html
- PostgreSQL Docs, `CREATE EXTENSION`: https://www.postgresql.org/docs/current/sql-createextension.html

## 変更履歴

| 日付 | 版 | 変更内容 | 作成者 |
|---|---|---|---|
| 2026-02-23 | 1.1.0 | document-reviewer指摘対応として、AC-01スキーマ契約マトリクス、操作別RLSマトリクス、anonymousを含む公開cards読取明記、AC-03トリガー作成/検証トレースを追加 | Codex |
| 2026-02-23 | 1.0.0 | 初版作成 | Codex |
