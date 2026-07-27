---
id: S-21
story_id: S-21
title: first-run-entry-and-setup
feature: first-run-entry-and-setup
epic_id: E-01
type: design
version: 1.0.0
created: 2026-07-26
based_on: specs/stories/S-21-first-run-entry-and-setup/requirements.md
related_adr:
  - specs/adr/ADR-001-project-foundation-supabase-clients.md
  - specs/adr/ADR-003-authentication-flow.md
  - specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md
---

# S-21 Design: 初回導線とセットアップ

対象 Issue は #74。要件と受入条件は `story.md` と `requirements.md` を正本とする。
本設計は公開トップページ、デッキ0件表示、環境変数example、ローカル開発runbook、および回帰テストの実装境界を定める。

## 1. 設計方針

既存の認証、デッキ作成、AIカード、MCP、SRSの契約は変更せず、既にある学習体験へ到達するまでの案内だけを改善する。

1. `/` はADR-003どおり公開ルートのまま維持する。
2. `/` のServer Componentでread-only Supabase clientを使い、`auth.getUser()` の結果だけで表示を分岐する。
3. 認証取得エラーは未ログイン表示へ安全に劣化させるが、必須env欠落はADR-001どおりfail-fastを維持する。
4. `/decks` は既存 `CreateDeckForm` とServer Actionを再利用し、0件branchの説明だけを強化する。
5. feature flag / MCPの実装契約は変えず、exampleとrunbookを現行コードへ同期する。
6. 新規dependency、DB変更、middleware変更、認証Action変更は行わない。

新規ADRは不要。ADR-001、ADR-003、ADR-011の既存判断の範囲内である。

### 1.1 合意事項チェックリスト

| 合意事項 | 設計への反映 | 確認 |
|---|---|---|
| scopeは公開トップ、deck 0件説明、env example、runbook、回帰test | D-1〜D-6、影響マップ | 反映済み |
| 認証Action、middleware、DB/RLS、SRS、MCP tool契約、依存は変更しない | 責務境界、非影響一覧 | 反映済み |
| `/` は公開のまま、認証状態はserverで安全に読む | D-1、D-2 | 反映済み |
| 構成不備をguest表示で隠さない | D-2 | 反映済み |
| mobile、keyboard、accessible nameを受入対象にする | D-3、L3 | 反映済み |
| 新しい応答時間目標は設けず、rootの追加I/Oを `auth.getUser()` 1回に限定する | D-1、責務境界 | 反映済み |

合意と矛盾する設計、未反映事項はない。

### 1.2 実装アプローチ

**Vertical Slice** を採用する。root認証表示、deck empty state、local setup文書をそれぞれ観測可能な利用者価値と回帰testまで一体で変更でき、schemaや共通基盤の先行変更が不要だからである。全体が初めて完了する統合点は、3 sliceの対象test、`lint`、`typecheck`、`build`、およびL3手動確認が揃った時点とする。

## 2. 現行調査

| 対象 | 現行 | 設計への反映 |
|---|---|---|
| `frontend/app/page.tsx` | 同期Server Component。認証状態を区別せず `/login` と `/decks` を表示し、「導線案内（将来実装予定）」を含む | async Server Componentへ変更し、認証状態別CTAを描画 |
| `frontend/middleware.ts` | `/` は常時公開。`/decks` は保護、`/login` と `/signup` はguest-only | 変更しない |
| `frontend/src/lib/supabase/server.ts` | `createReadOnlyServerClient()` がServer Component向けcookie no-op clientを提供 | `/` で再利用 |
| login / signup | 既存page、form、成功後 `/decks` redirectが存在 | リンク先として再利用し、処理は変更しない |
| `frontend/app/(auth)/decks/page.tsx` | `CreateDeckForm` は常時表示。0件時は「デッキがまだありません」のみ | 0件時の次操作説明を追加 |
| `CreateDeckForm` / deck actions | 入力、pending、成功・失敗、認証、owner filter、revalidateを実装済み | 変更せず再利用 |
| `frontend/src/lib/env.ts` | 3つのflagとMCP URLを検証・参照 | 実装は変更せずexample/runbookを同期 |
| `.env.local.example` | Issue指定の6変数が未記載 | 空値または安全なplaceholderで追加 |
| 開発文書 | ローカル起動の公開runbookがない。steeringと既存runbookに断片的な手順がある | `docs/runbooks/local-development.md` を新設 |
| `frontend/package.json` | `check = lint && typecheck && test`。`dev` script、Playwrightはない | 実在するコマンドだけを案内 |
| Vitest | `frontend/src/**/*.test.*` と一部Story testsを明示include。S-10 DB suiteは通常inventoryに入る | 新規契約testは `frontend/src` 配下に置き、config変更を避ける |

