# 要件定義書: 学習状態を持つデッキの安全な論理削除

## 1. 方針

S-29 は S-25 の後続として、deck 削除の安全確認を強化し、owner 本人が復習状態や学習履歴を持つ deck でも削除できるようにする。削除方式は S-25 で導入済みの `decks.deleted_at` による論理削除を維持する。

削除は deck を通常の学習対象から外す操作であり、学習履歴やカード本体の削除操作ではない。したがって `deck_cards`、`review_states`、`study_sessions`、`cards` は物理削除しない。削除済み deck は通常の一覧、詳細、学習開始、学習再開、AIカード管理、MCP deck list などから除外し、古い URL や stale UI state から操作されても副作用前に安全に失敗させる。

## 2. Must

- REQ-UI-01: `/decks` の削除操作は、S-25 の軽い `window.confirm` ではなく、デッキ名、不可逆性、削除対象、danger 表現を含む確認 dialog を表示する。
- REQ-UI-02: 確認 dialog は、デッキ名入力または固定文言 `削除` 入力のいずれかを要求し、一致するまで削除実行 button を有効にしない。
- REQ-UI-03: 確認 dialog は cancel / close 操作で閉じることができ、その場合は `deleteDeck` を呼ばない。
- REQ-UI-04: 削除実行 button は pending 中に `disabled` と `aria-disabled` を持ち、二重送信を UI レベルで抑止する。
- REQ-UI-05: pending 中の表示は削除対象 deck が分かる文脈を維持し、削除中に別 deck を誤って削除したように見えないこと。
- REQ-UI-06: 削除失敗時は dialog 内または対象 deck row 近傍に `role="alert"` で日本語 error を表示し、raw Supabase error、SQL、stack、他 owner 情報を含めない。
- REQ-UI-07: PC と 320px 幅相当のスマホで、dialog 本文、入力欄、cancel、削除実行、error 表示が重ならず、主要操作は 48px 以上の touch target を持つ。
- REQ-ACTION-01: `deleteDeck(previousState, formData)` は副作用前に `deckId` を実行時検証し、空、非文字列、UUID形式でない値を安全な失敗として返す。
- REQ-ACTION-02: `deleteDeck` は副作用前に `auth.getUser()` を呼び、未認証なら DB DML を実行しない。
- REQ-ACTION-03: `deleteDeck` は論理削除前に `decks.id = deckId AND decks.owner_user_id = user.id AND decks.deleted_at IS NULL` で owner deck の存在を確認する。
- REQ-ACTION-04: 他 owner deck、不存在 deck、削除済み deck、不正 deckId は同じ安全な失敗メッセージにし、存在差分を漏らさない。
- REQ-ACTION-05: owner deck であることを確認できた場合、対象 deck に `review_states` が存在しても削除を拒否しない。
- REQ-ACTION-06: owner deck であることを確認できた場合、対象 deck に完了済みまたは未完了 `study_sessions` が存在しても削除を拒否しない。
- REQ-ACTION-07: S-25 の active session 事前確認による拒否と、SQLSTATE `P1007` を active-session 専用文言へ写像する契約は削除または無効化する。
- REQ-ACTION-08: `deleteDeck` は `UPDATE decks SET deleted_at = now` 相当の query にも `id`、`owner_user_id`、`deleted_at IS NULL` を指定する。
- REQ-ACTION-09: 論理削除成功後は `/decks` を再検証し、対象 deck が一覧から消えるようにする。
- REQ-ACTION-10: 二重送信または stale UI state により同じ deck へ再削除が来た場合、1回目だけが成功し、2回目以降は安全な失敗として処理する。
- REQ-DB-01: `decks.deleted_at` による論理削除方式を維持し、`decks` の物理 DELETE policy / DELETE grant は追加しない。
- REQ-DB-02: S-25 の `guard_deck_logical_delete_active_session()` trigger が未完了 `study_sessions` を理由に deck 論理削除を拒否しないよう、trigger を削除または契約変更する。
- REQ-DB-03: `decks` SELECT / UPDATE と `deck_cards` policy は、通常経路で `decks.deleted_at IS NULL` を要求する S-25 の非表示契約を維持する。
- REQ-DATA-01: deck 論理削除時に `deck_cards` row を物理削除しない。
- REQ-DATA-02: deck 論理削除時に `review_states` row を物理削除しない。
- REQ-DATA-03: deck 論理削除時に `study_sessions` row を物理削除しない。
- REQ-DATA-04: deck 論理削除時に `cards` row を物理削除しない。private card がその deck でしか使われていない場合でも、本ストーリーでは card cleanup を行わない。
- REQ-READ-01: `/decks` 一覧は削除済み deck を表示しない。
- REQ-READ-02: deck 詳細と学習開始前の deck 取得は、`owner_user_id` と `deleted_at IS NULL` を確認し、削除済み deck を通常対象にしない。
- REQ-READ-03: 日次ステータス、AIカード作成/管理、MCP deck list など deck 選択肢または deck 集計を返す経路は、削除済み deck を対象外にする。
- REQ-STUDY-01: `startStudySession(deckId)` は削除済み deck では新規 session を作成せず、既存未完了 session があっても再利用しない。
- REQ-STUDY-02: `getStudySessionState(sessionId)`、`getNextCard(sessionId)`、`revealCard(sessionId)`、`rateCard(sessionId, rating)` など sessionId 起点の操作は、紐づく deck が削除済みの場合に副作用前に安全に失敗する。
- REQ-STUDY-03: 削除済み deck に紐づく未完了 `study_sessions` が残っていても、`rateCard` は `review_states` を upsert / update しない。
- REQ-SEC-01: Server Action は middleware や RLS だけに依存せず、アプリケーション層で認証と owner 境界を確認する。
- REQ-SEC-02: service role key や server-only secret は使用しない。通常 owner scoped CRUD は server client + RLS の範囲で行う。
- REQ-SEC-03: 失敗 response と UI error は、SQL、Supabase raw error、他 owner ID、存在有無の差分を利用者へ返さない。
- REQ-TEST-01: action test は、成功、未認証、不正 deckId、他 owner / 不存在 / 削除済み同一失敗、review_states あり成功、未完了 study_sessions あり成功、Supabase error 安全化、二重送信耐性、`revalidatePath("/decks")` を検証する。
- REQ-TEST-02: study action test は、削除済み deck に紐づく session で start / resume / reveal / rate が副作用前に拒否されることを検証する。
- REQ-TEST-03: UI test は、dialog 表示、削除対象名、不可逆性文言、入力一致まで disabled、cancel は action 未呼び出し、pending disabled、error 表示、PC / 320px 相当での操作可能構造を検証する。
- REQ-TEST-04: migration / domain contract test は、active session guard の撤廃、`deck_cards` / `review_states` / `study_sessions` / `cards` を物理削除しないこと、DELETE policy / grant を追加しないことを検証する。

