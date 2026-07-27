---
id: S-21
feature: first-run-entry-and-setup
type: requirements
version: 1.0.0
created: 2026-07-26
epic: E-01
---

# 要件定義書: 初回導線とセットアップ

## 1. 概要

- 目的: 初回アクセスから認証、最初のデッキ作成、今日の学習へ進むまでの迷いをなくし、別環境でも必要な設定を再現できる状態にする。
- 対象ユーザー: 初めて利用する学習者・保護者、およびローカル環境を準備する開発者。
- 対象範囲: 公開トップページ、`/decks` の0件状態、環境変数example、ローカル開発runbook。
- 対象外: 認証処理、AIカード作成フロー、SRS、MCP tool契約、DB/RLSの変更。

## 2. ユーザーストーリー

初めて利用する学習者または保護者として、トップページから自分の状態に合った次の操作へ迷わず進みたい。なぜなら、既に実装されている学習体験へすぐ到達したいから。

別環境を準備する開発者として、必要な環境変数、起動方法、品質コマンドの前提をリポジトリ内で確認したい。なぜなら、設定漏れによる機能非表示や品質検査の誤判定を防ぎたいから。

## 3. 要件分析判定

- タスクタイプ: feature / UX・開発者体験改善
- 規模: large
- 推定実装ファイル数: 6〜7
- 影響レイヤー:
  - Next.js公開Server Component
  - 認証状態の読み取り境界
  - デッキ一覧UI
  - 環境設定
  - 開発runbook
  - Vitest回帰テスト
- 要件定義書: 必須（モード: create。新規Storyかつ推定6ファイル以上）
- Design Doc: 必須（大規模かつUI・認証状態読取・設定・文書の複数境界）
- 作業計画書: 必須（大規模）
- ADR: 不要（既存ADR-001、ADR-003、ADR-011の範囲内であり、認証・データ・MCP契約を変更しない）

推定対象ファイルは次のとおり。

1. `frontend/app/page.tsx`
2. `frontend/src/app/page.test.tsx`
3. `frontend/app/(auth)/decks/page.tsx`
4. `frontend/src/app/decks/page.test.tsx`
5. `frontend/.env.local.example`
6. `docs/runbooks/local-development.md`
7. 必要に応じて環境変数exampleまたは文書の契約テスト1ファイル

## 4. 前提・依存関係

- E-01のSupabase Auth、Server/Browser client分離、環境変数fail-fast方針を維持する。
- S-03の `/login`、`/signup`、`/decks` 遷移および `auth.getUser()` による認証判定を再利用する。
- S-06/S-19のデッキ一覧・学習状況表示を変更しない。
- S-16の `CreateDeckForm` とowner-scoped Server Actionを再利用する。
- MCP設定はADR-011のHTTPS origin、Supabase OAuth issuer、fail-closed契約を維持する。
- 現行 `frontend/package.json` に `dev` script、Playwright、npm workspaceは存在しない。

## 5. 現行調査と既存で充足している境界

| 対象 | 確認結果 | 判定 |
|---|---|---|
| ログイン画面 | `frontend/app/login/page.tsx:1-20` に `/login` と `LoginForm` が存在 | 認証画面本体は既存で充足。再実装対象外 |
| 新規登録画面 | `frontend/app/signup/page.tsx:1-18` に `/signup` と `SignupForm` が存在 | 登録画面本体は既存で充足。再実装対象外 |
| 認証成功後の遷移 | `frontend/src/actions/auth-actions.ts:22-25` でsignup/login後の `/decks` 遷移を定義 | 認証Action変更は対象外 |
| トップページ | `frontend/app/page.tsx:2-7` に「将来実装予定」と認証状態を区別しない `/login`・`/decks` リンクが存在 | 要求未充足。対象 |
| 公開ルート | `frontend/middleware.ts:7,30-31` で `/` は認証判定なしに通過 | 公開性は既存で充足し維持対象 |
| デッキ作成 | `frontend/app/(auth)/decks/page.tsx:19-23` にフォームと空状態が存在 | 作成機能は既存で充足。次操作の説明は未充足 |
| デッキ作成UI | `frontend/src/components/deck/CreateDeckForm.tsx:33-49` に「新しいデッキ名」と「デッキを作成」が存在 | コンポーネント本体は再利用 |
| 環境変数参照 | `frontend/src/lib/env.ts:69-87` で対象feature flag / MCP envを参照 | 実装済み。exampleへの反映は未充足 |
| 環境変数example | `frontend/.env.local.example:1-14` に対象6変数が存在しない | 要求未充足。対象 |
| 品質コマンド | `frontend/package.json` の `check` は lint → typecheck → test | コマンド追加は不要。利用条件の文書化が対象 |
| DB依存テスト | S-10 integration/E2EとAIカード管理real-DB suiteはimport時に `createS10DbClient()` を実行 | `S10_TEST_DATABASE_URL` 未設定時の非ゼロ終了をrunbookへ記載 |

