# 要件定義書: 一日最大学習枚数と将来予定カードの可視化

## 1. 方針

S-17 は固定間隔SRSのまま、デッキ単位の `daily_study_limit` とUI上の全体状態表示を追加する。既存 `new_limit_per_day` は新規カードだけの上限として残し、総学習上限との責務を分離する。

セッション作成時は「今日まだ学習できるユニークカード数」を算出し、`Due -> Learn -> New` の順で残枠までキューを作る。`Again` retryは同一セッション内の再提示であり、一日最大学習枚数のユニークカード数には重複加算しない。

## 2. 前提

- アプリは `frontend/` 配下の Next.js 14 App Router + React 18 + Tailwind CSS 3。
- データは Supabase PostgreSQL、認証は Supabase Auth、型は `frontend/src/types/database.ts` で管理する。
- `decks.new_limit_per_day` はDB default 10の新規カード上限として存在する。
- `review_states` はユーザーとカードの学習状態を保持し、`due_date` はJST日付文字列としてアプリで扱う。
- `study_sessions` は4種のキューをJSONBとして持ち、active sessionがあれば `startStudySession()` は既存セッションを再利用する。
- `getTodayJST()` と `frontend/src/lib/date.ts` のJSTユーティリティを日付境界の正本にする。

## 3. Must

- REQ-DB-01: `decks.daily_study_limit integer NOT NULL DEFAULT 20` を追加する。
- REQ-DB-02: 既存デッキはmigration適用後に `daily_study_limit=20` を持つ。
- REQ-DB-03: `daily_study_limit` には過剰・無効な値を防ぐCHECK制約を追加する。
- REQ-TYPE-01: `frontend/src/types/database.ts` の `decks.Row/Insert/Update` に `daily_study_limit` を反映する。
- REQ-SRS-01: `buildSessionQueue` は `newLimit` と `dailyStudyLimit` を受け、`due -> learn -> new` の順で総上限までキューを構築する。
- REQ-SRS-02: `dailyStudyLimit` は有限整数に正規化し、無効値や0未満は0として扱う。
- REQ-SRS-03: `new` キューは `newLimit` と総上限残枠の小さい方に制限される。
- REQ-SRS-04: `due` と `learn` の内部順序、`new` の内部順序は入力順を維持する。
- REQ-SRS-05: `getNextCardId` の出題優先順位は `due -> learn -> new -> retry` を維持する。
- REQ-SRS-06: `retry` は `dailyStudyLimit` の初期キュー制限に含めず、`Again` 評価後の当日再提示として既存最大2回の契約を維持する。
- REQ-ACTION-01: `startStudySession(deckId)` は `decks.daily_study_limit` を取得してキュー構築へ渡す。
- REQ-ACTION-02: `startStudySession(deckId)` は同じJST日に同じデッキで学習済みのユニークカード数を算出し、`daily_study_limit - studiedToday` を当日の残り枠にする。
- REQ-ACTION-03: 当日の残り枠が0以下の場合、新規セッションを作らず完了状態を返す。
- REQ-ACTION-04: active sessionが存在する場合は既存どおり再利用し、途中のキューを勝手に再構築しない。
- REQ-ACTION-05: `rateCard()` の進捗計算は引き続きユニークカード基準で、retry重複を総数に含めない。
- REQ-ACTION-06: デッキ詳細から `daily_study_limit` を更新できるServer Actionを追加し、本人所有デッキだけを更新する。
- REQ-ACTION-07: `daily_study_limit` 入力は整数、最小1、最大100の範囲で検証し、失敗時はDB更新しない。
- REQ-OVERVIEW-01: デッキ一覧の戻り値は今日の `counts` に加え、`totalCards`、`learnedCards`、`scheduledCards`、`dailyStudyLimit` を含む。
- REQ-OVERVIEW-02: デッキ詳細の戻り値は今日の `counts.total`、`totalCards`、`learnedCards`、`scheduledCards`、`dailyStudyLimit`、`newLimitPerDay`、`studiedToday`、`remainingToday` を含む。
- REQ-OVERVIEW-03: `scheduledCards` は `reviewState !== null && dueDate > today` のカード数とする。
- REQ-OVERVIEW-04: `learnedCards` は `reviewState !== null` のカード数とする。
- REQ-UI-01: デッキ一覧は `New/Learn/Due` を残しつつ、カード総数、学習済み、将来予定を表示する。
- REQ-UI-02: デッキ詳細は「今日の学習」と「全体状態」を分けて表示する。
- REQ-UI-03: デッキ詳細は `daily_study_limit` 設定フォームを表示し、保存成功・失敗をユーザーに伝える。
- REQ-UI-04: 今日の学習対象が0で将来予定がある場合、完了メッセージは「カードがない」ではなく「次の予定があります」と分かる文言にする。
- REQ-TEST-01: 将来予定カードだけのデッキが `New/Learn/Due 0` でも `totalCards/learnedCards/scheduledCards` を返す再現テストを追加する。
- REQ-TEST-02: `buildSessionQueue` が `Due -> Learn -> New` の順で `dailyStudyLimit` を超えないテストを追加する。
- REQ-TEST-03: `new_limit_per_day` と `daily_study_limit` 残枠の小さい方で `new` が制限されるテストを追加する。
- REQ-TEST-04: JST日付境界で `studiedToday` と `scheduledCards` の判定がずれないテストを追加する。
- REQ-TEST-05: migrationが `review_states` と `study_sessions` を更新・削除しないことを静的テストで固定する。