### 2.1 既存テストへの波及

`HomePage` をasync化すると、近接する `frontend/src/app/page.test.tsx` だけでなく、次の既存テストも直接importのため更新が必要になる。

- `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx`
- `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`

これらの `e2e` 名は実ブラウザE2Eを意味せず、Vitest上のmockベース検証である。実ブラウザ確認は別に手動で行う。

## 3. 選択肢と決定

### D-1: トップページの認証状態判定

採用: `/` をasync Server Componentにし、`createReadOnlyServerClient()` と `auth.getUser()` を使って表示だけを分岐する。

```text
GET /
  → middleware: 公開ルートとして通過
  → HomePage
  → createReadOnlyServerClient()
  → auth.getUser()
     ├─ userあり: /decks への「今日の学習をはじめる」
     └─ userなし / auth取得エラー: /login「ログイン」+ /signup「新規登録」
```

理由:

- Server Componentのため認証状態をブラウザへ委譲せず、初回HTMLで正しいCTAを出せる。
- `getUser()` は既存ADRと認証境界に一致する。
- read-only clientにより、表示判定からcookie更新やDB更新へ責務が広がらない。
- `/` の公開性を維持し、未ログインユーザーもプロダクト説明を読める。

却下:

- middlewareで `/` をguest-onlyまたはprotectedにする: ADR-003とAC-03に反する。
- client componentで認証状態を後取得する: loading/flickerが増え、server/client境界を不必要に広げる。
- `getSession()` だけを使う: serverで検証済みuserを正本にする既存契約に反する。
- 常に `/decks` へredirectする: 未ログイン向けの実用入口という要件を満たさない。

### D-2: 認証エラーと構成エラーの境界

client factoryの生成はcatch範囲の外に置き、`auth.getUser()` の呼び出しだけを安全劣化の対象にする。

```ts
const supabase = createReadOnlyServerClient(); // env欠落はthrow

let user = null;
try {
  const result = await supabase.auth.getUser();
  user = result.error === null ? result.data.user : null;
} catch {
  // guest表示。secret、cookie、provider errorは出力しない
}
```

`getUser()` が `{ data: { user: null }, error }` を返す場合とthrowする場合はguest表示にする。必須Supabase env不足は成功表示へ変換せずfail-fastする。

### D-3: トップページのUI構造

最終コピーを次で固定する。

- 見出し: `まいにち漢字`
- 説明: `毎日少しずつ、漢字の読み書きを復習しよう。`
- 未ログインprimary: `ログイン` → `/login`
- 未ログインsecondary: `新規登録` → `/signup`
- 認証済みprimary: `今日の学習をはじめる` → `/decks`

構造:

- 1つの中央寄せカード内に見出し、説明、状態別CTAを配置する。
- CTA containerはmobileで縦、余裕のある幅で横並びにできる構造とする。
- 各リンクは最小高さ48px、意味の分かるvisible label、`focus-visible` outline/ringを持つ。
- 固定幅や長い非改行文字列を避け、320px幅と200% zoomで横スクロールを発生させない。
- `ROOT_PAGE_NOTICE` と「将来実装予定」は削除する。