## 3. Should

- REQ-SHOULD-01: dialog の入力条件は実装とテストが明確に固定できる方式を選ぶ。デッキ名入力を採用する場合は前後空白、全角/半角、同名 deck がある場合の表示を design で明記する。
- REQ-SHOULD-02: 削除後の stale な deck 詳細や学習画面では、可能な範囲で `/decks` へ戻れる導線または安全なエラーメッセージを表示する。
- REQ-SHOULD-03: 削除済み deck に紐づく未完了 session の扱いは、物理削除せず保持する前提で、通常 UI から再開できないことを design と tests で明示する。

## 4. Won't

- WON'T-01: deck 削除時に `decks` row を物理削除しない。
- WON'T-02: deck 削除時に `deck_cards`、`review_states`、`study_sessions`、`cards` を物理削除しない。
- WON'T-03: 削除済み deck の undo / restore / trash UI は実装しない。
- WON'T-04: SRS アルゴリズム、評価ロジック、queue 順、retry 上限、JST 日付計算を変更しない。
- WON'T-05: 複数デッキ一括削除は実装しない。
- WON'T-06: deck 削除を MCP tool として新規公開しない。
- WON'T-07: private card の孤児化 cleanup、illustration cleanup、mnemonic cleanup は本ストーリーでは行わない。

