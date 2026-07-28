# S-24 Requirements

## 1. 正本と前提

- 正本は issue-sprint orchestrator が取得した GitHub issue #76 の本文である。
- issue タイトルの `S-23` は既存 story と衝突するため、本 artifact は `S-24` とする。
- 学習進行の正本は ADR-005 に従い `study_sessions`、カードごとの最新評価状態の正本は `review_states` である。
- `review_states` は評価履歴ではなく最新状態である。したがって本 story で表示する評価内訳は「直近7日に最後に評価されたカードの最新評価内訳」であり、全 rating attempt の履歴ではない。
- DB schema / migration / RLS / SRS アルゴリズム / AI prompt は変更しない。

## 2. Must

- **REQ-01**: デッキ詳細 `/decks/[deckId]` は、親向けの学習効果メトリクス領域を表示しなければならない。
- **REQ-02**: メトリクス領域は今日の完了状態を表示し、既存 `resolveDeckStudyStatus` と同じ入力・JST 今日で判定しなければならない。
- **REQ-03**: メトリクス領域は直近7日の学習実績を表示しなければならない。
- **REQ-04**: 直近7日の学習実績は `study_sessions.finished_at` を `getJstDateForInstant` で JST 日付へ変換し、日別の完了 session 有無または件数から集計しなければならない。
- **REQ-05**: メトリクス領域は直近7日に最後に評価された deck 内カードの `again` / `hard` / `good` 最新評価内訳を表示しなければならない。
- **REQ-06**: 評価内訳は `review_states.last_rating` と `review_states.last_reviewed_at` を正本とし、Client Component の local state や browser clock から集計してはならない。
- **REQ-07**: deck ID は Server Action で認証済み user の `decks.owner_user_id` と照合し、所有外または不存在なら他データを読まず `null` を返さなければならない。
- **REQ-08**: `deck_cards` は owner 確認済み deck ID だけで取得しなければならない。
- **REQ-09**: `review_states` は `user_id = actorUserId` と deck 内 card IDs の両方で絞り、別 user の review state を集計してはならない。
- **REQ-10**: `study_sessions` は `user_id = actorUserId` と owner 確認済み deck ID の両方で絞り、別 user の session を集計してはならない。
- **REQ-11**: ニーモニック傾向を表示する場合、`cards.owner_user_id = actorUserId` と deck 内 card IDs で card を取得し、`card_mnemonics.owner_user_id = actorUserId` と該当 `illustration_key` で承認済み mnemonic を判定しなければならない。
- **REQ-12**: 空 deck、学習済み0件、直近7日の評価0件、session 0件、mnemonic 比較不可の状態は、数値 0 と短い説明文で壊れずに表示しなければならない。
- **REQ-13**: 表示文言は子ども本人を過度に褒める文体ではなく、親が判断しやすい落ち着いた表現にしなければならない。

## 3. Should

- **SHOULD-01**: 集計ロジックは `frontend/src/lib/deck/learning-metrics.ts` の pure function と actor-scoped query service に分離し、UI から再利用しやすくする。
- **SHOULD-02**: `getDeckOverview` の既存 DTO と重複する今日のカウントは再計算を避け、ページ側で `overview` と metrics DTO を同じ `today` で結線する。
- **SHOULD-03**: 直近7日の表示は、今日を含む7日間を古い順または新しい順で固定し、session がない日も 0 として返す。
- **SHOULD-04**: 評価内訳は件数と率の両方、または件数と合計を表示し、分母 0 の場合は 0% ではなく「まだありません」と表示する。
- **SHOULD-05**: ニーモニックあり/なしの傾向は、両群に評価データがある場合に比較し、片側しかない場合は比較不能として表示する。

## 4. Could

- **COULD-01**: 学習完了画面 `SessionComplete` に同じ metrics DTO の要約を表示してもよい。ただし本 story の MVP ではデッキ詳細を優先する。
- **COULD-02**: 直近7日の学習実績を文字列のバーまたは小さな pill で表示してもよい。

## 5. Won't

- **WON'T-01**: 評価履歴 table、analytics table、DB view、RPC、migration を追加しない。
- **WON'T-02**: `study_sessions` / `review_states` への書き込み契約を変更しない。
- **WON'T-03**: `again` / `hard` / `good` の SRS 計算、level、due date、retry の意味を変更しない。
- **WON'T-04**: 「前回より改善したカード数」は、現行 schema に前回 rating 履歴がないため表示しない。
- **WON'T-05**: 外部 analytics SaaS、ランキング、課金、学校管理者向け集計を導入しない。

## 6. 非機能・セキュリティ要件

- **NFR-SEC-01**: Server Action は `auth.getUser()` で認証し、deck / session / review state / mnemonic の owner filter と RLS を併用する。
- **NFR-SEC-02**: raw Supabase error、SQL、token、cookie、card 内容、内部 stack を UI や snapshot に露出しない。
- **NFR-DATE-01**: JST date boundary は `frontend/src/lib/date.ts` の既存 utility を使い、unit test は clock または `today` input を固定する。
- **NFR-PERF-01**: deck 単位の詳細表示で N+1 query を避け、deck_cards / review_states / study_sessions / cards / card_mnemonics はそれぞれ最大1 queryに抑える。
- **NFR-UI-01**: 320px 幅でも横スクロールせず、既存詳細画面の `max-w-lg` と 48px touch target を壊さない。
- **NFR-COMPAT-01**: 既存 MCP tool、AI card management、SRS、session Action の contract を破壊しない。

## 7. AC / 要件対応

| AC | 要件 | 検証 |
|---|---|---|
| AC-1 最近ちゃんと学習できているか判断できる | REQ-01, REQ-02, REQ-03, REQ-04 | deck detail markup test, manual UI check |
| AC-2 記憶定着に近い指標 | REQ-05, REQ-06, SHOULD-04 | learning metrics unit test, deck detail markup test |
| AC-3 owner 境界 | REQ-07, REQ-08, REQ-09, REQ-10, REQ-11, NFR-SEC-01 | action/service test with other-user rows |
| AC-4 JST 境界 | REQ-04, NFR-DATE-01 | unit test with UTC 15:00 JST boundary |
| AC-5 空/初日/0件表示 | REQ-12, SHOULD-04, SHOULD-05 | unit and markup empty-state tests |
| AC-6 主要集計ロジック test | SHOULD-01 | `learning-metrics.test.ts` |
| AC-7 lint/typecheck | NFR-COMPAT-01 | `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck` |

## 8. 未解決事項

- 現行 schema では rating attempt 履歴がないため、厳密な日別評価回数、連続学習日の完全な復元、前回 rating との差分は出せない。S-24 では現行正本で安全に出せる「完了 session 日」「最新評価内訳」に限定する。
