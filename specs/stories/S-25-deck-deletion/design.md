# 設計書: 作成したデッキの論理削除

## 1. 選択したアプローチ

`decks.deleted_at` を tombstone とする論理削除で実装する。Server Action は owner / active session を事前確認した上で `deleted_at` を更新し、RLS と DB trigger が最終境界を担う。

物理 DELETE は許可しない。`deck_cards`、`study_sessions`、`cards`、`review_states` は保持し、削除済み deck は通常の読み取り経路から除外する。

## 2. Data / RLS design

新規 migration `supabase/migrations/20260728000000_s25_deck_delete.sql` を追加する。

- `ALTER TABLE public.decks ADD COLUMN deleted_at timestamptz`
- active deck query 用に `owner_user_id, created_at, id WHERE deleted_at IS NULL` の index を追加する。
- `decks_select_owner` は `auth.uid() = owner_user_id AND deleted_at IS NULL` に変更する。
- `decks_update_owner` は old row が owner かつ未削除の場合だけ許可し、`WITH CHECK` は owner 境界を維持する。これにより owner は `deleted_at` を non-NULL にできるが、削除済み row は通常更新できない。
- authenticated へは `UPDATE (deleted_at)` の列権限を明示し、DELETE grant / DELETE policy は追加しない。
- `deck_cards` の SELECT / INSERT / UPDATE policy は親 `decks.deleted_at IS NULL` を要求する。
- `guard_deck_logical_delete_active_session()` は `BEFORE UPDATE OF deleted_at ON public.decks` で動作し、NULL から non-NULL へ変わるときに未完了 `study_sessions` があれば SQLSTATE `P1007` で拒否する。

## 3. Server Action design

`frontend/src/actions/deck-action-types.ts` に `DeckDeleteActionState` と `DECK_DELETE_ACTION_INITIAL_STATE` を追加する。

`deleteDeck(previousState, formData)` の処理順序:

```text
parse deckId
  -> validate UUID
  -> createServerClient()
  -> auth.getUser()
  -> select decks id by id + owner_user_id + deleted_at is null
  -> if missing return generic failure
  -> select active study_sessions id by user_id + deck_id + finished_at is null limit 1
  -> if active return active-session safe failure
  -> update decks set deleted_at = current ISO timestamp by id + owner_user_id + deleted_at is null
  -> map P1007 / no row / other errors to safe messages
  -> revalidatePath("/decks")
  -> success state
```

メッセージ:

- 未認証: `ログインが必要です。`
- 他 owner / 不存在 / 削除済み / 不正 ID: `デッキを削除できませんでした。時間をおいて再度お試しください。`
- active session: `学習中のデッキは削除できません。学習を終えてからもう一度お試しください。`
- success: `デッキを削除しました。`

## 4. Read Path design

削除済み deck を通常 UI / API から見せないため、以下の deck query に `deleted_at IS NULL` を加える。

- `getDecksWithCounts`
- `getDeckOverview`
- `getDeckLearningMetrics`
- `updateDeckStudyLimit`
- `requireOwnedDeck` in `session-actions.ts`
- `getDailyStudyStatus`
- AIカード生成 route の deck owner check
- AIカード管理 options の deck list
- MCP `list_decks`

## 5. UI design

`DeckCard` は詳細 `Link` と `DeleteDeckForm` を sibling にする。

`DeleteDeckForm` は Client Component とし、`useFormState(deleteDeck, DECK_DELETE_ACTION_INITIAL_STATE)`、`useFormStatus()`、hidden `deckId`、`window.confirm`、pending disabled、`role="alert"` を持つ。

mobile は縦積み、desktop は横並びにし、削除 button は `h-12` 以上にする。

## 6. Test strategy

- migration contract: `deleted_at`、UPDATE policy / grant、active trigger、物理削除しないこと、Database type。
- action test: invalid、unauth DML 0、owner success、missing/other/deleted同一失敗、active session、P1007、安全な error。
- component/page test: 削除 UI、詳細 link維持、nested interactive 回避、pending / alert / confirm contract。
- final gate: `npm --prefix frontend run check`、`npm --prefix frontend run build`、`git diff --check`。

## 7. Unresolved risks

- Hosted Supabase の migration owner / grants / policy drift は未確認の場合、完了報告に残す。
- 復元 UI や削除済み deck の監査表示は別 story の対象。