### D-4: デッキ0件表示

`CreateDeckForm` の位置、props、Actionを変更しない。`decks.length === 0` のbranchだけに次の内容を表示する。

- 状態: `デッキがまだありません`
- 次操作: `まずは新しいデッキ名を入力して、デッキを作成しましょう。`

フォームの既存ラベル `新しいデッキ名` とbutton `デッキを作成` が同一画面に続くため、説明から操作までが連続する。1件以上の一覧branch、今日の学習状況、詳細リンクは変更しない。

カード0件時の案内やAIカード作成への導線は本Storyの対象外とする。

### D-5: env example契約

`frontend/.env.local.example` に次のキーを各1回追加する。

| Key | example | 実装契約 |
|---|---|---|
| `AI_CARD_IMPORT_ENABLED` | `false` | trim後、厳密に `true` のときだけ有効 |
| `AI_CARD_MANAGEMENT_ENABLED` | `false` | trimせず、厳密に `true` のときだけ有効 |
| `MCP_ENABLED` | `false` | trim後、厳密に `true` のときだけ有効 |
| `MCP_PUBLIC_ORIGIN` | 空値 | HTTPS origin。path/query/hash/userinfo不可 |
| `MCP_OAUTH_ISSUER` | 空値 | HTTPS URLかつpathは正確に `/auth/v1` |
| `MCP_ALLOWED_ORIGIN` | 空値 | HTTPS origin。path/query/hash/userinfo不可 |

exampleにはsecret、token、cookie、実credential、実環境固有URLを含めない。MCPを無効にした初期状態を安全な既定とし、既存データを変更しない。

### D-6: ローカル開発runbook

`docs/runbooks/local-development.md` を新設し、次を記載する。

1. Node.js/npm、依存導入、Supabase接続先、migration/seed適用済みという前提。
2. `frontend/.env.local.example` から `frontend/.env.local` を準備する手順。
3. `.env.local` や実credentialをcommit・ログ・Issue・PRへ残さない注意。
4. 起動コマンド `cd frontend && npm exec -- next dev` と `http://localhost:3000`。
5. 3つのfeature flagの対象機能、有効条件、無効時の意味。
6. MCP URL3件の用途と形式。MCPを使う場合は関連secretも別途必要だが、値は文書へ書かない。
7. `npm --prefix frontend run lint`、`typecheck`、`check` の目的。
8. `check` はVitestにDB依存suiteを含み、`S10_TEST_DATABASE_URL` 未設定なら非ゼロ終了し得る現行仕様。
9. 隔離DBがない場合はlint/typecheck/対象非DBtestを実行し、DB suiteを「未実行」と報告すること。
10. DBテストに共有・production DBをfallback使用しないこと。

存在しない `npm run dev`、Playwright、workspaceコマンドは案内しない。

## 4. 責務境界とデータフロー

```mermaid
flowchart LR
  Browser[Browser: GET /] --> Middleware[middleware]
  Middleware -->|公開ルートとして通過| Home[HomePage Server Component]
  Home --> Factory[createReadOnlyServerClient]
  Factory --> Env[getPublicEnvConfig]
  Factory --> Auth[Supabase Auth getUser]
  Auth -->|valid user| Member[/decks CTA]
  Auth -->|user null / error / throw| Guest[/login + /signup CTA]
  Env -->|required public env missing| Fail[fail-fast]
```

| 層 | 責務 | 禁止事項 |
|---|---|---|
| middleware | 既存どおり `/` を公開で通す | `/` の認証必須化、guest-only化 |
| root Server Component | 認証userの有無を読み、CTAを選ぶ | DB mutation、service role、owner data取得 |
| auth pages/actions | 既存ログイン・登録と `/decks` redirect | 本Storyでの変更 |
| decks Server Component | 既存deck読取結果を表示し、0件説明を追加 | 0件を取得失敗のfallbackとして扱う |
| CreateDeckForm / Action | 既存の作成操作、認証、owner insert | 本Storyでの変更 |
| env | 現行flag/URL検証 | 判定ロジック変更 |
| runbook | 現行の再現可能な設定・起動・品質手順 | secret実値、存在しないscript |

