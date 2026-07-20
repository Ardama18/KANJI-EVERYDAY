---
id: S-16
feature: first-user-deck-creation-mcp-create-deck
type: story
version: 1.0.0
created: 2026-07-20
updated: 2026-07-20
github_issue: 28
parent_epic: 9
parent_story: S-10
---

# S-16: 初回ユーザー向けデッキ作成導線とMCP create_deck

## ユーザーストーリー

ログイン済みの初回ユーザーとして、`/decks` または ChatGPT / Remote MCP から最初のデッキを作成し、そのデッキにAIカードを登録したい。なぜなら、デッキが0件の状態でもカード登録先を用意でき、`preview_card_import`、`commit_card_import`、`get_import_status` の既存AIカード登録フローへ進める必要があるから。

## 解決する課題

- `/decks` はデッキ0件時に空状態メッセージだけを表示し、作成導線がない。
- 既存UIではデッキ詳細からだけ `/decks/{deckId}/ai/new` へ進めるため、初回ユーザーは登録先デッキを自力で用意できない。
- Remote MCPには `list_decks` はあるが `create_deck` がなく、ChatGPTからデッキ0件ユーザーのカード登録フローを開始できない。
- `preview_card_import` / `commit_card_import` は `deck.id` 必須であり、本人所有deck IDを返す前段toolが必要である。

## スコープ

### 対象

- `/decks` に新規デッキ作成フォームを追加し、デッキ0件時にも表示する。
- `frontend/src/actions/deck-actions.ts` に本人owner境界、入力検証、revalidateを持つデッキ作成 Server Action を追加する。
- Remote MCP tool allowlistへ `create_deck` を追加し、本人所有deckを作成して後続 `preview_card_import` に渡せる `deck.id` を返す。
- `create_deck` と UI action が同じデッキ名検証ルールを使う。
- `docs/runbooks/ai-card-import.md` に `list_decks` が空の場合の `create_deck -> preview -> commit -> status` 手順を追記する。
- 既存デッキありユーザーの `/decks` 一覧、デッキ詳細、AIカード作成導線を維持する。

### 対象外

- DB schema、RLS policy、Storage policy、migrationの追加。
- AIカード import request schema の `deck.create` 対応拡張。
- デッキ編集、削除、並び替え、共有、公開deck機能。
- `new_limit_per_day` のUI/MCP入力化。既存DB default `10` を使う。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. デッキ0件のログインユーザーが `/decks` から新規デッキを作成できる。
2. 作成したデッキが `/decks` に表示される。
3. MCP `list_decks` が作成済みデッキを返す。
4. MCP `create_deck` で本人所有デッキを作成できる。
5. MCP `create_deck` は他ユーザー所有データを作成・参照しない。
6. MCP `preview_card_import` / `commit_card_import` が、`create_deck` で返した `deck.id` を使って実行できる。
7. デッキ名の入力検証があり、空文字、長すぎる名前、制御文字を拒否する。
8. 重複送信時に二重作成されない、またはユーザー体験上許容できる形で扱われる。
9. 既存デッキありユーザーの導線を壊さない。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/28
- Parent Epic: https://github.com/Ardama18/KANJI-EVERYDAY/issues/9
- Parent Story: `specs/stories/S-10-ai-card-import-foundation`
- Related Stories: S-10、S-12、S-14
- Accepted ADR: ADR-002、ADR-007、ADR-011