親・関連機能が存在することだけを根拠に対象外とはせず、トップページの状態分岐、空状態の説明、example、runbookが実在しないことを個別に確認した。

## 6. 機能要件

| ID | 要件 | 優先度 | 検証方法 |
|---|---|---|---|
| FR-ENTRY-01 | `/` は「まいにち漢字」の目的を短い日本語で説明し、「将来実装予定」を含めない | Must | ルートpageテスト、文言検索 |
| FR-ENTRY-02 | 認証ユーザーが存在しない場合、`/` は `/login` の「ログイン」と `/signup` の「新規登録」を表示する | Must | `getUser()` 未認証mockによるpageテスト |
| FR-ENTRY-03 | 認証済みの場合、`/` は `/decks` を指す学習開始用のprimary actionを表示する | Must | 認証済みuser mockによるpageテスト |
| FR-ENTRY-04 | 認証済み表示では、ログイン・新規登録をprimary actionとして表示しない | Must | 認証済みpageテスト |
| FR-ENTRY-05 | セッションが無効・期限切れで認証ユーザーを取得できない場合は未ログイン状態として表示し、保護データを表示しない | Must | recoverable auth error / user nullテスト |
| FR-DECK-01 | 所有デッキが0件の場合、「デッキがまだありません」に加え、名前を入力して作成することが次の操作だと分かる説明を表示する | Must | デッキpageの0件テスト |
| FR-DECK-02 | デッキ0件状態でも既存 `CreateDeckForm` を表示し、「新しいデッキ名」と「デッキを作成」を同一画面で確認できる | Must | 静的マークアップテスト |
| FR-DECK-03 | デッキが1件以上の場合、既存一覧、学習状況、詳細リンク、作成フォームを維持する | Must | 既存デッキpage回帰テスト |
| FR-ENV-01 | `frontend/.env.local.example` に対象6変数を重複なく記載する | Must | ファイル契約テストまたは静的確認 |
| FR-ENV-02 | feature flagは文字列 `true` のときだけ有効で、未設定・空・`false` は無効となる現行契約をexampleまたはrunbookで説明する | Must | example/runbook確認、既存envテスト |
| FR-ENV-03 | MCP URL設定は `MCP_PUBLIC_ORIGIN` と `MCP_ALLOWED_ORIGIN` がHTTPS origin、`MCP_OAUTH_ISSUER` がHTTPSの `/auth/v1` issuerであることを説明する | Must | runbook契約確認 |
| FR-DOC-01 | `docs/runbooks/local-development.md` にNode.js、依存導入済み状態、Supabase接続値、migration/seed前提を記載する | Must | 文書レビュー |
| FR-DOC-02 | runbookに `.env.local.example` から `frontend/.env.local` を準備し、実値をcommit・ログへ残さない手順を記載する | Must | 文書レビュー |
| FR-DOC-03 | runbookに `cd frontend && npm exec -- next dev` と既定URL `http://localhost:3000` を記載し、存在しない `npm run dev` を案内しない | Must | 文書契約確認 |
| FR-DOC-04 | runbookに `AI_CARD_IMPORT_ENABLED`、`AI_CARD_MANAGEMENT_ENABLED`、`MCP_ENABLED` の対象機能と無効時の挙動を記載する | Must | 文書レビュー |
| FR-DOC-05 | runbookに `npm --prefix frontend run lint`、`typecheck`、`check` の目的と実行位置を記載する | Must | 文書契約確認 |
| FR-DOC-06 | `S10_TEST_DATABASE_URL` 未設定時はDB依存suiteがfail-fastし、`check` 全体を成功扱いできないことを記載する | Must | 文書レビュー |
| FR-DOC-07 | DB環境がない場合は最低限lint/typecheckと対象の非DBテストを個別実行し、DB統合テストは「未実行」と報告することを記載する | Must | 文書レビュー |
| FR-DOC-08 | DB統合テストに共有・production DBを使用せず、migration適用済みの隔離DBを使う注意を記載する | Must | 文書レビュー |
| FR-QUALITY-01 | `npm --prefix frontend run lint` と `npm --prefix frontend run typecheck` が成功する | Must | コマンド実行 |
| FR-QUALITY-02 | 有効な隔離 `S10_TEST_DATABASE_URL` が利用できる場合、`npm --prefix frontend run check` が成功する | Must（環境条件付き） | コマンド実行 |
| FR-TEST-01 | 認証状態別トップページ、デッキ0件状態、対象環境変数の存在を自動テストで固定する | Must | Vitest |