DB row、schema、RLS、Storage、SRS、study sessionへのdata flow変更はない。

### 4.1 統合境界の約束

| 境界 | 入力 | 出力 | エラー時 |
|---|---|---|---|
| `HomePage` → read-only Supabase client | request cookieと公開Supabase env | 非同期factoryでclientを生成 | factory/env失敗はthrowし、guestへ変換しない |
| `HomePage` → `auth.getUser()` | read-only client | 非同期で検証済みuserまたはnull | response error / throwはguest表示。raw error、cookie、tokenを表示・記録しない |
| `DecksPage` → `getDecksWithCounts()` | 認証cookie | 非同期でowner-scoped `DeckWithCounts[]` | 取得失敗を空配列へ変換せず既存失敗契約を維持 |
| `DecksPage` → `CreateDeckForm` | propsなし | Client Componentの既存作成form | validation / Action errorは既存UI契約を維持 |
| runbook → `env.ts` / package scripts | 開発者が設定する文字列と実在command | 現行flag、URL検証、品質手順の再現 | 不正URLは既存fail-closed、DB未準備は未実行として報告 |

### 4.2 インターフェース変更マトリクス

| 既存interface | 変更後 | 変換 | adapter / 互換性 |
|---|---|---|---|
| `HomePage(): JSX.Element` | `HomePage(): Promise<JSX.Element>` | 直接importするtestは`await HomePage()`へ更新 | production route adapter不要。S-01の2 testを同一変更で追随 |
| `createReadOnlyServerClient()` | 変更なし | なし | 既存factoryを再利用 |
| `DecksPage()` / `CreateDeckForm` / deck Actions | 変更なし | なし | empty branchのコピーだけ追加 |
| env flag / MCP URL contract | 変更なし | なし | exampleとrunbookを現行実装へ同期 |

## 5. エラー・状態設計

| 状態 | 表示・挙動 |
|---|---|
| 認証userあり | `/decks` CTAを表示 |
| userなし | `/login` と `/signup` CTAを表示 |
| `getUser()` がerrorを返す | guest表示。raw errorを表示・記録しない |
| `getUser()` がthrowする | guest表示。raw errorを表示・記録しない |
| 必須Supabase env不足 | client factoryのfail-fastを維持 |
| deck 0件 | empty stateと次操作説明、既存作成フォームを表示 |
| deck取得失敗 | 0件へ変換せず既存エラー契約を維持 |
| flag未設定/無効 | 対象機能を既存どおり無効化。データは保持 |
| `S10_TEST_DATABASE_URL` 不足 | DB suiteの非ゼロを成功扱いせず、runbookどおり未実行範囲を報告 |

## 6. 影響マップ

### 直接変更候補

- `frontend/app/page.tsx`
- `frontend/src/app/page.test.tsx`
- `frontend/app/(auth)/decks/page.tsx`
- `frontend/src/app/decks/page.test.tsx`
- `frontend/.env.local.example`
- `docs/runbooks/local-development.md`

### 間接更新候補

- `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.tsx`
- `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.e2e.test.tsx`
- env/example/runbook契約を固定する `frontend/src/**/*.test.ts`

契約testを `frontend/src` 配下に置き、`frontend/vitest.config.ts` は変更しない。

### 非影響

- `frontend/middleware.ts`
- auth/deck Server Actions
- Supabase client factory
- DB schema、migration、RLS、Storage、seed
- AIカード生成・管理処理
- MCP route、tool、OAuth、JWT契約
- SRS、学習queue、`study_sessions`
- dependencies、`frontend/package.json`

## 7. テスト戦略

### L1: Unit / component

