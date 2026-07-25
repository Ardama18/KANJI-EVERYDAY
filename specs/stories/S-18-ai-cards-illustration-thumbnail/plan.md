# S-18 作業計画書: AIカード管理画面のイラストサムネイル表示

設計の正本は `design.md`。受入条件は `story.md` の AC-1〜AC-6。本ファイルを実装の単一情報源とする。
`tasks/` や個別 task ファイルは生成・参照・更新しない。

## 前提（実装前に必ず確認）

- ブランチ: `issue/61-ai-cards-illustration-display`（worktree で作業中）
- migration・RLS・Storage policy・Auth 境界の変更は **不要**（`design.md` D6）。
  もし実装中に migration が必要と判断したら、実装を止めてユーザーへエスカレーションする。
- `frontend/src/lib/ai-card-management/service.ts` と `app-ai-repository.ts` は
  **Remote MCP と共有のため変更しない**（署名 URL を MCP へ流出させない / `design.md` D1）。
- `import "server-only"` は使わない（Vitest が壊れる既知事項）。依存注入で server 専用性を保つ。

## Phase 1: 型と契約の既定値（default-deny）

### T1-1 `AiCardIllustration` に `url` を追加
- ファイル: `frontend/src/lib/ai-card-management/types.ts`
- `AiCardIllustration` に `readonly url: string | null;` を追加（**必須フィールド**）。
- `AiCardManagementOptions.illustrations` は変更しない。

### T1-2 RPC 契約パーサの既定値を `null` に固定
- ファイル: `frontend/src/lib/ai-card-management/validation.ts`
- `parseManagedAiCards` の `illustration` 構築を
  `{ id, status, url: null }` にする（RPC 由来の `url` は検証も採用もしない = default-deny）。
- 既存の `Invalid illustration contract` 判定条件は変えない。

### T1-3 既存テストの型追随
- ファイル: `frontend/src/components/ai-card-management/AiCardManagementClient.test.tsx`
- `illustration: { id: BATCH_ID, status: "ready" }` に `url: null` を追加。
- 他に `AiCardIllustration` リテラルを持つ箇所があれば同様に更新
  （`rg -n "illustration: \{" frontend/src` で確認）。

**完了条件**: `npm --prefix frontend run typecheck` が通る。

## Phase 2: server 専用の署名付与ヘルパー（新規）

### T2-1 `illustration-urls.ts` を新規作成
- ファイル: `frontend/src/lib/ai-card-management/illustration-urls.ts`（新規）
- 公開 API（`design.md` D1 の仕様どおり）:
  - `export const AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS = 3600;`
  - `export type ReadyIllustrationPathLoader = (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;`
  - `export type SignIllustrationUrl = (storagePath: string) => Promise<string | null>;`
  - `export async function attachIllustrationUrls(page: AiCardListPage, deps: { loadPaths; sign }): Promise<AiCardListPage>`
- 処理順序:
  1. `items` から `illustration?.status === "ready"` の `illustration.id` を重複排除して収集。
  2. **0 件なら `page` を即返す**（クエリ・署名を一切行わない）。
  3. `loadPaths(ids)` → `id -> storage_path`。
  4. `storage_path` をユニーク化 → `Promise.all(sign)` → `path -> url | null`。
  5. `items` を写像し、`url` が得られたカードのみ `illustration.url` を差し替え。他は `null` 維持。
     `nextCursor` は不変。`readonly` 構造を壊さない（新しいオブジェクトを返す）。
  6. 全体を `try/catch` し、例外時は元の `page` を返す（一覧を失敗させない）。
- `storage_path` を戻り値・例外メッセージ・ログへ含めない。

### T2-2 単体テストを追加
- ファイル: `frontend/src/lib/ai-card-management/illustration-urls.test.ts`（新規）
- ケース（AC-1/3/4 に対応）:
  1. `status='ready'` かつ path あり・署名成功 → 当該カードの `illustration.url` が署名 URL になる。
  2. `status` が `pending`/`failed` のカードは `url: null` のまま、**`loadPaths` に id が渡らない**。
  3. `loadPaths` が id を返さない（他 owner / `storage_path` NULL 相当） → `url: null`。
  4. `sign` が `null` を返す（署名失敗・失効相当） → `url: null` かつ `items` の件数・順序・
     `nextCursor` が不変。
  5. 同一 `illustration.id` を共有する 2 枚のカード → `loadPaths` 1 回・`sign` 1 回（重複排除）。
  6. ready が 0 件 → `loadPaths` と `sign` が呼ばれない。
  7. `loadPaths` が throw → 元の `page` がそのまま返る（例外を投げない）。
  8. 異なる `illustration.id` が同一 `storage_path` を共有 → `sign` 1 回（path 単位の重複排除）。

**完了条件**: 追加テストが pass。`vitest` 実行に Supabase 接続を必要としない（全て DI モック）。

## Phase 3: Server Action への配線

