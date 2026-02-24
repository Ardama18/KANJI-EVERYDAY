---
id: ADR-003
feature: authentication-flow
type: adr
version: 1.1.0
created: 2026-02-23
status: Accepted
based_on: specs/stories/S-03-authentication-flow/requirements.md
related_epic: specs/epics/E-01-project-foundation-auth/epic.md
---

# ADR-003: S-03の認証境界とusers_profile救済戦略を固定

## ステータス

Accepted

## コンテキスト

`S-03 authentication-flow` では、認証機能そのものに加えて、実装時に解釈ぶれしやすい技術判断を先に固定する必要がある。特に要件 `v1.1.0` で合意された以下の論点は、Design Doc以前に設計決定として確定させる。

1. 認証境界をどこに置くか（middleware と Server Actions の責務分離）
2. middleware が持つべき責務の上限
3. `users_profile` の救済作成をどのタイミングで、どの冪等戦略で実施するか
4. `Enable email confirmations` の環境前提をどう扱うか

## 決定事項

1. 認証境界は「ルート制御は middleware」「認証状態遷移とプロフィール整合は Server Actions」に分離する。
2. `middleware.ts`（将来の `proxy.ts` 相当を含む）は Cookie同期とリダイレクト判定に限定し、DB書き込みを行わない。
3. middleware/Server Actions の認証再検証は `auth.getUser()` または `auth.getClaims()` を使い、`auth.getSession()` を認可判定の根拠に使わない。
4. signup は `Auth作成 -> users_profile作成 -> /decks遷移` の順で扱い、`users_profile` 作成失敗時は Auth アカウントを残したままエラー表示し、成功遷移しない。
5. login は認証成功後に `users_profile` 欠損を検知した場合のみ救済作成を実行し、`user_id` 一意制約を前提に `ON CONFLICT DO NOTHING` 相当の冪等挙動を必須とする。
6. 救済作成時の `display_name` は `user_metadata.display_name` を優先し、未設定時はメールローカル部をフォールバック値とする。
7. S-03の成立前提として Supabase Auth 設定 `Enable email confirmations = OFF` を固定し、ON環境でsignup直後セッションが確立しない場合は構成不一致エラーとして扱い `/decks` に遷移しない。

## 根拠

### 検討した選択肢

#### 選択肢1: Middleware集中型（認証判定とprofile救済を毎リクエスト実行）
- 利点
  - 認証関連処理を1箇所に集約できる
- 欠点
  - middleware にDB副作用が入り責務過多になる
  - 全リクエストの遅延要因となる
  - リダイレクト不具合時の原因切り分けが困難

#### 選択肢2（採用）: Server Action主導 + middleware最小責務
- 利点
  - 責務境界が明確で、要件ACとの対応が追跡しやすい
  - エラー文言と遷移制御を業務フロー単位で実装できる
  - profile救済をlogin成功時のみに限定でき、不要なDBアクセスを回避できる
- 欠点
  - 認証アクション内の分岐ロジックが増える
  - login時に追加クエリが発生する

#### 選択肢3: DBトリガー主導（auth.users作成時にusers_profile自動生成）
- 利点
  - データ整合性をDB側で担保しやすい
  - アプリケーションコード量を抑えられる
- 欠点
  - Supabase管理領域との結合が強くなる
  - 失敗時UX（どの文言を表示するか）をアプリ側で制御しづらい
  - display_nameフォールバック仕様の変更がSQL変更に波及する

#### 選択肢4: 非同期イベント主導（Webhook/Edge Functionでprofile作成）
- 利点
  - 認証処理とプロフィール作成を疎結合化できる
- 欠点
  - 最終整合性となり、login直後欠損を許容する設計になる
  - MVP要件の即時遷移判定と衝突する

### 比較マトリクス

| 評価軸 | 選択肢1 Middleware集中 | 選択肢2 Action主導（採用） | 選択肢3 DBトリガー | 選択肢4 非同期イベント |
|---|---|---|---|---|
| S-03要件適合性 | 中 | 高 | 中 | 低 |
| 責務境界の明確性 | 低 | 高 | 中 | 中 |
| UX制御（文言/遷移） | 低 | 高 | 低 | 低 |
| 整合性（profile欠損防止） | 中 | 高 | 高 | 中 |
| 運用負荷 | 中 | 中 | 高 | 高 |

### 決定理由

