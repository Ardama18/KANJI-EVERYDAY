# S-19 Requirements

対応 issue: #63。表示のみの改善であり、SRS の分類・スケジュール・日次上限のロジックは変更しない。

## 用語

- 今日やること（`todayCount`）: 既存 `countByCategory` の `new + learn + due`。
- きょうやった（`studiedToday`）: 当該デッキのカードのうち `review_states.last_reviewed_at` の JST 日付が今日と一致するユニークカード数。
- 残り枠（`remainingToday`）: `max(0, daily_study_limit - studiedToday)`。既存 `getDeckOverview` と同一定義。
- 次回予定日（`nextDueDate`）: 当該デッキのカードのうち `due_date > today`（JST 日付文字列比較）となる最小の `due_date`。存在しなければ `null`。

## 機能要件

- FR-01: 一覧 `/decks` の各デッキ行は、そのデッキの `studiedToday` を「きょうやった N枚」として表示しなければならない。
- FR-02: 詳細 `/decks/[deckId]` は `studiedToday` を「今日の学習」セクション内の指標として表示しなければならない（学習設定内の既存表示だけに留めない）。
- FR-03: 一覧・詳細は、今日やることが 0 枚（`todayCount === 0`）かつカードが1枚以上あるとき、`0` の数値の羅列を主表示にせず完了メッセージを表示しなければならない。
- FR-04: FR-03 の状態で `nextDueDate` が存在するとき、システムは「つぎは {日付}」を表示しなければならない。`nextDueDate` が翌日のときは日付の代わりに「あした」を表示する。
- FR-05: FR-03 の状態で `nextDueDate` が存在しないとき、システムは「つぎの よていは まだないよ」を表示しなければならない。
- FR-06: カードが 0 枚のデッキでは、完了メッセージではなく既存のカード未登録メッセージ（`カードがまだありません`）を表示しなければならない。
- FR-07: 今日やることが 1 枚以上あり残り枠が 1 枚以上あるとき、システムは「あたらしい」「ふくしゅう」の枚数を表示しなければならない。`ふくしゅう` は `learn + due` の合計とする。
- FR-08: 今日やることが 1 枚以上あるが残り枠が 0 枚のとき、システムは上限到達メッセージを表示し、詳細では開始導線を非活性のまま維持しなければならない（既存挙動を維持）。
- FR-09: 一覧・詳細の表示ラベルから `New` / `Learn` / `Due` の英語表記を除去しなければならない。
- FR-10: 一覧行の全体状態表示は「カード N枚 ・ 学習した N枚」とし、`scheduledCards`（将来予定枚数）は一覧から除き、その役割を次回予定日の表示に集約しなければならない。
- FR-11: 完了・上限到達・次回予定の判定と文言は一覧と詳細で単一の実装を共有しなければならない。

## 非機能要件

- NFR-01: `studiedToday` と `nextDueDate` の算出は既存の Supabase クエリで取得済みの `review_states`（`last_reviewed_at`、`due_date`）から行い、追加のデータベースラウンドトリップを発生させてはならない。
- NFR-02: JST 日境界の判定は既存 `frontend/src/lib/date.ts` の `getTodayJST` / `getJstDateForInstant` を使用し、`getDeckOverview` の日次カウントと同一の結果を返さなければならない。
- NFR-03: 「今日」の決定と日付の整形は Server Component / Server Action 側で行い、Client Component 側で `new Date()` を評価してはならない（タイムゾーン差異と hydration mismatch の回避）。
- NFR-04: `frontend/src/lib/srs/` の既存 export（`classifyCard`、`countByCategory`、`summarizeDeckStudyState`、`buildSessionQueue`、`calculateRating`）の入出力は変更してはならない。
- NFR-05: DB schema、migration、RLS、Storage policy、認証境界、環境変数を変更してはならない。
- NFR-06: 表示ラベルは色だけに依存せずテキストを併記し、touch target と contrast の既存基準（`.claude/steering/design-system.md`）を満たさなければならない。
- NFR-07: 表示する枚数は既存の分類結果に基づく値とし、日次上限による出題側の絞り込み（`buildSessionQueue`）を表示側で再計算してはならない。

## セキュリティ要件

- SEC-01: `getDecksWithCounts` / `getDeckOverview` の認証・所有権チェック（`requireAuthenticatedUserId`、`owner_user_id` 一致、`review_states.user_id` 一致）を維持しなければならない。
- SEC-02: 追加する表示値は当該ユーザーの `review_states` のみから算出し、他ユーザーのデータを含めてはならない。

## 受入条件（issue #63 との対応）

| AC | 内容 | 対応要件 |
|---|---|---|
| AC-1 | 一覧・詳細で「本日学習済み」枚数が表示される | FR-01, FR-02 |
| AC-2 | 今日やること 0 で「完了」＋次回予定日が表示される（空の 0/0/0 でない） | FR-03, FR-04, FR-05, FR-06 |
| AC-3 | キューありデッキでやるべき枚数が分かる | FR-07, FR-08 |
| AC-4 | SRS 分類・スケジュール・日次上限のロジックが不変 | NFR-04, NFR-05, NFR-07 |
| AC-5 | JST 日境界が既存日次カウントと整合 | NFR-01, NFR-02, NFR-03 |
| AC-6 | `npm --prefix frontend run check` 通過 | plan.md Phase 4 |