### T3-1 `getAiCardListAction` に署名付与を追加
- ファイル: `frontend/src/actions/ai-card-management-actions.ts`
- `listAiCards(...)` の結果が `ok` のときだけ `attachIllustrationUrls` を適用する。
  `ok: false` はそのまま返す（既存 error contract 不変）。
- `loadPaths` 実装（`boundary.supabase` = cookie/RLS クライアント、`boundary.userId` を使用）:
  ```ts
  const { data, error } = await supabase
    .from("illustrations")
    .select("id, storage_path")
    .in("id", [...ids])
    .eq("owner_user_id", userId)
    .eq("status", "ready")
    .not("storage_path", "is", null);
  ```
  `error` または `data == null` のときは **空 Map** を返す（url なしへ縮退）。
  `storage_path` が falsy な行は Map に入れない。
- `sign` 実装: `(path) => getSignedUrl(path, AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS)`
  （`@/lib/illustration/storage` の既存関数をそのまま再利用）。
- `"use server"` ファイルの制約を守る: 新しい `export const`（非 async）を追加しない
  （`server-action-boundary.test.ts` が検出する）。ヘルパーは
  モジュール内の非 export 関数、または `illustration-urls.ts` 側へ置く。
- `getAiCardManagementOptionsAction` と各 mutation action は変更しない。

### T3-2 action テストを追加
- ファイル: `frontend/src/actions/ai-card-management-actions.test.ts`
- 既存の `createServerClientMock` 方式を踏襲し、`@/lib/illustration/storage` を
  `vi.mock`（`getSignedUrl`）する。
- ケース（AC-1/3/4/6 に対応）:
  1. RPC が `illustration: { id, status: 'ready' }` を返し、`illustrations` クエリが
     `storage_path` を返す → 結果の `illustration.url` が署名 URL になり、
     `getSignedUrl` が `(path, 3600)` で呼ばれる。
  2. `illustrations` クエリのフィルタに `owner_user_id`（= 認証ユーザー id）と
     `status='ready'` が渡っていることを検証（owner 分離の明示条件・AC-3）。
  3. `illustrations` クエリが error を返す → `ok: true` のまま `url: null`
     （一覧・管理機能が継続する = AC-4）。
  4. `getSignedUrl` が `null` → `url: null` かつ `ok: true`。
  5. ready が 0 件 → `from("illustrations")` が呼ばれない（余計なクエリを出さない）。
  6. 返却 JSON に `storage_path` を含むキーが存在しないこと（AC-3 の漏洩防止を明示検証）。
- feature flag / 認証 / error mapping の既存テストは壊さない。

**完了条件**: 追加・既存テストが pass。`storage_path` がクライアント返却値に出ないことがテストで固定される。

## Phase 4: UI（サムネイル描画）

### T4-1 `AiCardIllustrationThumbnail` を新規作成
- ファイル: `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.tsx`（新規・`"use client"`）
- Props: `{ readonly illustration: AiCardIllustration | null; readonly altText: string }`
- 描画規則は `design.md` D4 の表に従う。
  - 文言行 `イラスト: {ready ? "設定済み" : "なし"}` を**このコンポーネント内に移設**し、
    既存の文言・クラス（`mt-1 text-xs text-slate-500`）を 1 文字も変えない。
  - ready かつ `url !== null` のときのみ `next/image` を追加描画
    （`width={96} height={96} sizes="96px" loading="lazy"`、
    `className="mt-2 h-24 w-24 rounded-lg border border-slate-200 object-cover"`、
    `alt={altText}`、`data-testid="ai-card-illustration-thumbnail"`）。
  - `onError` で `useState` に失敗 url を保持し、以後サムネイルを描画しない（文言のみへ縮退）。
- `alt` に ID・URL・`storage_path` を入れない。

### T4-2 `AiCardManagementClient` から利用
- ファイル: `frontend/src/components/ai-card-management/AiCardManagementClient.tsx`
- 359 行付近の `<p>イラスト: ...</p>` を
  `<AiCardIllustrationThumbnail illustration={card.illustration} altText={card.frontText} />` に置換。
- **`managedCardSyncKey` に `url` を追加しない**（`design.md` D4 の不変条件）。
- チェックボックス列・`<details>` 内の編集/削除/イラスト設定フォーム・
  追加読込ボタンには一切触らない。

### T4-3 client テストを追加
- ファイル: `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.test.tsx`（新規）
- `IllustrationDisplay.test.tsx` と同様に `vi.mock("next/image", ...)` する
  （`renderToStaticMarkup` 下で画像最適化設定に依存しないため）。
- ケース（AC-1/2/4）:
  1. ready + url → `data-testid="ai-card-illustration-thumbnail"` が出力され、
     `src` が署名 URL、`alt` が `frontText`。
  2. ready + `url: null` → 画像要素なし・`イラスト: 設定済み` の文言のみ。
  3. `illustration: null` / `status: 'pending'` → `イラスト: なし` の文言のみ・画像要素なし。
