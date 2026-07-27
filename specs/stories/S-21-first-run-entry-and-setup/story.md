---
id: S-21
feature: first-run-entry-and-setup
type: story
version: 1.0.0
created: 2026-07-26
updated: 2026-07-26
github_issue: 74
parent_epic: E-01
---

# S-21: 初回導線とセットアップをプロダクトとして仕上げる

## ユーザーストーリー

初めて「まいにち漢字」を利用する学習者または保護者として、トップページから自分の状態に合った次の操作へ迷わず進みたい。なぜなら、ログイン、新規登録、最初のデッキ作成、今日の学習開始までの入口が明確であれば、既に実装されている学習価値へすぐ到達できるから。

また、別環境を準備する開発者として、ローカル起動と主要 feature flag の設定方法をリポジトリ内の公開 runbook で確認したい。なぜなら、環境変数の記載漏れによって機能が表示されない原因を調査する時間を減らせるから。

## 解決する課題

- `frontend/app/page.tsx` は認証状態に関係なく `/login` と `/decks` を並べ、「導線案内（将来実装予定）」と表示している。
- 未ログインユーザーに `/signup` への入口がなく、認証済みユーザーにも主要な学習入口が明示されていない。
- `/decks` にはデッキ作成フォームが実装済みだが、0件時の文言は「デッキがまだありません」だけで、次に何を入力・操作するかを説明していない。
- `frontend/src/lib/env.ts` が参照する主要 feature flag / MCP 環境変数6件が `frontend/.env.local.example` に記載されていない。
- リポジトリルートに README はなく、ローカル起動、主要 feature flag、DB環境変数未設定時の品質コマンドの扱いをまとめた利用者向け runbook がない。

## スコープ

### 対象

- 公開トップページ `/` を、認証状態に応じた実用的な入口にする。
- 未ログイン時は「ログイン」と「新規登録」への明確な導線を表示する。
- ログイン済み時は `/decks` を主要操作として表示する。
- トップページから「将来実装予定」の表現を除去し、プロダクトの目的と次の操作が分かる文言にする。
- `/decks` のデッキ0件状態で、既存のデッキ作成フォームを使う次アクションを明示する。
- `frontend/.env.local.example` に以下を反映する。
  - `AI_CARD_IMPORT_ENABLED`
  - `AI_CARD_MANAGEMENT_ENABLED`
  - `MCP_ENABLED`
  - `MCP_PUBLIC_ORIGIN`
  - `MCP_OAUTH_ISSUER`
  - `MCP_ALLOWED_ORIGIN`
- `docs/runbooks/local-development.md` にローカル起動、主要 feature flag、品質コマンドの最小手順を記載する。
- `S10_TEST_DATABASE_URL` 未設定時に `npm --prefix frontend run check` がDB依存suiteで非ゼロ終了する現行挙動と、安全な扱いを記載する。
- 認証状態別、デッキ0件、環境変数例、文書契約を検証する回帰テストを追加または更新する。

### 対象外

- ログイン、サインアップ、ログアウト処理そのものの再設計。
- AIカード作成・管理フロー本体の再設計。
- SRSアルゴリズム、学習キュー、日付境界の変更。
- MCP tool、OAuth、token、tool入出力契約の変更。
- DB schema、migration、RLS、Storage policy、seedの変更。
- `npm --prefix frontend run check` のDB依存suiteを自動skipまたは自動provisionする仕組みの追加。
- `frontend/package.json` への `dev` script追加。
- production deploy、issue close、PR merge。

## 受入条件

- **AC-01**: 未ログイン状態で `/` を表示すると、「ログイン」と「新規登録」の名称を持つリンクがそれぞれ `/login` と `/signup` を指し、「将来実装予定」の文言が存在しない。
- **AC-02**: ログイン済み状態で `/` を表示すると、今日の学習へ進む主要リンクが `/decks` を指し、未ログイン向けのログイン・新規登録操作が主要操作として表示されない。
- **AC-03**: `/` は引き続き公開ルートであり、表示判定だけのためにDB更新、service role利用、他ユーザー情報の取得を行わない。
- **AC-04**: ログイン済みユーザーの所有デッキが0件の場合、`/decks` にデッキがないことに加え、「新しいデッキ名」を入力して「デッキを作成」することが次の操作だと分かる説明と既存フォームが表示される。
- **AC-05**: 所有デッキが1件以上ある場合、既存の一覧、今日の学習状況、デッキ詳細へのリンク、デッキ作成フォームが従来どおり利用できる。
- **AC-06**: `frontend/.env.local.example` に対象6環境変数が各1回記載され、secretや実環境のURL・credentialを含まない。
- **AC-07**: ローカル開発runbookに、前提、`.env.local.example` からの設定、`cd frontend && npm exec -- next dev`、既定URL `http://localhost:3000` が記載されている。
- **AC-08**: runbookに3つの feature flag の有効条件と無効時の意味、および3つの MCP URL設定の形式・用途が記載されている。
- **AC-09**: runbookに `npm --prefix frontend run check` が lint、typecheck、Vitestを実行すること、`S10_TEST_DATABASE_URL` 未設定時はDB依存suiteがfail-fastして全体を成功扱いできないこと、安全な個別確認方法が記載されている。
- **AC-10**: `npm --prefix frontend run lint` と `npm --prefix frontend run typecheck` が成功する。
- **AC-11**: 320px幅とdesktopで主要導線が横スクロールせず、リンクはキーボード操作でき、意味の分かるaccessible nameと可視focusを持つ。
- **AC-12**: AIカード作成、SRS、MCP tool契約、DB schema、RLSに差分がない。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/74
- Parent Epic: `specs/epics/E-01-project-foundation-auth/epic.md`
- Related Stories: S-01、S-03、S-06、S-16、S-19
- Accepted ADR:
  - `specs/adr/ADR-001-project-foundation-supabase-clients.md`
  - `specs/adr/ADR-003-authentication-flow.md`
  - `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`
