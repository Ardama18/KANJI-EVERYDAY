---
id: S-25
feature: deck-deletion
type: story
version: 1.0.0
created: 2026-07-28
updated: 2026-07-28
github_issue: 81
related_epic: E-02
---

# S-25: 作成したデッキを削除できるようにする

## 背景

production の `/decks` では、ユーザーが作成した不要なデッキを削除できない。S-16 ではデッキ削除が Won't とされ、作成導線追加後の後続機能として未対応のまま残っている。

現行 `/decks` は `CreateDeckForm` と `DeckCard` による作成・一覧・詳細リンクが中心で、削除 UI / Server Action / `decks.deleted_at` による論理削除契約は存在しない。不要なデッキが残り続けるため、owner 本人が安全に一覧から消せる導線を追加する。

## ユーザーストーリー

ログイン済み owner として、自分で作成した不要なデッキを `/decks` から削除したい。なぜなら、学習に使わないデッキを一覧から消し、子どもが迷わず今日使うデッキを選べるようにしたいから。

## スコープ

### 対象

- `/decks` の各デッキ行に削除操作を追加する。
- 削除前に確認 UI を表示し、送信中の二重操作を防止する。
- `deleteDeck` Server Action を追加し、`auth.getUser()` と `decks.owner_user_id` で owner 本人だけを許可する。
- `decks.deleted_at` を使った owner scoped な論理削除 migration / RLS policy を追加する。
- `decks` の物理 DELETE policy / DELETE grant は追加しない。
- `deck_cards`、`study_sessions`、`cards`、`review_states` は deck 論理削除では物理削除しない。
- 削除済み deck は通常の一覧・詳細・学習開始・関連選択肢から除外する。
- 未完了 `study_sessions.finished_at IS NULL` が対象 deck に存在する場合は、副作用なしで削除を拒否する。
- 未認証、他 owner、不正 deckId、不存在 deckId、Supabase error は安全な日本語メッセージへ正規化する。
- 関連 unit / component / migration contract test を追加または更新する。

### 対象外

- デッキ名編集、並び替え、共有、公開デッキ。
- deck 削除に伴う private card 削除、AI import batch undo、tag / illustration cleanup。
- `study_sessions.deck_id` の nullable 化や `ON DELETE SET NULL` への変更。
- 削除済み deck の復元 UI / trash UI。
- SRS アルゴリズム、queue 順、retry 上限、JST 日付計算の変更。
- MCP tool としての `delete_deck` 追加。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. ログイン済み owner が `/decks` で自分のデッキを論理削除できる。
2. 削除成功後、対象デッキは `/decks` の一覧から消える。
3. 他 owner、存在しない deckId、削除済み deckId の削除は同じ安全な失敗として扱い、存在差分を漏らさない。
4. 未認証では DB 副作用を起こさず、ログイン要求または安全な失敗になる。
5. 不正な deckId は DB 副作用なしで安全な失敗になる。
6. 削除対象 deck の `deck_cards` と `study_sessions` は物理削除されず、通常経路からは削除済み deck として除外される。
7. deck に含まれる `cards` と owner の `review_states` は deck 論理削除では削除されない。
8. 対象 deck に未完了 `study_sessions.finished_at IS NULL` がある場合、削除は副作用なしで拒否される。
9. 削除操作は確認 UI と pending disabled を持ち、320px 幅のモバイルでも操作できる。
10. 削除失敗時は raw Supabase error、SQL、stack、他 owner 情報を含まない日本語メッセージを表示する。
11. 関連する unit / action / component / migration contract test が追加または更新される。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/81
- Related Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Accepted ADRs: `specs/adr/ADR-002-database-schema-rls-access-boundary.md`, `specs/adr/ADR-005-study-session-flow.md`, `specs/adr/ADR-007-ai-card-import-foundation.md`
- Related Stories: S-06, S-16, S-17, S-19, S-24