- ファイル: `frontend/src/components/ai-card-management/AiCardManagementClient.test.tsx`（更新）
- ケース（AC-2/5）:
  4. `managedCardSyncKey` が `url` 変化で**変わらない**ことを明示検証（remount 回帰防止）。
  5. 一覧レンダリングで、ready+url のカードに画像が出て、未 ready のカードには出ず、
     既存の文言・編集フォーム・削除ボタン・追加読込ボタンが従来どおり出力される
     （レイアウト非破壊の回帰ガード）。

**完了条件**: 追加・既存の component テストが pass。

## Phase 5: 品質ゲート

1. `npm --prefix frontend run check`（lint → typecheck → vitest）
   - 既知事項: `*.int.test.ts`（S-10 系 3 ファイル）は `S10_TEST_DATABASE_URL` 未設定環境で
     env 由来の失敗になる。**これは本変更の回帰ではない**。実行結果に切り分けを明記する。
     可能なら `S10_TEST_DATABASE_URL` を設定して owner 分離の int 検証も行う（任意・AC 必須ではない）。
2. `npm --prefix frontend run build`
   - `next/image` の `remotePatterns` と Server/Client 境界に触るため実行する。
3. UI 実機確認（`frontend` で dev server 起動 → `/ai/cards`）
   - desktop / mobile 幅で、ready カードにサムネイルが出て未 ready カードでレイアウトが崩れないこと。
   - 実行 URL（既定 `http://localhost:3000`）を検証結果に記録する。
   - ローカル Supabase を使う場合、`next.config.mjs` の `remotePatterns` は
     `*.supabase.co` のみなので localhost 署名 URL は `next/image` が拒否する。
     その場合は remote Supabase 環境で確認し、事実を報告に残す（config は変更しない）。
4. `git diff` / `git status` で変更範囲を確認（想定 11 ファイル・migration なし）。

## 変更ファイル一覧（想定）

| # | ファイル | 種別 |
|---|---|---|
| 1 | `frontend/src/lib/ai-card-management/types.ts` | 変更 |
| 2 | `frontend/src/lib/ai-card-management/validation.ts` | 変更 |
| 3 | `frontend/src/lib/ai-card-management/illustration-urls.ts` | 新規 |
| 4 | `frontend/src/lib/ai-card-management/illustration-urls.test.ts` | 新規 |
| 5 | `frontend/src/actions/ai-card-management-actions.ts` | 変更 |
| 6 | `frontend/src/actions/ai-card-management-actions.test.ts` | 変更 |
| 7 | `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.tsx` | 新規 |
| 8 | `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.test.tsx` | 新規 |
| 9 | `frontend/src/components/ai-card-management/AiCardManagementClient.tsx` | 変更 |
| 10 | `frontend/src/components/ai-card-management/AiCardManagementClient.test.tsx` | 変更 |
| 11 | `frontend/src/lib/ai-card-management/management.test.ts` | 変更 |

**触らないファイル**: `supabase/migrations/**`、`frontend/src/lib/ai-card-management/service.ts`、
`app-ai-repository.ts`、`remote-mcp-repository.ts`、`frontend/src/lib/mcp/**`、
`frontend/next.config.mjs`、`frontend/src/lib/illustration/storage.ts`。

## 受入条件とテストの対応

| AC | 検証 |
|---|---|
| AC-1 ready にサムネイル | `illustration-urls.test.ts` (1)、`ai-card-management-actions.test.ts` (1)、`AiCardIllustrationThumbnail.test.tsx` (1) |
| AC-2 未設定/未 ready は従来どおり・レイアウト非破壊 | `illustration-urls.test.ts` (2)(6)、`AiCardIllustrationThumbnail.test.tsx` (2)(3)、`AiCardManagementClient.test.tsx` (5) + 実機確認 |
| AC-3 owner のみ・`storage_path` 非漏洩 | `ai-card-management-actions.test.ts` (2)(6)、`illustration-urls.test.ts` (3)、`management.test.ts`（parser の default-deny 回帰）、RLS `illustrations_select_owner`（既存） |
| AC-4 サーバ署名・期限付き・失効時も管理継続 | `ai-card-management-actions.test.ts` (1 の 3600 検証)(3)(4)、`illustration-urls.test.ts` (4)(7)(8)、`AiCardIllustrationThumbnail.test.tsx` (2) |
| AC-5 既存機能に回帰なし・MCP 出力に URL を出さない | 既存 action/service/MCP テスト全 pass（service 層無変更）、`management.test.ts`（共有 parser が常に `url: null`）、`AiCardManagementClient.test.tsx` (4)(5) |
| AC-6 `check` 通過 | Phase 5-1 |

## 停止・エスカレーション条件

- migration・RLS・Storage policy の変更が必要と判明したとき。
- `list_ai_managed_cards` RPC / service 層 / MCP 契約を変えないと実現できないと判明したとき。
- 同一観点の code-reviewer 指摘が 3 回未解消のとき。
- `next/image` の `remotePatterns` 変更（= config 変更）が必要と判明したとき。