- S-03で必須となる「signup失敗時の説明責務」「login時救済の冪等保証」「`/decks` 境界制御」は、Action主導とmiddleware最小責務の分離が最も矛盾なく満たせる。
- middlewareを副作用なしに保つことで、認証境界のバグをリダイレクト条件に限定でき、運用時のトラブルシュートが容易になる。
- 認可判定を `getUser()` / `getClaims()` の再検証結果に固定することで、Cookie由来セッション情報のみの判定を避けられる。
- email verification設定は環境依存のため、MVPではOFF前提を設計決定として固定し、ON時は静かに失敗させず構成不一致として明示する方が安全である。

## 影響

### ポジティブな影響

- 認証境界（アクセス制御）と整合性補完（データ作成）が分離され、変更影響範囲が縮小される。
- `users_profile` 欠損ユーザーの復旧ルートがloginフロー内で確立される。
- 環境設定不一致（email confirmation ON）を早期検知できる。

### ネガティブな影響

- login成功時にprofile補完用の処理が追加される。
- Supabase設定の運用統制（MVPはOFF固定）を継続的に維持する必要がある。

### 中立的な影響

- 将来 `Enable email confirmations` をONに戻す場合は、遷移仕様と文言を再設計する追加ADRが必要になる。

## 実装への指針

- `middleware.ts` の判定マトリクスは以下を固定する。
  - 未認証 + `/decks` or `/decks/*` -> `/login`
  - 認証済み + `/login` or `/signup` -> `/decks`
  - `/` は常に公開
  - matcher は `/_next/static`, `/_next/image`, `/favicon.ico` を除外
- middleware/Server Actions の認証再検証は `auth.getUser()`（必要時 `auth.getClaims()`）を使用し、`auth.getSession()` は認可判定に使わない。
- `signUp` は `auth.signUp` 成功後に `users_profile` 作成を同期的に試行し、profile作成失敗時は遷移を止めてエラー表示する。
- `signIn` は認証成功後にprofile欠損を検知した場合のみ救済作成を行い、`user_id` 重複時は既存行を維持する。
- `timezone` は `Asia/Tokyo` 固定とし、S-03ではユーザー編集を扱わない。
- signup直後にセッション未確立（email verification ON想定）が検知された場合は、構成不一致エラーとして扱う。
- Next.js将来更新で `middleware.ts` が `proxy.ts` に移行される場合も、この判定マトリクスと再検証方針をそのまま引き継ぐ。

## 受入条件（EARS）

- 補足: 本ADRの受入条件は `S-03` 全体AC（`requirements.md` AC#1〜AC#20）のうち、認証境界・救済戦略・環境前提に関する部分集合を定義する。
- 遍在型: システムは middleware で `/decks` 系の未認証アクセスを `/login` へリダイレクトすること。
- 選択型: もし認証済みユーザーが `/login` または `/signup` へアクセスしたならば、システムは `/decks` にリダイレクトすること。
- 契機型: signup成功イベントが発生したとき、システムは `users_profile` 作成成功時のみ `/decks` に遷移すること。
- 不測型: もし signup後の `users_profile` 作成が失敗した場合、システムはAuthユーザーを維持したままエラーを表示し、成功遷移を行わないこと。
- 複合型: login成功イベントが発生し、かつ `users_profile` 欠損が検知されたとき、システムは冪等な救済作成を実行し、同一 `user_id` のレコード数を1件に保ったまま `/decks` へ遷移すること。
- 選択型: もし `Enable email confirmations` がONでsignup直後にセッションが確立しないならば、システムは構成不一致として扱い `/decks` に遷移しないこと。

## 参考資料

- Next.js Docs, Server Actions: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
- Next.js Docs, Middleware: https://nextjs.org/docs/app/building-your-application/routing/middleware
- Supabase Docs, Authentication Overview: https://supabase.com/docs/guides/auth
- Supabase JS Reference, `signUp`: https://supabase.com/docs/reference/javascript/auth-signup
- Supabase JS Reference, `signInWithPassword`: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Supabase JS Reference, `signOut`: https://supabase.com/docs/reference/javascript/auth-signout
- PostgreSQL Docs, `INSERT ... ON CONFLICT`: https://www.postgresql.org/docs/current/sql-insert.html

## 関連情報

- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/stories/S-03-authentication-flow/requirements.md`
- `specs/stories/S-03-authentication-flow/story.md`
