---
id: S-29
feature: safer-deck-deletion-with-study-state
type: story
version: 1.0.0
created: 2026-08-01
updated: 2026-08-01
github_issue: 92
related_epic: E-02
related_story: S-25
---

# S-29: デッキ削除を誤操作しにくくし、学習状態があっても削除できるようにする

## 背景

S-25 / GitHub Issue #81 で、owner 本人は `/decks` から自分のデッキを論理削除できるようになった。現在は削除ボタン、確認、削除の流れで一覧から消えるが、確認が軽く、誤操作への備えが弱い。

また、S-25 では削除対象 deck に未完了 `study_sessions.finished_at IS NULL` がある場合、Server Action と DB trigger の両方で削除を拒否する設計になっている。GitHub Issue #92 では、owner 本人は復習状態や学習履歴が存在するデッキでも削除できること、削除後の通常経路から deck が見えず、削除済み deck から学習開始できないこと、関連データの扱いが仕様・実装・テストで一致していることが求められている。

## ユーザーストーリー

ログイン済み owner として、復習状態や学習履歴がある不要なデッキでも、誤操作しにくい確認を経て `/decks` から削除したい。なぜなら、学習に使わないデッキを安全に片付け、子どもが選ぶべきデッキを迷わないようにしたいから。

## スコープ

### 対象

- `/decks` の削除確認 UI を、デッキ名、不可逆性、danger 表現を含む確認 dialog に強化する。
- 削除実行前に、デッキ名入力または固定文言 `削除` 入力のいずれかを必須にする。
- pending 中は送信ボタンを disabled / aria-disabled にし、二重送信で重複副作用が起きないようにする。
- owner 本人は `review_states` が存在する deck でも削除できる。
- owner 本人は完了済みまたは未完了 `study_sessions` が存在する deck でも削除できる。
- 削除は S-25 の `decks.deleted_at` による論理削除を維持し、`decks` row の物理 DELETE は行わない。
- `deck_cards`、`review_states`、`study_sessions`、`cards` は deck 削除では物理削除しない。
- 削除済み deck は `/decks` 一覧、deck 詳細、学習開始、日次ステータス、AIカード作成/管理、MCP deck 一覧など通常経路から除外する。
- 削除済み deck に紐づく未完了 `study_sessions` が残っていても、通常 UI / Server Action から再開、出題、回答表示、評価保存ができないようにする。
- 未認証、他 owner、不存在 deck、不正 deckId、削除済み deck への再削除は安全な失敗として扱う。
- PC と 320px 幅相当のスマホで削除確認、キャンセル、実行、pending、失敗表示を操作できる。
- action / domain または migration contract / UI test を追加または更新し、関連データ保持と削除後の学習不可を固定する。

### 対象外

- SRS アルゴリズム、評価ロジック、queue 順、retry 上限、JST 日付計算の変更。
- 削除済み deck の復元 UI、trash UI、監査一覧。
- 複数デッキ一括削除。
- deck 名編集、deck 並び替え、共有 deck / 公開 deck の新規仕様。
- `cards` 本体の deck 削除連動削除。
- AI import batch undo や mnemonic / illustration cleanup の新規仕様。
- production deploy、GitHub issue close。

## 受入条件

1. `/decks` の削除操作は、デッキ名、不可逆性、danger 表現を含む確認 dialog を表示し、キャンセル時は Server Action を呼ばない。
2. 削除確認では、デッキ名または固定文言 `削除` の入力が一致するまで削除実行ボタンが有効にならない。
3. pending 中は削除実行ボタンが disabled / aria-disabled になり、二重送信しても同一 deck に対する重複副作用や raw error 表示が起きない。
4. ログイン済み owner は、対象 deck に `review_states` が存在しても削除できる。
5. ログイン済み owner は、対象 deck に完了済みまたは未完了 `study_sessions` が存在しても削除できる。
6. 削除成功後、対象 deck は `/decks` 一覧から消える。
7. 削除済み deck の URL または古い UI state から学習開始、学習再開、回答表示、評価保存を試みても安全な失敗または通常の非表示導線になり、`review_states` や `study_sessions` は更新されない。
8. `deck_cards`、`review_states`、`study_sessions`、`cards` は deck 削除時に物理削除されず、通常経路では削除済み deck として扱われる。
9. 未認証、他 owner、不存在 deck、不正 deckId、削除済み deck の再削除は副作用なしで拒否され、存在差分、SQL、Supabase raw error、他 owner 情報を表示しない。
10. PC と 320px 幅相当のスマホで、確認 dialog の本文、入力欄、キャンセル、削除実行、pending、エラー表示が重ならず操作できる。
11. action / domain または migration contract / UI test が、AC-01〜AC-10 と `deck_cards` / `review_states` / `study_sessions` / `cards` の扱いを検証している。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/92
- Related Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Follow-up of: `specs/stories/S-25-deck-deletion/`
- Accepted ADRs: `specs/adr/ADR-002-database-schema-rls-access-boundary.md`, `specs/adr/ADR-005-study-session-flow.md`
