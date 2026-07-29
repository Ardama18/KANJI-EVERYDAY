# 要件定義書: 作成したデッキの論理削除

## 1. 方針

S-25 は、owner 本人が `/decks` から不要なデッキを削除できるようにする。削除は物理削除ではなく `decks.deleted_at` に時刻を入れる論理削除とし、通常の一覧・詳細・学習開始・選択肢取得から削除済みデッキを除外する。

デッキに紐づく `deck_cards`、`study_sessions`、`cards`、`review_states` は物理削除しない。未完了 `study_sessions.finished_at IS NULL` がある場合は、学習再開契約を壊さないため論理削除前に拒否する。

## 2. Must

- REQ-DB-01: `decks` に nullable `deleted_at timestamptz` を追加する。
- REQ-DB-02: `decks` の SELECT / UPDATE policy は owner かつ `deleted_at IS NULL` の行だけを通常対象にする。
- REQ-DB-03: authenticated role には `decks.deleted_at` の UPDATE 権限だけを明示し、`decks` DELETE policy / DELETE grant は追加しない。
- REQ-DB-04: `deck_cards` の owner deck 参照 policy は親 `decks.deleted_at IS NULL` を要求し、削除済み deck の membership を通常経路から隠す。
- REQ-DB-05: `deleted_at` を NULL から non-NULL に更新するとき、対象 deck に未完了 `study_sessions` が1件でもあれば DB trigger で拒否する。
- REQ-DB-06: DB trigger の拒否は raw session payload や他 owner 情報を返さず、アプリ側で安全な error に写像できる安定した SQLSTATE または message を持つ。
- REQ-DATA-01: deck 論理削除では `deck_cards`、`study_sessions`、`cards`、`review_states` を物理削除しない。
- REQ-TYPE-01: `frontend/src/types/database.ts` の `decks` Row / Insert / Update に `deleted_at` を反映する。
- REQ-ACTION-01: `deleteDeck(previousState, formData)` Server Action を `frontend/src/actions/deck-actions.ts` に追加する。
- REQ-ACTION-02: `deleteDeck` は副作用前に `deckId` を実行時検証し、空・非文字列・UUID形式でない値を安全な失敗として返す。
- REQ-ACTION-03: `deleteDeck` は副作用前に `auth.getUser()` を呼び、未認証なら DB DML を実行しない。
- REQ-ACTION-04: `deleteDeck` は論理削除前に `decks.id = deckId AND decks.owner_user_id = user.id AND decks.deleted_at IS NULL` で owner deck の存在を確認する。
- REQ-ACTION-05: 他 owner deck、不存在 deck、削除済み deck、不正 deckId は同じ安全な失敗メッセージにする。
- REQ-ACTION-06: owner deck 確認後、対象 deck の未完了 session を確認し、存在する場合は論理削除しない。
- REQ-ACTION-07: `deleteDeck` は `UPDATE decks SET deleted_at = now` 相当の query にも `id` / `owner_user_id` / `deleted_at IS NULL` を指定する。
- REQ-ACTION-08: 論理削除成功後は `revalidatePath("/decks")` を呼ぶ。
- REQ-ACTION-09: 成功時は success state、失敗時は raw Supabase error を含まない日本語 error state を返す。
- REQ-READ-01: `/decks` 一覧、deck 詳細、学習開始、日次ステータス、AIカード作成/管理、MCP deck 一覧は削除済み deck を対象外にする。
- REQ-UI-01: `/decks` の各 `DeckCard` に削除操作を表示する。
- REQ-UI-02: `DeckCard` は削除 button と詳細 link をネストせず、HTML の interactive element nesting を避ける。
- REQ-UI-03: 削除操作は送信前に確認 UI を表示し、キャンセル時は Server Action を呼ばない。
- REQ-UI-04: pending 中は削除 button を disabled / aria-disabled にし、二重送信を防ぐ。
- REQ-UI-05: 削除失敗時は対象 row 近傍に `role="alert"` で日本語エラーを表示する。
- REQ-UI-06: 削除操作は 320px 幅で横 scroll せず、主要 button は 48px 以上の touch target を持つ。
- REQ-TEST-01: action test は成功、未認証、不正 deckId、他 owner / 不存在 / 削除済み同一失敗、active session拒否、Supabase error安全化、`revalidatePath("/decks")` を検証する。
- REQ-TEST-02: component / page test は削除 UI、確認、pending disabled、error表示、詳細 link 維持、mobile で操作できる構造を検証する。
- REQ-TEST-03: migration contract test は `deleted_at`、UPDATE policy / grant、active session guard、物理削除しないことを検証する。

## 3. Won't

- WON'T-01: deck 削除時に `decks` row を物理削除しない。
- WON'T-02: deck 削除時に `deck_cards`、`study_sessions`、`cards`、`review_states` を物理削除しない。
- WON'T-03: 削除済み deck の undo / restore / trash は実装しない。
- WON'T-04: deck 削除を MCP tool として公開しない。
- WON'T-05: active session を自動完了・強制終了してから削除することはしない。

## 4. 受入条件対応

| AC | 要件 |
|---|---|
| AC-01 owner論理削除成功 | REQ-DB-01〜06, REQ-ACTION-01〜09 |
| AC-02 一覧から消える | REQ-READ-01, REQ-ACTION-08, REQ-UI-01 |
| AC-03 他owner/不存在/削除済み同一失敗 | REQ-ACTION-04〜05 |
| AC-04 未認証副作用なし | REQ-ACTION-03 |
| AC-05 不正deckId安全失敗 | REQ-ACTION-02, REQ-ACTION-05 |
| AC-06 関連データ保持 | REQ-DATA-01, WON'T-01〜02 |
| AC-07 active session拒否 | REQ-DB-05〜06, REQ-ACTION-06 |
| AC-08 確認/pending/mobile | REQ-UI-02〜06 |
| AC-09 安全なエラー | REQ-ACTION-09, REQ-UI-05 |
| AC-10 テスト | REQ-TEST-01〜03 |

## 5. 未解決事項

- Hosted Supabase の実 privilege / policy drift は実装 gate で確認する。未確認の場合は完了報告に明記する。
- 削除済み deck の復元や監査表示が必要になった場合は、別 story / ADR で扱う。
