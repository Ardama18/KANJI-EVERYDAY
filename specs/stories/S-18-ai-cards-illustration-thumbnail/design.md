# S-18 設計: AIカード管理画面のイラストサムネイル表示

対象 issue: #61。要件は `requirements.md`、受入条件は `story.md` の AC-1〜AC-6。

## 0. 全体像

```text
Server Component  frontend/app/(auth)/ai/cards/page.tsx
  └─ getAiCardListAction (use server)                       ... 認証・feature flag
       ├─ listAiCards(repository, input)                    ... 既存: RPC 呼び出し + 契約検証
       │    └─ list_ai_managed_cards RPC (SECURITY DEFINER) ... 既存: owner-scope・illustration {id,status}
       └─ attachIllustrationUrls(page, deps)                ... 新規: server 専用の付加処理
            ├─ fetchReadyIllustrationPaths(ids)            ... 新規: owner-scope 二次クエリ (1 回)
            └─ getSignedUrl(path, 3600)                    ... 既存: service-role で署名
Client Component  AiCardManagementClient
  └─ AiCardIllustrationThumbnail(url, altText, status)      ... 新規: next/image or 従来文言

Remote MCP  list_ai_cards → listAiCards(...)               ... 変更なし（url は常に null）
```

**不変条件**: 署名 URL の生成は `getAiCardListAction`（`"use server"`）配下のみ。
`listAiCards`（service 層）は Remote MCP と共有のため一切触らない。

## D1. `storage_path` 取得経路 → **（b）Server Action 内の owner-scope 二次クエリを採用**

| 観点 | (a) `list_ai_managed_cards` RPC を拡張 | (b) Server Action で二次クエリ **採用** |
|---|---|---|
| owner 分離 | 既存 `actor_id` 条件で担保（同等） | 認証 + `.eq("owner_user_id", userId)` + RLS の三層 |
| 変更範囲 | 新 migration（`CREATE OR REPLACE FUNCTION` + `ALTER FUNCTION ... OWNER TO s10_migration_owner` + REVOKE/GRANT 再指定）、`database.ts` 型、`migration-contract.test.ts` | TypeScript 4 ファイル。migration・権限変更 **なし** |
| Remote MCP への影響 | **`storage_path` が MCP ツール `list_ai_cards` の出力へ載る**（service 層共有・外部契約の破壊とデータ露出） | なし（service 層に触らない） |
| N+1 | 追加クエリ 0 | ページあたり **1 クエリ**（`.in("id", ids)`）＝ N+1 にならない |
| 契約テストへの影響 | 既存 SQL 契約テストの再検証が必要 | 影響なし |
| 運用 | migration = `.claude/steering/implementation-flow.md` §7 の必須停止ポイント（remote 適用判断が発生） | 停止ポイントに触れない |

**決定理由（決定打）**: (a) は `listAiCards` service が Remote MCP ツールと共有されているため、
RPC の返却形に `storage_path` を足すと **外部 MCP クライアントへ Storage の内部パスが露出**する。
これは AC-3/AC-5 に直接反する。加えて (a) は migration/権限の変更を伴い、
(b) と比べて owner 分離の強度が上がらない。よって (b) を採用する。

### (b) の実装仕様

`frontend/src/lib/ai-card-management/illustration-urls.ts`（**server 専用ヘルパー・新規**）

```ts
export type ReadyIllustrationPathLoader =
  (illustrationIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;   // id -> storage_path
export type SignIllustrationUrl =
  (storagePath: string) => Promise<string | null>;

export async function attachIllustrationUrls(
  page: AiCardListPage,
  deps: { loadPaths: ReadyIllustrationPathLoader; sign: SignIllustrationUrl }
): Promise<AiCardListPage>
```

1. `page.items` から `illustration !== null && illustration.status === "ready"` の
   `illustration.id` を **重複排除**して集める。0 件なら `page` をそのまま返す（クエリも署名もしない）。
2. `deps.loadPaths(ids)` で `id -> storage_path` を取得。
3. `storage_path` を **ユニーク化**して `deps.sign` を `Promise.all` で並列実行し
   `storage_path -> signedUrl | null` を作る（同一 `illustration_key` を共有する複数カードで
   署名 1 回に集約。ページ内の同一パスを二重に署名しない）。