## 5. 受入条件対応

| AC | 要件 |
|---|---|
| AC-01 確認 dialog と cancel | REQ-UI-01, REQ-UI-03 |
| AC-02 入力必須 | REQ-UI-02 |
| AC-03 pending / 二重送信 | REQ-UI-04, REQ-UI-05, REQ-ACTION-10 |
| AC-04 review_states あり削除 | REQ-ACTION-05, REQ-DATA-02 |
| AC-05 study_sessions あり削除 | REQ-ACTION-06, REQ-ACTION-07, REQ-DB-02, REQ-DATA-03 |
| AC-06 一覧非表示 | REQ-ACTION-09, REQ-READ-01 |
| AC-07 削除済み deck から学習不可 | REQ-READ-02, REQ-STUDY-01〜03 |
| AC-08 関連データ保持 | REQ-DB-01, REQ-DATA-01〜04, WON'T-01〜02 |
| AC-09 認証 / owner / 存在なし / 安全 error | REQ-ACTION-01〜04, REQ-SEC-01〜03 |
| AC-10 PC / スマホ操作 | REQ-UI-07 |
| AC-11 テスト | REQ-TEST-01〜04 |

## 6. 現行調査メモ

- `specs/stories/S-25-deck-deletion/story.md` と `requirements.md` は、未完了 `study_sessions.finished_at IS NULL` がある deck の削除拒否を受入条件としている。S-29 はこの拒否条件を後続要件として上書きする。
- `frontend/src/actions/deck-actions.ts` の `deleteDeck` は、owner deck 確認後に `study_sessions.finished_at IS NULL` を確認し、存在すれば削除を拒否している。
- `supabase/migrations/20260728000000_s25_deck_delete.sql` は `guard_deck_logical_delete_active_session()` trigger で未完了 session を SQLSTATE `P1007` として拒否している。
- `frontend/src/components/deck/DeleteDeckForm.tsx` は `window.confirm` を使っており、デッキ名または固定文言入力による確認は未実装である。
- `supabase/migrations/20260223000000_s02_schema_rls.sql` では `deck_cards.deck_id` と `study_sessions.deck_id` は `decks(id) ON DELETE CASCADE` だが、S-25 以降の通常削除は `decks.deleted_at` の論理削除であり、物理 DELETE を追加しない限り cascade は発火しない。

## 7. ドキュメント判定

- 規模: large
- 推定ファイル数: 8〜12
- 影響レイヤー: UI component、Server Action、study domain / session action、Supabase migration / RLS contract、Database type、Vitest tests
- 要件定義書: 必須（本ファイル）。S-25 の既存要件を後続 story として上書きする create モード。
- ADR: 必須。未完了 `study_sessions` を削除阻止条件から外し、削除済み deck に紐づく session 操作を遮断するため、データフロー / session 正本 / DB trigger 契約の変更に該当する。
- Design Doc: 必須。大規模かつ UI、Server Action、DB、study session の複数境界に跨るため。
- 作業計画書: 必須。migration、action、UI、tests の依存順を明確にする必要があるため。

## 8. 未解決事項

1. 確認入力は「デッキ名」と固定文言 `削除` のどちらを採用するか。要件上はいずれも許容するが、design で一つに固定する必要がある。
2. 削除済み deck に紐づく未完了 `study_sessions` を、削除時に `finished_at` へ自動 mark するか、未完了のまま保持して session 操作側で拒否するか。S-29 要件では物理削除しないことのみ固定し、design で整合性とテスト容易性を比較する。
3. 削除済み deck の詳細 / 学習 URL へのアクセス時に `/decks` へ redirect するか、not found / error 表示にするか。通常経路から学習できないことを満たす範囲で design が決定する。
