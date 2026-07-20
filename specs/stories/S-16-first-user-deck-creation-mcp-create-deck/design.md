# 設計書: 初回ユーザー向けデッキ作成導線とMCP create_deck

## 1. 現行調査

- `frontend/app/(auth)/decks/page.tsx` は `getDecksWithCounts()` を呼ぶServer Componentで、デッキ0件時は `DECKS_EMPTY_MESSAGE` だけを表示する。
- `frontend/src/actions/deck-actions.ts` は `getDecksWithCounts()` と `getDeckOverview(deckId)` のread actionだけを持つ。どちらも `createServerClient()` と `auth.getUser()` を使い、deck readは `owner_user_id = userId` で絞る。
- `frontend/src/components/auth/*` と `frontend/src/components/oauth/*` は `useFormState` / `useFormStatus` を既に採用している。デッキ作成フォームもこの既存パターンへ合わせる。
- `frontend/src/lib/mcp/tools.ts` は tool名、Zod input schema、descriptor、dispatchを静的mapから生成している。未知toolや未知fieldはservice呼出し前に拒否される。
- `frontend/src/lib/mcp/services.ts` はJWT scoped Supabase clientとMCP actorを受け取り、`list_decks` は `.from("decks").select("id,name").order("name").order("id")` でRLSに委ねる。
- `frontend/src/lib/mcp/server.ts` と `route-handler.ts` は `MCP_TOOL_NAMES` を正本にしてtools/list、tools/call、unknown tool protocol errorを扱う。
- `supabase/migrations/20260223000000_s02_schema_rls.sql` の `decks` table は `id` default、`new_limit_per_day` default、`decks_insert_owner` policyを既に持つ。
- `frontend/src/types/database.ts` の `decks.Insert` も `id?` / `new_limit_per_day?` を許している。

## 2. Scope / Non-goal

S-16は既存 `decks` tableへの本人owner insertをUIとMCPに接続する。AIカード import、OAuth、MCP auth、preview/commit/status、queue/worker、card managementの意味は変更しない。

DB migrationは追加しない。既存schemaとRLSで、本人所有deck作成、default `new_limit_per_day=10`、作成済みdeckのRLS readを満たせるためである。DB levelのデッキ名一意制約や制御文字CHECKは将来の強化対象であり、本Storyではapplication boundaryで検証する。

## 3. 実装アプローチ

Hybrid approachを採用する。

1. 共有deck name validatorとServer Actionを先に固定する。
2. `/decks` UIを縦に接続する。
3. MCP allowlist/serviceへ同じ作成use caseを接続する。
4. runbookとテストでUI/MCP/flowを確認する。

## 4. デッキ名validation

`frontend/src/actions/deck-actions.ts` に近接して次の共有関数を置く。

- `MAX_DECK_NAME_LENGTH = 80`
- `normalizeDeckNameInput(value: unknown): { ok: true; name: string } | { ok: false; message: string }`
- `FormData.get("name")` とMCP `{ name }` のどちらもこの関数へ通す。
- `trim()` 後に空なら拒否する。
- `Array.from(trimmed).length > 80` なら拒否する。
- `/[\p{Cc}\p{Cf}]/u` に一致する制御文字・不可視制御文字は拒否する。
- 成功時はtrim済み文字列をDBへ保存する。

このStoryでは内部連続空白の圧縮や同名拒否を行わない。既存deck名との互換性とDB migrationなしのscopeを優先する。

## 5. Server Action / UI

### Action

`frontend/src/actions/deck-actions.ts` に次を追加する。

- `DeckActionState = { status: "idle" | "success" | "error"; message: string; deck?: { id: string; name: string } }`
- `DECK_ACTION_INITIAL_STATE`
- `createDeck(previousState, formData)`

処理順序:

```text
parse and validate name
  -> createServerClient()
  -> auth.getUser()
  -> insert decks { owner_user_id: user.id, name }
  -> select id,name via returning/select
  -> revalidatePath("/decks")
  -> return success state
```

未認証はredirectではなくaction error `ログインが必要です。` を返す。`getDecksWithCounts()` は既存どおり未認証で `/login` へredirectするため、保護ページ表示とform mutationの契約を分ける。

Supabase errorは安全な日本語メッセージに正規化し、raw SQL/error detailをUIへ出さない。

### UI

`frontend/src/components/deck/CreateDeckForm.tsx` を追加する。

- `"use client"`。
- `useFormState(createDeck, DECK_ACTION_INITIAL_STATE)` を使う。
- `useFormStatus` を使うsubmit buttonを内部に置き、pending中はdisabled、labelを `作成中...` にする。
- label付きtext input `name="name"`、`maxLength={80}`、`required`、`autoComplete="off"`。
- errorは `role="alert"`、successは作成したdeck名を短く表示する。
- 主要controlは `min-h-12` 以上。

`frontend/app/(auth)/decks/page.tsx` は `CreateDeckForm` を見出し直下に表示する。デッキ0件のempty messageは残し、フォームも同じ画面内に表示する。既存デッキあり時はフォームと一覧を共存させる。

## 6. MCP `create_deck`

### Tool contract

- name: `create_deck`
- input: `{ name: string }`
- output: `{ deck: { id: UUID; name: string } }`
- descriptor annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`
- security: 既存toolと同じ `oauth2` `openid email profile` を `securitySchemes` と `_meta.securitySchemes` に持つ。

`MCP_TOOL_NAMES` は次の順序にする。

```text
list_decks
create_deck
preview_card_import
commit_card_import
get_import_status
list_ai_cards
update_ai_card
delete_ai_cards
undo_import_batch
```

### Service

`McpToolServices` に `createDeck(input)` を追加する。`createMcpToolServices` は `createOwnerDeck(client, actor, input)` 相当の内部関数を呼ぶ。

処理順序:

```text
validate normalized name with shared validator
  -> client.from("decks").insert({ owner_user_id: actor.userId, name }).select("id,name").single()
  -> verify returned id/name are strings
  -> return { deck: { id, name } }
