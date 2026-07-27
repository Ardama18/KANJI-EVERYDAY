---
id: S-21
story_id: S-21
feature: first-run-entry-and-setup
type: plan
version: 1.0.0
created: 2026-07-27
based_on: specs/stories/S-21-first-run-entry-and-setup/design.md
---

# S-21 Plan: 初回導線とセットアップ

## 1. 実装方針

`design.md` の Vertical Slice 方針に従い、公開トップ、デッキ0件表示、env example、local runbook、回帰テストを同一PRで更新する。

`tasks/` と個別 `task-*.md` は作成しない。実装作業の単一情報源はこの `plan.md` とする。

## 2. Phase 1: トップページ導線

- 対象要件: FR-ENTRY-01〜05、NFR-SEC-01〜02、NFR-A11Y-01〜02、NFR-RESP-01、AC-01〜03、AC-11
- 対象ファイル:
  - `frontend/app/page.tsx`
  - `frontend/src/app/page.test.tsx`
  - `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx`
  - `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`
- 実装:
  - `HomePage` を async Server Component にし、`createReadOnlyServerClient()` と `auth.getUser()` だけで認証状態を読む。
  - client factory生成は `try` 外へ置き、Supabase public env 欠落は fail-fast のままにする。
  - `getUser()` の error response / throw は guest UI へ劣化させ、raw errorやcookie/tokenを表示しない。
  - guest UI は `/login` の「ログイン」と `/signup` の「新規登録」を表示する。
  - authenticated UI は `/decks` の「今日の学習をはじめる」を表示する。
  - 「導線案内（将来実装予定）」と旧 `/decks` primary action を削除する。
  - 320px幅でも横スクロールしない余白、48px目安のリンク高、`focus-visible` を維持する。
- 完了条件:
  - root pageテストが guest / authenticated / auth error / auth throw を検証する。
  - S-01 のroot直接importテストが async component 契約へ追随する。
  - `/` のmiddleware設定、auth action、service role、DB queryに差分がない。
- 検証:
  - `npm --prefix frontend run test -- src/app/page.test.tsx ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`

## 3. Phase 2: デッキ0件表示

- 対象要件: FR-DECK-01〜03、NFR-COMPAT-01、AC-04〜05、AC-11
- 対象ファイル:
  - `frontend/app/(auth)/decks/page.tsx`
  - `frontend/src/app/decks/page.test.tsx`
- 実装:
  - `decks.length === 0` branch に次操作説明 `まずは新しいデッキ名を入力して、デッキを作成しましょう。` を追加する。
  - `CreateDeckForm`、deck actions、一覧branch、学習状況、詳細リンクは変更しない。
  - 取得失敗を0件へfallbackする変更を加えない。
- 完了条件:
  - 0件時に empty message、次操作説明、既存formが同時に表示される。
  - 1件以上では0件用説明が表示されず、既存一覧とformが維持される。
- 検証:
  - `npm --prefix frontend run test -- src/app/decks/page.test.tsx`

## 4. Phase 3: env example と local runbook

- 対象要件: FR-ENV-01〜03、FR-DOC-01〜08、NFR-SEC-03〜04、NFR-DOC-01、AC-06〜09、AC-12
- 対象ファイル:
  - `frontend/.env.local.example`
  - `docs/runbooks/local-development.md`
  - `frontend/src/lib/local-development-contract.test.ts`
- 実装:
  - `.env.local.example` に対象6環境変数を各1回だけ追加する。
  - feature flagは安全な既定として `false` にする。
  - MCP URL3件は空値にし、secret、token、cookie、実credential、実環境固有URLを入れない。
  - runbookに `.env.local` 準備、secret非記録、`cd frontend && npm exec -- next dev`、`http://localhost:3000`、feature flag、MCP URL形式、品質コマンド、`S10_TEST_DATABASE_URL` 未設定時の扱いを記載する。
  - `npm run dev`、Playwright、workspace、production/shared DB fallback を案内しない。
- 完了条件:
  - 契約テストで対象6キーの出現回数、runbookの必須項目、禁止項目、credentialらしい値の不在を検証する。
  - AIカード、SRS、MCP tool、DB schema、RLSの実装ファイルに差分がない。
- 検証:
  - `npm --prefix frontend run test -- src/lib/local-development-contract.test.ts`

## 5. Phase 4: 品質ゲートとUI確認

- 対象要件: FR-QUALITY-01〜02、FR-TEST-01、AC-10〜12
- 対象ファイル:
  - 実装差分全体
  - `specs/stories/S-21-first-run-entry-and-setup/meta.json`
- 実装:
  - 対象テスト、lint、typecheck、buildを実行する。
  - 隔離 `S10_TEST_DATABASE_URL` が利用できない場合、`check` は未実行または非成功として扱い、代替として lint/typecheck/対象非DB test/build を報告する。
  - 実ブラウザ確認が可能な場合、320px、desktop、keyboard focus、横スクロールなしを確認する。自動E2E完了とは報告しない。
  - 実装完了後、`meta.json.status` を `implementation_review` に更新する。PRを作成できた場合は `github_pr_url` を記録する。
- 検証:
  - `npm --prefix frontend run test -- src/app/page.test.tsx src/app/decks/page.test.tsx src/lib/local-development-contract.test.ts ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx ../specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run build`
  - 条件付き: `npm --prefix frontend run check`

## 6. リスクと停止条件

- DB schema、migration、RLS、Storage policy、middleware、auth actions、dependency、package scriptsに変更が必要になった場合は、S-21の設計前提を超えるため停止して報告する。
- `getUser()` 以外のDB/API読み取りが必要になった場合は、AC-03違反の可能性があるため停止して設計を見直す。
- `S10_TEST_DATABASE_URL` が共有DBまたはproduction DBを指す可能性がある場合、DB依存テストを実行しない。
- `npm --prefix frontend run check` がDB依存suiteで失敗する場合、成功扱いせず、失敗原因と実行済み代替ゲートを報告する。
