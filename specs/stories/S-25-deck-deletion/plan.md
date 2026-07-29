# 実行計画: 作成したデッキの論理削除

## Phase 1: DB tombstone / policy / active guard

- `supabase/migrations/20260728000000_s25_deck_delete.sql`
- `frontend/src/types/database.ts`
- `frontend/src/lib/deck/deck-delete-migration-contract.test.ts`

実装:

- `decks.deleted_at timestamptz` を追加する。
- active deck query 用 partial index を追加する。
- `decks` SELECT / UPDATE policy を owner + 未削除に更新する。
- authenticated へ `UPDATE(deleted_at)` を付与し、DELETE policy / grant は追加しない。
- `deck_cards` policy に親 deck 未削除条件を追加する。
- `deleted_at` 論理削除時の active session guard trigger を追加する。
- Database type に `deleted_at` を追加する。

検証:

```bash
npm --prefix frontend test -- src/lib/deck/deck-delete-migration-contract.test.ts
```

## Phase 2: `deleteDeck` Server Action

- `frontend/src/actions/deck-action-types.ts`
- `frontend/src/actions/deck-actions.ts`
- `frontend/src/actions/deck-actions.test.ts`

実装:

- `DeckDeleteActionState` と initial state を追加する。
- UUID形式の `deckId` validator を追加する。
- invalid / unauth / owner外 / 不存在 / 削除済みを安全に失敗させる。
- active session があれば論理削除しない。
- `update({ deleted_at })` を `id` + `owner_user_id` + `deleted_at IS NULL` で実行する。
- `P1007` と raw DB error を安全な UI state に写像する。
- 成功時に `/decks` を revalidate する。

検証:

```bash
npm --prefix frontend test -- src/actions/deck-actions.test.ts
```

## Phase 3: Read path filtering

- `frontend/src/actions/deck-actions.ts`
- `frontend/src/actions/session-actions.ts`
- `frontend/src/lib/deck/daily-study-status.ts`
- `frontend/app/api/ai/card-drafts/generate/route.ts`
- `frontend/src/actions/ai-card-management-actions.ts`
- `frontend/src/lib/mcp/services.ts`

実装:

- deck 一覧、詳細、学習メトリクス、学習開始、日次ステータス、AIカード生成/管理、MCP deck list で `deleted_at IS NULL` を要求する。

検証:

```bash
npm --prefix frontend test -- src/actions/deck-actions.test.ts src/actions/session-actions.test.ts src/lib/deck/daily-study-status.test.ts src/actions/ai-card-management-actions.test.ts src/lib/mcp/services.test.ts
```

## Phase 4: Deck row deletion UI

- `frontend/src/components/deck/DeleteDeckForm.tsx`
- `frontend/src/components/deck/DeckCard.tsx`
- `frontend/src/components/deck/DeckCard.test.tsx`
- `frontend/src/components/deck/DeleteDeckForm.test.tsx`
- `frontend/src/app/decks/page.test.tsx`

実装:

- `DeleteDeckForm` Client Component を追加する。
- confirm cancel、pending disabled、error alert、hidden deckId を実装する。
- `DeckCard` の詳細 link と削除 form を sibling にする。
- 既存の deck name、カード数、学習状態表示を維持する。

検証:

```bash
npm --prefix frontend test -- src/components/deck/DeckCard.test.tsx src/components/deck/DeleteDeckForm.test.tsx src/app/decks/page.test.tsx
```

## Phase 5: Final quality gate

```bash
npm --prefix frontend run check
npm --prefix frontend run build
git diff --check
git status --short
```

未実施の hosted DB / browser 検証があれば、完了報告に未検証理由を明記する。