4. `items` を写像し、対応 URL があるカードだけ `illustration.url` を差し替える。
   それ以外は `url: null` を維持する。`nextCursor` は不変。
5. `loadPaths` / `sign` が throw した場合は **catch して元の `page` をそのまま返す**
   （一覧自体を失敗させない = AC-4）。

Loader 実装（`ai-card-management-actions.ts` 内、`boundary.supabase` = cookie/RLS クライアント）:

```ts
const { data, error } = await supabase
  .from("illustrations")
  .select("id, storage_path")
  .in("id", [...ids])                    // ページ内 ready の id のみ
  .eq("owner_user_id", userId)           // 明示 owner 条件（RLS と二重）
  .eq("status", "ready")                 // RPC の status が古くても ready 以外は返さない
  .not("storage_path", "is", null);
```

- `error` は握りつぶさず `url` 無しへ縮退（AC-4）。ログに `storage_path` を出さない。
- `.in()` の要素数はページ最大件数（`limit` 上限 100）で自然に上限化される。
- `illustrations` に他 owner の行が混ざる余地は、明示条件 + RLS で二重に閉じる。

## D2. 署名 URL 生成

- **場所**: `getAiCardListAction`（`"use server"`）内。`getSignedUrl`（`@/lib/illustration/storage`）を
  そのまま再利用する。`getSignedUrl` は内部で `createServiceRoleClient()` を使うため、
  この経路以外（service 層・client component）からは呼ばない。
  → `SUPABASE_SERVICE_ROLE_KEY` はブラウザへ出ない（server-only secret 境界を維持）。
- **expiry**: `3600` 秒。学習画面（`session-actions.ts` の
  `ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS`）と同値を、本 Story 用の定数
  `AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS = 3600` として
  `illustration-urls.ts` に置く（S-09 の定数を跨いで import しない）。
- **バッチ**: ユニーク `storage_path` 単位で `Promise.all`。既定 20・最悪 100 並列。
  `storage.createSignedUrls`（複数形）への集約は行わない
  — `storage.ts` の手書き `StorageClient` 型と既存テストの表面を広げないため。
  1 ページ ≤100 件では往復コストが支配的でないと判断する（follow-up 余地として記録）。
- **owner 分離**: 署名対象パスは D1 の owner-scope クエリが返したものだけ。
  `buildIllustrationStoragePath` は `${ownerUserId}/${illustrationId}.png` なので、
  他 owner のパスは構造上も混入しない。
- **キャッシュ**: 一覧 action は `noStore()` 済み。署名 URL を DB・Next キャッシュへ保存しない。

## D3. 型拡張

`frontend/src/lib/ai-card-management/types.ts`

```ts
export interface AiCardIllustration {
  readonly id: string;
  readonly status: string;
  readonly url: string | null;   // 追加: ready かつ owner 一致かつ署名成功時のみ非 null
}
```

- **必須フィールド（optional にしない）**。省略可にすると「付け忘れ = undefined」が
  型で検出できず、UI 側で `url` の有無が曖昧になる。必須にすることで
  `parseManagedAiCards` に明示的な既定値（`null`）を強制する。
- `frontend/src/lib/ai-card-management/validation.ts` の `parseManagedAiCards` は
  **常に `url: null`** を入れる（RPC 由来の値は信用も参照もしない = default-deny）。
  DB が将来 `url` を返しても無視する。
- 影響: Remote MCP ツール `list_ai_cards` の出力に `"url": null` が加わる（additive・値は常に null）。
  `storage_path` も署名 URL も MCP へは出ない。MCP 側に出力スキーマ検証はないため契約は壊れない。
- 影響: `AiCardManagementClient.test.tsx` の `illustration: { id, status }` リテラルに
  `url: null` を追加する（同一変更内で修正）。
- `AiCardManagementOptions.illustrations`（設定ドロップダウン用）は**変更しない**（Out of Scope）。

## D4. UI

新規 `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.tsx`（`"use client"`）