- root page:
  - userなしで `/login` と `/signup`、旧文言なし。
  - userありで `/decks` CTA、guest CTAなし。
  - `getUser()` のerror responseとthrowでguest表示。
  - auth以外のquery/mutationを呼ばない。
- decks page:
  - 0件で状態説明、次操作説明、既存form。
  - 1件以上で0件説明なし、既存一覧とformを維持。
- env/runbook contract:
  - 6キーが各1回。
  - runbookに起動、flag、MCP形式、品質/DB注意が存在。
  - `npm run dev` の誤案内やcredential実値がない。

### L2: Integration

- S-01のroot page importテストをasync契約へ更新する。
- middlewareの `/` 公開、`/decks` 保護、guest-only routesの既存テストを維持する。
- `createReadOnlyServerClient` のcookie書込みno-opとenv fail-fastの既存テストを維持する。
- deck actionsの認証、owner filter、取得失敗を0件へ変換しない既存テストを維持する。

### L3: build / UI / environment

- `npm --prefix frontend run lint`
- `npm --prefix frontend run typecheck`
- 対象の非DB Vitest
- 隔離 `S10_TEST_DATABASE_URL` が利用可能な場合のみ `npm --prefix frontend run check`
- routeとasync Server Componentへ影響するため `npm --prefix frontend run build`
- 実ブラウザで320px、desktop、200% zoom、keyboard only、focus-visibleを確認

Playwrightは未導入なので、実ブラウザ自動E2E完了とは報告しない。

## 8. 要件トレーサビリティ

| 要件 | 設計 | 検証 |
|---|---|---|
| FR-ENTRY-01 | D-3 | root page unitで説明と旧文言不在 |
| FR-ENTRY-02 | D-1、D-3 | guest auth mockでlogin/signup |
| FR-ENTRY-03 | D-1、D-3 | authenticated mockでdecks CTA |
| FR-ENTRY-04 | D-3 | authenticated markupでguest CTA不在 |
| FR-ENTRY-05 | D-2、§5 | error response / throwのunit |
| FR-DECK-01 | D-4 | decks 0件page unit |
| FR-DECK-02 | D-4 | empty説明と既存formの同時描画 |
| FR-DECK-03 | D-4 | 1件以上の既存一覧回帰 |
| FR-ENV-01 | D-5 | 6 keyの出現回数contract test |
| FR-ENV-02 | D-5、D-6 | flagごとのtrim差異をrunbook/testで照合 |
| FR-ENV-03 | D-5、D-6 | MCP URL形式contract test |
| FR-DOC-01 | D-6.1 | runbook文書contract |
| FR-DOC-02 | D-6.2〜3 | env準備・secret非記録contract |
| FR-DOC-03 | D-6.4 | 起動command / URL contract |
| FR-DOC-04 | D-6.5 | 3 flagの対象・無効時contract |
| FR-DOC-05 | D-6.7 | lint / typecheck / check contract |
| FR-DOC-06 | D-6.8 | DB env不足時のfail-fast説明 |
| FR-DOC-07 | D-6.9 | 非DB個別確認・未実行報告contract |
| FR-DOC-08 | D-6.10 | 隔離DB限定の文書contract |
| FR-QUALITY-01 | §7 L3 | lint、typecheck |
| FR-QUALITY-02 | §7 L3 | 隔離DBがある場合の条件付きcheck |
| FR-TEST-01 | §7 L1/L2 | root、deck、env contract Vitest |
| NFR-SEC-01 | D-1 | server `getUser()` mock assertion |
| NFR-SEC-02 | D-1、§4 | auth以外のquery/mutation非呼出assert |
| NFR-SEC-03 | D-5、D-6 | example/runbook secret非記録contract |
| NFR-SEC-04 | §6 非影響 | MCP route/tool差分reviewと既存回帰 |
| NFR-A11Y-01 | D-3 | visible label / semantic link確認 |
| NFR-A11Y-02 | D-3 | 48px、keyboard、focus-visible確認 |
| NFR-RESP-01 | D-3 | 320px、200% zoom、長文のL3確認 |
| NFR-COMPAT-01 | §6 非影響 | login/signup/decks/AI/MCP差分review |
| NFR-RELIABILITY-01 | D-2 | factory fail-fast回帰 |
| NFR-DOC-01 | D-5、D-6 | package/sourceとの文書contract |
| AC-01〜AC-12 | §8.1 | 各EARS条件に対応するL1〜L3 |