```

`owner_user_id` はtool inputから受け取らない。JWT scoped client + RLSに加え、insert payloadも `actor.userId` に固定する。RLSやDB errorは `SERVICE_UNAVAILABLE` またはvalidation errorへ安全に写像する。owner外deckの参照は行わない。

## 7. Data Flow

### UI

```text
User -> /decks Server Component
     -> CreateDeckForm (client)
     -> createDeck Server Action
     -> Supabase auth.getUser()
     -> INSERT public.decks(owner_user_id=user.id, name)
     -> revalidatePath("/decks")
     -> getDecksWithCounts()
     -> DeckCard list
```

### MCP

```text
ChatGPT -> /api/mcp tools/call create_deck
        -> route-handler authenticates Bearer JWT
        -> createJwtScopedClient(accessToken)
        -> createMcpToolServices(client, actor)
        -> INSERT public.decks(owner_user_id=actor.userId, name)
        -> { deck: { id, name } }
        -> preview_card_import({ request: { deck: { id } ... }})
        -> commit_card_import(...)
        -> get_import_status(...)
```

## 8. Security / Failure Handling

- service roleは使わない。
- UI actionとMCP serviceは、caller supplied owner/user/deck IDを作成時に受け取らない。
- RLSの `WITH CHECK (auth.uid() = owner_user_id)` とapplication-level `owner_user_id = actor/userId` の二重境界を維持する。
- 未認証UI mutationはinsert前に失敗する。
- MCP認証失敗は既存route-handlerのHTTP 401でtool dispatch前に止まる。
- MCP domain validation failureはtool result `isError` で返し、protocol errorにはしない。
- 予期しないSupabase errorは安全な汎用メッセージへ正規化する。

## 9. Impact Map

| 影響 | ファイル | 内容 |
|---|---|---|
| 直接 | `frontend/src/actions/deck-actions.ts` | validator、action state、create action |
| 直接 | `frontend/src/components/deck/CreateDeckForm.tsx` | 新規UI form |
| 直接 | `frontend/app/(auth)/decks/page.tsx` | 作成導線表示 |
| 直接 | `frontend/src/lib/mcp/tools.ts` | schema、allowlist、descriptor、dispatch |
| 直接 | `frontend/src/lib/mcp/services.ts` | MCP createDeck service |
| 直接 | `docs/runbooks/ai-card-import.md` | 初回deck作成手順 |
| テスト | `frontend/src/actions/deck-actions.test.ts` | validation/auth/insert/revalidate |
| テスト | `frontend/src/app/decks/page.test.tsx` | empty/existing両方のフォーム表示 |
| テスト | `frontend/src/components/deck/CreateDeckForm.test.tsx` | pending/error/success render source or component contract |
| テスト | `frontend/src/lib/mcp/tools.test.ts` | 9 tool allowlist、schema、dispatch |
| テスト | `frontend/src/lib/mcp/server.test.ts` | tools/list順序、create_deck call |
| テスト | `frontend/src/lib/mcp/route-contract.test.ts` | service mock shape更新 |
| テスト | `frontend/src/lib/mcp/real-db.int.test.ts` | 環境がある場合のowner create/list/preview flow |
| 非影響 | `supabase/migrations/*` | 既存schema/RLSで足りるため変更しない |

## 10. Test Strategy

| Requirement | L1/L2/L3 | 検証 |
|---|---|---|
| REQ-ACTION-01〜05 | L2 | deck action unit testで未認証DML 0、validation失敗insert 0、成功insert payload、revalidate |
| REQ-UI-01〜03 | L2/L3 | page render testでempty/existing表示、手動browserで作成後一覧 |
| REQ-MCP-01〜04 | L1/L2 | tools/server testsでallowlist/schema/descriptor/dispatch、service unit境界 |
| REQ-MCP-05 | L2/L3 | mocked serviceと、可能ならS-14 isolated DBでcreate後list |
| REQ-FLOW-01 | L3 | runbook手順、可能ならChatGPT live-client gate |
| NFR-SEC-01〜03 | L2/L3 | unit DML 0、MCP route auth境界、isolated DB RLS |

必須自動コマンド:

```bash
npm --prefix frontend run check
npm --prefix frontend run build
```

対象絞り込み:

```bash
npm --prefix frontend test -- src/actions/deck-actions.test.ts src/app/decks/page.test.tsx src/lib/mcp/tools.test.ts src/lib/mcp/server.test.ts src/lib/mcp/route-contract.test.ts
```

UI L3確認は `frontend/` で `npm exec -- next dev` を起動し、ログイン済みtest userで `/decks` の0件/既存ありを確認する。Playwright scriptは存在しないため計画に含めない。

## 11. Rollback / Forward-fix

- code rollbackでUI作成導線とMCP `create_deck` は消えるが、作成済みdeck rowは通常の本人所有データとして残る。
- DB migrationがないためschema rollbackは不要。
- `MCP_ENABLED=false` によりRemote MCP endpoint/tool dispatchは既存どおり停止できる。
- デッキ名validationが厳しすぎる場合はapplication validatorのforward-fixで緩和する。

## 12. Unresolved Questions

- 完全冪等な `create_deck` をMCPに提供する場合、将来 `idempotencyKey` をinputへ追加するか、DB unique制約を設計する必要がある。S-16ではscope外とし、pending disabledと許容可能なUXで扱う。