## 7. 非機能要件

- **NFR-SEC-01**: `/` の認証判定はserver側で `auth.getUser()` を使用し、client supplied値や `getSession()` だけを認可根拠にしない。
- **NFR-SEC-02**: トップページの表示判定でservice role client、DB書き込み、owner外データ取得を行わない。
- **NFR-SEC-03**: `.env.local.example` とrunbookにsecret、token、cookie、実credential、実環境固有のURLを記録しない。
- **NFR-SEC-04**: MCP無効時の404 fail-closed、JWT/RLS、allowed originの現行契約を変更しない。
- **NFR-A11Y-01**: 各主要リンクは意味の分かる日本語accessible nameを持ち、色だけで状態や優先度を伝えない。
- **NFR-A11Y-02**: keyboard focusを可視化し、主要操作のtouch targetは48×48px以上を目安とする。
- **NFR-RESP-01**: 320px幅、200% zoom、長い日本語でも横スクロールを発生させない。
- **NFR-COMPAT-01**: `/login`、`/signup`、`/decks`、デッキ詳細、学習、AIカード、MCPの既存契約を変更しない。
- **NFR-RELIABILITY-01**: 必須Supabase環境変数の欠落はADR-001どおりfail-fastし、成功表示や空結果へ変換しない。
- **NFR-DOC-01**: runbookのコマンドとscriptは現行 `frontend/package.json` およびsource treeに実在するものだけを記載する。

## 8. エラー・境界条件

- 未認証、期限切れセッション、ユーザーなし: `/` は未ログイン向け入口を表示する。
- 必須Supabase env欠落: ADR-001のfail-fastを維持し、トップページ固有のfallbackで構成不備を隠さない。
- デッキ0件: エラーや完了状態ではなく、最初のデッキ作成を案内するempty stateとして扱う。
- デッキ取得失敗: 0件として表示せず、既存の例外契約を維持する。
- feature flag未設定または `false`: 対象機能は無効。既存データは削除・変更しない。
- `MCP_ENABLED=false`: MCP endpoint/tool dispatchは既存どおりfail closed。
- MCP URL不正: 既存env検証どおり設定エラーとして扱い、runbookで有効な形式を説明する。
- `S10_TEST_DATABASE_URL` 未設定: DB依存suiteは未実行ではなく現状fail-fastするため、`check` 成功と報告しない。
- `S10_TEST_DATABASE_URL` が共有・production DBを指す可能性がある場合: DB統合テストを実行しない。