### 8.1 受入条件（EARS）

- **AC-01（契機型）**: 認証ユーザーが存在しない状態で `/` が表示されたとき、システムは `/login` の「ログイン」と `/signup` の「新規登録」を表示し、「将来実装予定」と `/decks` のprimary actionを表示しないこと。
- **AC-02（契機型）**: 有効な認証ユーザーが存在する状態で `/` が表示されたとき、システムは `/decks` の「今日の学習をはじめる」を表示し、guest向け操作をprimary actionとして表示しないこと。
- **AC-03（遍在型）**: システムは `/` を公開ルートとして維持し、その表示判定でDB更新、service role、owner data取得を行わないこと。
- **AC-04（状態型）**: owner deckが0件の間、システムはempty説明、次操作説明、「新しいデッキ名」、および「デッキを作成」を同一画面に表示すること。
- **AC-05（状態型）**: owner deckが1件以上ある間、システムは既存一覧、学習状況、詳細リンク、作成formを表示し、0件説明を表示しないこと。
- **AC-06（遍在型）**: システムは対象6環境変数を `.env.local.example` に各1回だけ記載し、secret、token、実credential、実環境固有URLを記載しないこと。
- **AC-07（契機型）**: 開発者がlocal runbookに従ったとき、システムは `.env.local` の準備、`cd frontend && npm exec -- next dev`、`http://localhost:3000` の起動手順を再現可能にすること。
- **AC-08（遍在型）**: システムはrunbookに3 flagそれぞれの正確な有効条件・無効時挙動と、3 MCP URLの形式・用途を記載すること。
- **AC-09（不測型）**: もし `S10_TEST_DATABASE_URL` が未設定ならば、システムは `check` を成功扱いせず、安全な個別確認とDB suite未実行の報告方法をrunbookに示すこと。
- **AC-10（契機型）**: 実装と回帰testが完了したとき、システムは `lint` と `typecheck` をexit 0で完了すること。
- **AC-11（複合型）**: 320px幅またはkeyboard onlyで `/` とdeck 0件画面を操作するとき、システムは横スクロールを発生させず、意味の分かるaccessible nameと可視focusを持つ主要操作を提供すること。
- **AC-12（遍在型）**: システムはAIカード処理、SRS、MCP tool契約、DB schema、RLSの既存契約を変更しないこと。

## 9. Rollout / rollback

- migration、backfill、flag rolloutは不要。
- UI、example、runbook、テストを同一PRで変更する。
- rollbackは当該PRのrevertで完結し、DB rollbackは不要。
- 本Storyはproduction deployを含まない。

## 10. 未解決事項

なし。

- UIの文言、リンク先、認証エラー境界、env表現、runbook配置は本設計で確定した。
- `check` のDB env不足時のrunner変更は行わず、文書化に限定する。
- 実装計画は `--until design` の後続フェーズで作成する。

## 11. 参考資料

- [Next.js 14: Server Components](https://nextjs.org/docs/14/app/building-your-application/rendering/server-components) — cookie依存の動的Server Componentとserver-side data access
- [Supabase SSR Auth advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) — server-side session確認と `getUser()` の位置付け
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — 320 CSS px reflow、focus visible、link purpose、target size
- [ADR-001](specs/adr/ADR-001-project-foundation-supabase-clients.md) — client分離とenv fail-fast
- [ADR-003](specs/adr/ADR-003-authentication-flow.md) — 公開root、middleware、`auth.getUser()` 境界
- [ADR-011](specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md) — MCP URL、flag、fail-closed契約