## 4. Should

- SHOULD-01: `dailyStudyLimit` の既定値・入力範囲は定数化し、DB default、UI表示、テスト名で意味を揃える。
- SHOULD-02: デッキ一覧は小さい画面でも横スクロールせず、今日のカウントと全体状態を読み分けられる。
- SHOULD-03: デッキ詳細の設定フォームは48px以上のタッチターゲットとラベルを持つ。
- SHOULD-04: 既存 active session中に上限設定を変更しても、そのセッションは破棄せず、次回新規セッション作成から反映する。
- SHOULD-05: DB型生成コマンドが利用できない場合でも、手動更新した `database.ts` とmigration契約テストで差分を固定する。

## 5. Won't

- WON'T-01: FSRS / SM-2 のための追加列は実装しない。
- WON'T-02: `new_limit_per_day` を総上限に統合しない。
- WON'T-03: active sessionの既存キューをmigrationや設定変更で書き換えない。
- WON'T-04: `review_states` や `study_sessions` の既存行を削除・更新しない。
- WON'T-05: ユーザー単位のグローバル学習上限は実装しない。

## 6. 非機能・セキュリティ要件

- NFR-SEC-01: 全Server Actionは `auth.getUser()` と `owner_user_id = userId` を維持する。
- NFR-SEC-02: 他ユーザーのデッキ、カード、review state、study sessionを集計・更新しない。
- NFR-DATA-01: migrationは `decks` への列追加と制約追加に限定し、既存学習データを破壊しない。
- NFR-PERF-01: デッキ一覧・詳細の集計は既存の2段階取得を維持し、カード配列に対するO(n)集計に留める。
- NFR-UX-01: `New/Learn/Due` は「今日の学習対象」として表示し、全体状態とは文言上も視覚上も区別する。
- NFR-COMPAT-01: 既存の学習開始、学習再開、評価、retry、完了画面を壊さない。

## 7. 受入条件対応

| AC | 要件 |
|---|---|
| AC-01 一日最大学習枚数保存 | REQ-DB-01〜03, REQ-ACTION-06〜07 |
| AC-02 デフォルト20 | REQ-DB-01〜02, SHOULD-01 |
| AC-03 今日のユニーク出題枚数上限 | REQ-SRS-01〜03, REQ-ACTION-01〜03 |
| AC-04 優先順位明確 | REQ-SRS-01, REQ-SRS-04〜05 |
| AC-05 Again retry維持 | REQ-SRS-06, REQ-ACTION-05 |
| AC-06 new_limit関係明記 | 方針, REQ-SRS-03, WON'T-02 |
| AC-07 一覧の総数/学習済み/将来予定 | REQ-OVERVIEW-01, REQ-UI-01 |
| AC-08 詳細の今日/全体区別 | REQ-OVERVIEW-02, REQ-UI-02 |
| AC-09 将来予定だけのデッキ可視化 | REQ-OVERVIEW-03〜04, REQ-UI-04, REQ-TEST-01 |
| AC-10 JST境界テスト | REQ-TEST-04 |
| AC-11 既存データ非破壊 | REQ-TEST-05, NFR-DATA-01, WON'T-04 |

## 8. 未解決事項

- `daily_study_limit` の最大値はS-17では100とする。将来、保護者設定や学年別推奨値が入る場合は別ストーリーで再設計する。
- 同じ日に複数デッキを学習する場合、上限はデッキ単位でありユーザー全体の合計上限ではない。