## 9. 受入条件

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | 認証ユーザーが存在しない | `/` を表示する | `/login` の「ログイン」と `/signup` の「新規登録」が表示され、「将来実装予定」と `/decks` のprimary actionは表示されない |
| AC-02 | 有効な認証ユーザーが存在する | `/` を表示する | `/decks` を指す学習開始用primary actionが表示され、ログイン・新規登録はprimary actionとして表示されない |
| AC-03 | `/` の認証状態を判定する | pageを描画する | DB更新、service role利用、ownerデータ取得を行わない |
| AC-04 | 所有デッキが0件 | `/decks` を表示する | デッキがない説明、名前入力、作成ボタン、次操作の説明が同時に表示される |
| AC-05 | 所有デッキが1件以上 | `/decks` を表示する | 既存一覧・学習状況・詳細リンク・作成フォームが表示され、0件用説明は表示されない |
| AC-06 | `frontend/.env.local.example` を読む | キー集合を確認する | 対象6変数が各1回存在し、secretや実credentialを含まない |
| AC-07 | 新しい開発環境を準備する | local runbookに従う | `.env.local` の準備と `npm exec -- next dev` により起動手順を再現できる |
| AC-08 | feature flagまたはMCP設定を確認する | local runbookを読む | 3 flagの有効条件・対象機能と、3 MCP URLの形式・用途が分かる |
| AC-09 | `S10_TEST_DATABASE_URL` がない | 品質手順を確認する | `check` がDB suiteで非ゼロになり得ること、個別確認、未実行報告方法が分かる |
| AC-10 | 実装と回帰テストが完了している | lintとtypecheckを実行する | 両コマンドがexit 0になる |
| AC-11 | 320px幅またはkeyboard onlyで操作する | `/` とデッキ0件画面を利用する | 横スクロールなく全primary actionへ到達でき、focusとaccessible nameを確認できる |
| AC-12 | Story差分をレビューする | schema・SRS・MCP契約・AIカード処理を比較する | これらに変更がない |

## 10. データ・互換性

- schema / migration / RLS / Storage / seedへの影響: なし。
- 既存データへの影響: なし。
- 既存セッションへの影響: なし。
- 認証境界: ADR-003の `auth.getUser()` と既存ルート保護を維持する。
- MCP契約: ADR-011のtool、OAuth、JWT、origin、fail-closed契約を維持する。
- ロールバック: UI、example、runbook、テスト変更をPR revertする。DBのrollbackは不要。

## 11. 対象外（Won't）

- WON'T-01: AIカード作成・管理フロー本体を変更しない。
- WON'T-02: SRSの分類、間隔、キュー、日付基準を変更しない。
- WON'T-03: MCP toolの追加・削除・schema変更を行わない。
- WON'T-04: DB schema、migration、RLS、Storage policy、seedを変更しない。
- WON'T-05: 認証Action、signup/login契約、middlewareの保護範囲を変更しない。
- WON'T-06: `check` のDB環境変数依存をskip・mock・既定DB fallbackで解消しない。
- WON'T-07: `dev` script、Playwright、追加dependencyを導入しない。

## 12. 技術的リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 公開トップでauth判定を追加し、env欠落時の挙動が変わる | ローカル入口が500になる可能性 | ADR-001のfail-fastを仕様として明記し、runbookで必須envを先に設定する |
| 認証状態別pageを静的pageとしてテストし続ける | 認証済み分岐の回帰を検出できない | server auth境界をmockした状態別pageテストへ更新する |
| `/decks` の既存フォームがあることだけで空状態要件を充足扱いする | 初回ユーザーが次操作を理解できない | 説明文とフォーム操作名を同一ACで検証する |
| feature flagを設定しても依存secretやURLがない | 機能が表示されても実行時に失敗する | runbookでflagと依存envを分けて記載し、secretをexampleへ埋めない |
| DB envなしの `check` を回帰失敗または成功と誤報する | 品質証跡が不正確になる | 非ゼロ挙動、個別検査、未実行報告、隔離DB条件を明記する |
| MCP exampleが実環境URLを含む | 環境情報の漏えい・誤接続 | 空値または明示的placeholderのみ使用する |

## 13. 未解決事項

なし。

- トップページの最終コピーと視覚配置はDesign Docで確定するが、FR/ACの意味とリンク先は確定済み。
- `check` のDB env未設定時の扱いは、本Storyでは文書化のみとし、runner変更は対象外で確定する。
