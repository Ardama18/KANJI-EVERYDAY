# S-19 /decks の学習状況を前向きに表示する

- Epic: E-02 core-study-flow
- GitHub issue: [#63](https://github.com/Ardama18/KANJI-EVERYDAY/issues/63)
- 種別: 表示改善（SRS ロジック不変・frontend 完結）

## User value

小学生（と保護者）が `/decks` を開いたとき、「今日やること」と「今日できたこと」が一目で分かる。
今日の学習を消化しきった状態が `New 0 / Learn 0 / Due 0` として表示され、達成したのに「何もしていない」ように見える現状を解消する。

## Scope

- 一覧 `/decks`（`DeckCard`）と詳細 `/decks/[deckId]` に「きょうやった（本日学習済み）枚数」を表示する。
- 今日やることが 0 のとき、0 の羅列ではなく完了メッセージと（あれば）次回予定日を表示する。
- Anki 由来の `New / Learn / Due` を小学生向けの日本語に置き換え、`Learn` と `Due` を「ふくしゅう」に統合表示する。
- 「学習済み」「予定」の意味重複を文言と情報配置で緩和する。

## Out of scope

- SRS の分類・間隔計算・出題キュー・日次上限のロジック変更。
- 学習画面（`/decks/[deckId]/study`）の挙動変更。
- DB migration、RLS、Storage、Supabase クエリ契約の変更。
- 統計ダッシュボード等の新規画面、ふりがな（ruby）基盤の導入。

## Acceptance（概要）

1. 一覧・詳細に本日学習済み枚数が出る。
2. 今日やること 0 のとき「完了」＋（あれば）次回予定日が出る。
3. 学習キューがあるデッキではやるべき枚数（あたらしい / ふくしゅう）が分かる。
4. SRS ロジックは不変。
5. JST 日境界は既存の日次学習カウントに準拠する。
6. `npm --prefix frontend run check` が通る。

詳細は `requirements.md`、設計判断は `design.md`、実装順序は `plan.md` を参照する。
