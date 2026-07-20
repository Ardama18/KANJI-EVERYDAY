# 実行計画: 初回ユーザー向けデッキ作成導線とMCP create_deck

## Phase 1: Deck作成Actionとvalidation

- 対象要件: REQ-ACTION-01〜05, REQ-MCP-02, AC-01, AC-07, AC-08
- 対象ファイル:
  - `frontend/src/actions/deck-actions.ts`
  - `frontend/src/actions/deck-actions.test.ts`
- 実装内容:
  - `MAX_DECK_NAME_LENGTH`、共有deck name validator、action state型、initial stateを追加する。
  - `createDeck(previousState, formData)` を追加する。
  - 成功時は `decks` へ `{ owner_user_id: user.id, name }` をinsertし、`id,name` を返し、`revalidatePath("/decks")` を呼ぶ。
  - validation失敗、未認証、Supabase errorを安全なaction stateに変換する。
- 完了条件:
  - 空文字、空白のみ、81文字、制御文字でinsertされない。
  - 未認証でinsertされない。
  - 成功時にowner_user_idが認証user IDになり、`new_limit_per_day` を明示しない。
  - success stateに後続表示用の `deck.id` / `deck.name` がある。
- 検証:
  - `npm --prefix frontend test -- src/actions/deck-actions.test.ts`

## Phase 2: `/decks` 作成フォームUI

- 対象要件: REQ-UI-01〜03, NFR-UX-01, AC-01, AC-02, AC-08, AC-09
- 対象ファイル:
  - `frontend/src/components/deck/CreateDeckForm.tsx`
  - `frontend/app/(auth)/decks/page.tsx`
  - `frontend/src/app/decks/page.test.tsx`
  - 必要なら `frontend/src/components/deck/CreateDeckForm.test.tsx`
- 実装内容:
  - `useFormState` / `useFormStatus` を使うclient formを追加する。
  - `/decks` 見出し直下にフォームを配置し、empty stateと既存deck listの両方で表示する。
  - pending disabled、error `role="alert"`、success feedback、label / input / buttonのaccessible nameを実装する。
- 完了条件:
  - render testでデッキ0件時にもフォームが出る。
  - render testで既存デッキあり時もDeckCard表示が維持される。
  - submit buttonは48px以上相当の高さを持つ。
- 検証:
  - `npm --prefix frontend test -- src/app/decks/page.test.tsx`
  - component testを追加した場合: `npm --prefix frontend test -- src/components/deck/CreateDeckForm.test.tsx`
  - L3手動: `cd frontend && npm exec -- next dev` で `/decks` 0件/既存あり、320px/desktop、keyboard focus、validation errorを確認する。

## Phase 3: MCP `create_deck` tool

- 対象要件: REQ-MCP-01〜05, REQ-FLOW-01, NFR-SEC-01〜03, NFR-COMPAT-01, AC-03〜06
- 対象ファイル:
  - `frontend/src/lib/mcp/tools.ts`
  - `frontend/src/lib/mcp/services.ts`
  - `frontend/src/lib/mcp/tools.test.ts`
  - `frontend/src/lib/mcp/server.test.ts`
  - `frontend/src/lib/mcp/route-contract.test.ts`
  - `frontend/src/lib/mcp/real-db.int.test.ts`
- 実装内容:
  - `mcpToolInputSchemas.create_deck = z.object({ name: z.string() }).strict()` を追加し、共有validatorをdispatch後service内でも適用する。
  - `McpToolServices` に `createDeck` を追加する。
  - `MCP_TOOL_NAMES` とdescriptorへ `create_deck` を追加する。
  - `executeKnownTool` に `create_deck` branchを追加する。
  - `createMcpToolServices` でJWT actor user IDをpayloadへ固定して `decks` insertを行い、`{ deck: { id, name } }` を返す。
  - 既存service mock全箇所へ `createDeck` を追加する。
- 完了条件:
  - tools/listは9 toolを返し、全toolのsecuritySchemes/_metaが一致する。
  - `invokeMcpTool("create_deck", { name })` がserviceを呼び、未知fieldを拒否する。
  - MCP serviceはowner overrideを受け取らず、actor.userIdだけでinsertする。
  - `list_decks` はcreate後に同じownerのdeckを返す設計・テストになる。
- 検証:
  - `npm --prefix frontend test -- src/lib/mcp/tools.test.ts src/lib/mcp/server.test.ts src/lib/mcp/route-contract.test.ts`
  - 環境がある場合: `S14_TEST_DATABASE_URL=<isolated> npm --prefix frontend test -- src/lib/mcp/real-db.int.test.ts`

## Phase 4: Runbook更新

- 対象要件: REQ-DOC-01, REQ-FLOW-01, AC-06
- 対象ファイル:
  - `docs/runbooks/ai-card-import.md`
- 実装内容:
  - Claude/ChatGPT live-client gateの `list_decks` 後に、空なら `create_deck` を呼ぶ分岐を追加する。
  - `create_deck` で返った `deck.id` を `preview_card_import.request.deck.id` に使うことを明記する。
  - 証跡へsecret/token/card本文/raw promptを残さない既存redaction方針を維持する。
- 完了条件:
  - 初回ユーザーと既存deckありユーザーの両方の手順が読める。

## Phase 5: 全体品質確認

- 対象:
  - 変更全体
- コマンド:
  - `npm --prefix frontend run check`
  - `npm --prefix frontend run build`
- 追加確認:
  - `git diff --check`
  - DB migrationが追加されていないことを `git status --short supabase/migrations` で確認する。
  - L3 UI確認のURL、viewport、操作、結果、未接続境界を記録する。

## AC / 検証対応

| AC | 主な検証 |
|---|---|
| AC-01 | Phase 1 action test + Phase 2 UI L3 |
| AC-02 | Phase 2 render test + UI L3 |
| AC-03 | Phase 3 MCP service/real-db gate |
| AC-04 | Phase 3 create_deck service test |
| AC-05 | Phase 1未認証DML 0 + Phase 3 actor owner固定 + real-db RLS |
| AC-06 | Phase 3 real-db / live-client gate + Phase 4 runbook |
| AC-07 | Phase 1 validator test + Phase 3 schema/service validation |
| AC-08 | Phase 2 pending disabled + action behavior |
| AC-09 | Phase 2 existing deck render test + final check/build |

## 実装時の注意

- `tasks/` や個別task fileは作成しない。
- `supabase/migrations/` は変更しない。
- MCP tool数が8から9になるため、S-14由来の「exact eight」テスト文言をすべて更新する。
- service role clientをデッキ作成へ使わない。
- raw Supabase error、SQL、token、secret、card本文をUI/MCP result/logに出さない。