```tsx
type Props = { readonly illustration: AiCardIllustration | null; readonly altText: string };
```

描画規則:

| 状態 | 描画 |
|---|---|
| `illustration === null` | 従来文言 `イラスト: なし` |
| `status !== "ready"` | 従来文言 `イラスト: なし`（既存の表示規則をそのまま維持） |
| `status === "ready"` かつ `url === null` | 従来文言 `イラスト: 設定済み`（画像なし・レイアウト非破壊） |
| `status === "ready"` かつ `url !== null` | `イラスト: 設定済み` + `next/image` サムネイル |
| 画像 `onError`（署名失効・404） | `useState` で当該 url を失敗記録し、サムネイルを消して文言のみへ縮退 |

- `next/image`: `width={96} height={96}`、`sizes="96px"`、`loading="lazy"`、
  `className="h-24 w-24 rounded-lg border border-slate-200 object-cover"`、
  `alt={altText}`（= `card.frontText`。`alt` に ID や URL を入れない）。
  `next.config.mjs` の `remotePatterns`（`*.supabase.co/storage/v1/object/sign/**`）に一致する。
- `data-testid="ai-card-illustration-thumbnail"` を付け、テストで描画有無を判定する。
- **レイアウト非破壊**: 既存 `<p className="mt-1 text-xs text-slate-500">イラスト: ...</p>` の
  文言行はそのまま残し、サムネイルはその直下に**追加**する
  （`mt-2` のブロック要素。既存の flex/grid 構造・チェックボックス列・`<details>` を触らない）。
  未 ready のカードはサムネイル要素自体を出さないので、従来の高さのまま。
- **`managedCardSyncKey` に `url` を含めない**（要件 §2-6）。
  署名 URL は毎回変わるため、含めると編集フォームが毎回 remount され入力が消える。
  この不変条件は client テストで固定する。
- 署名失効時も `AiCardManagementClient` の state（`cards` / `filters` / `selected`）と
  各 action 呼び出しには一切影響しない → 検索・編集・削除・イラスト設定は継続動作（AC-4）。

## D5. Server/Client 境界と権限まとめ

| レイヤ | 役割 | secret / 権限 |
|---|---|---|
| `page.tsx`（Server Component） | 認証確認・初期ページ取得 | cookie client のみ |
| `ai-card-management-actions.ts`（`"use server"`） | feature flag → 認証 → 一覧 → **署名付与** | service-role は `getSignedUrl` 内部でのみ |
| `illustration-urls.ts`（server 専用・DI） | 付加ロジック（純粋・依存注入） | secret 直参照なし |
| `service.ts` / `validation.ts` | RPC 契約検証（MCP 共有） | 変更は `url: null` 既定のみ |
| `AiCardManagementClient` / `AiCardIllustrationThumbnail`（`"use client"`） | 署名 URL 文字列の描画のみ | secret・`storage_path` を受け取らない |

- `illustration-urls.ts` に `import "server-only"` は**付けない**
  （メモリ済みの既知事項: 当リポジトリでは Vitest が壊れる）。
  代わりに依存注入で純粋化し、service-role へ触るのは呼び出し元の action だけにする。
- 認証・所有権・RLS の三層分離を維持。`storage_path` は server プロセス外へ出ない。

## D6. migration / RPC / 権限

**不要**。schema・migration・RLS policy・Storage policy・Auth 境界の変更はない。
既存の `illustrations_select_owner`（SELECT / `auth.uid() = owner_user_id`）で二次クエリが成立する。
→ `.claude/steering/implementation-flow.md` §7 の必須停止ポイントに該当しない。

## D7. 既知の限界（本 Story では変更しない）

- `list_ai_managed_cards` は同一 `illustration_key` に複数行あるとき `ORDER BY id LIMIT 1` で
  1 件を選ぶ。ready な別行があっても RPC が選んだ行が未 ready なら文言表示になる（既存挙動）。
- 追加読込で積み上げた古いページの署名 URL は 1 時間で失効する。
  失効後は `onError` で文言へ縮退し、再検索・再読込で再署名される。
- 署名は毎回発行のためリクエストごとに Storage API 呼び出しが増える（既定 20 件/ページ）。
