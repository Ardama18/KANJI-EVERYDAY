# S-24 Design

## 1. 現行調査

| 対象 | 確認結果 |
|---|---|
| `frontend/app/(auth)/decks/[deckId]/page.tsx` | Server Component。`getDeckOverview(deckId)` を呼び、今日の学習、これまでの記録、学習設定を表示する。 |
| `frontend/src/actions/deck-actions.ts` | `getDeckOverview` は `decks.owner_user_id = userId` で owner deck を確認し、deck_cards と actor 本人の review_states を取得する。 |
| `frontend/src/lib/deck/study-status.ts` | S-19 の `resolveDeckStudyStatus` が `no-cards / todo / limit-reached / done` と親しみやすい文言を pure function で返す。 |
| `frontend/src/lib/deck/daily-study-status.ts` | S-22 で deck / deck_cards / review_states を actor scoped に集約する先例がある。owner query、short-circuit、JST reviewed count の実装方針を再利用できる。 |
| `frontend/src/actions/session-actions.ts` | `rateCard` は `review_states` を upsert し、session 完了時に `study_sessions.finished_at` を設定する。 |
| `supabase/migrations/20260223000000_s02_schema_rls.sql` | `review_states(user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at)` と `study_sessions(user_id, deck_id, finished_at)` があり、両方 RLS owner policy を持つ。 |
| `frontend/src/types/database.ts` | `review_states` と `study_sessions` 型は現行 schema と一致し、schema 変更なしで今回の読み取りに使える。 |
| `card_mnemonics` / ADR-013 | 承認済み mnemonic は `(owner_user_id, illustration_key)` 単位。card 1枚と 1:1 ではないため、傾向比較は `cards.illustration_key` 経由で owner scoped に判定する必要がある。 |

## 2. Scope / Non-goal

本設計はデッキ詳細に親向けの最小メトリクスを追加する。Server Action と server-side library で集計済み DTO を作り、UI は表示だけを行う。SRS 計算、session 進行、review state 書き込み、DB schema、RLS、AI prompt は変更しない。

現行 `review_states` は履歴ではないため、表示する rating 内訳は「直近7日に最後に評価されたカードの最新評価内訳」とする。厳密な attempt 数、前回より改善したカード数、過去 rating との差分は新しい履歴正本なしには出せないため scope 外とする。

## 3. 実装アプローチ

Hybrid を採用する。

1. まず pure aggregation module で date window、session 日、rating 内訳、mnemonic split を固定する。
2. 次に `getDeckLearningMetrics(deckId)` Server Action を追加し、認証・owner check・Supabase query・pure aggregation 呼び出しを接続する。
3. 最後に deck detail page と SSR component を接続し、empty state を壊さない表示にする。

この順序により、owner / JST / empty の主要リスクを UI 前に L1 / L2 で固定できる。

## 4. Domain Contract

### DTO

`frontend/src/lib/deck/learning-metrics.ts` に次の型を置く。

```ts
export type LearningMetricRating = "again" | "hard" | "good";

export type LearningMetricRatingBreakdown = Readonly<{
  total: number;
  again: number;
  hard: number;
  good: number;
  againRate: number | null;
  hardRate: number | null;
  goodRate: number | null;
}>;

export type LearningMetricDay = Readonly<{
  date: string;
  completedSessions: number;
  reviewedCards: number;
}>;

export type LearningMetricMnemonicTrend = Readonly<{
  withMnemonic: LearningMetricRatingBreakdown;
  withoutMnemonic: LearningMetricRatingBreakdown;
  comparable: boolean;
}>;

export type DeckLearningMetrics = Readonly<{
  contractVersion: 1;
  today: string;
  windowStart: string;
  windowEnd: string;
  activeDays: number;
  recentDays: readonly LearningMetricDay[];
  latestRatings: LearningMetricRatingBreakdown;
  mnemonicTrend: LearningMetricMnemonicTrend;
}>;
```

`Rate` は 0〜100 の integer percentage とし、分母 0 の場合は `null` を返す。UI は `null` を「まだありません」と表示し、0% と混同しない。

### Aggregation inputs

Pure function `summarizeDeckLearningMetrics(input)` は次だけを受け取る。

- `today: string`
- `deckCardIds: readonly string[]`
- `reviewStates: readonly ReviewStateMetricRow[]`
- `studySessions: readonly StudySessionMetricRow[]`
- `cards: readonly CardMnemonicKeyRow[]`
- `approvedMnemonicKeys: readonly string[]`

`today` から今日を含む7日間を `addDaysJST(today, -6)` 〜 `today` として生成する。`study_sessions.finished_at` と `review_states.last_reviewed_at` は `getJstDateForInstant` で JST 日付へ変換し、window 外または invalid timestamp は除外する。

### Rating definition

- `latestRatings`: deck 内 card の `review_states` のうち、`last_reviewed_at` が直近7日 window 内、かつ `last_rating in ("again","hard","good")` のものを数える。
- 同じ card の review state は primary key 上 1 行だけなので、重複排除は `card_id` を key にする。
- `review_states.user_id` は query 側で actor に絞るが、pure function でも actor 外 row を渡せる test fixture に備え、input row の user owner は service 層の責務として test する。

### Recent days definition

- `completedSessions`: `study_sessions.finished_at` が該当 JST 日付に入る session 件数。
- `reviewedCards`: `review_states.last_reviewed_at` が該当 JST 日付に入る deck 内 card の最新状態件数。
- `activeDays`: `completedSessions > 0 || reviewedCards > 0` の日数。

`study_sessions` は完了 session の日次実績、`review_states` はカードの最新評価日を表す。両者は意味が異なるため、UI では「直近7日: 学習した日 N日」「日別の完了 session / 最新評価カード」を控えめに表示する。

### Mnemonic trend definition

`cards.illustration_key` が non-null かつ actor の `card_mnemonics.status = "approved"` に一致する card を `withMnemonic`、それ以外を `withoutMnemonic` とする。各群の分子は `latestRatings` と同じ直近7日 window 内の review state だけを対象にする。

`comparable` は `withMnemonic.total > 0 && withoutMnemonic.total > 0` のとき true。false の場合、UI は優劣を示さず「比較できる学習データがまだありません」と表示する。

## 5. Server Action / Query Boundary

`frontend/src/actions/deck-actions.ts` に `getDeckLearningMetrics(deckId: string): Promise<DeckLearningMetrics | null>` を追加する。

処理順序:

```text
createServerClient
  -> auth.getUser() or redirect("/login")
  -> decks.select("id").eq("id", deckId).eq("owner_user_id", userId).maybeSingle()
  -> if null return null
  -> deck_cards.select("deck_id,card_id").eq("deck_id", deck.id)
  -> if no cards return empty metrics with no review/card/mnemonic query
  -> review_states.select(...).eq("user_id", userId).in("card_id", cardIds)
  -> study_sessions.select("id,finished_at").eq("user_id", userId).eq("deck_id", deck.id)
  -> cards.select("id,illustration_key").eq("owner_user_id", userId).in("id", cardIds)
  -> card_mnemonics.select("illustration_key,status").eq("owner_user_id", userId).eq("status","approved").in("illustration_key", keys)
  -> summarizeDeckLearningMetrics(...)
```

Notes:

- `study_sessions` query can select all deck sessions and filter the 7-day window in TypeScript, because the table currently has `idx_study_sessions_user_id_finished_at` but no composite `(user_id, deck_id, finished_at)` contract documented for this story. If performance becomes an issue, adding an index is a separate DB story.
- For card0 decks, return an empty `DeckLearningMetrics` DTO after deck_cards so UI can render stable empty state without unnecessary queries.
- Supabase raw errors throw sanitized messages such as `Failed to fetch deck learning metrics` and are not rendered directly.

## 6. UI Design

Deck detail page adds a new section after `今日の学習` and before `これまでの記録`.

Heading: `最近の学習メモ`

Suggested content:

- 今日: existing status message or `今日やることがあります`
- 直近7日: `学習した日 {activeDays}日 / 7日`
- 最新評価: `むり {again} / あやしい {hard} / できた {good}`
- ニーモニック傾向:
  - comparable true: `あり: できた {withGoodRate}% / なし: できた {withoutGoodRate}%`
  - comparable false: `比較できる学習データがまだありません`

Tone is parent-facing and neutral. Avoid celebratory copy such as `すごい！` or ranking-like language. Existing child-facing labels `むり / あやしい / できた` are reused because they match rating buttons and are already understandable.

Implementation can use a small Server Component `frontend/src/components/deck/LearningMetricsPanel.tsx` to keep the page readable. It receives `status` and `metrics` as props and performs only formatting, not aggregation.

## 7. Impact Map

| Area | Impact |
|---|---|
| Deck detail UI | Add one section to `/decks/[deckId]` |
| Server Action | Add read-only `getDeckLearningMetrics` |
| Domain logic | Add pure aggregation module and tests |
| Supabase schema / RLS | No change |
| SRS / session mutation | No change |
| AI prompt / external API | No change |
| MCP tools | No change |

## 8. Test Strategy

| Level | Target | Coverage |
|---|---|---|
| L1 Unit | `frontend/src/lib/deck/learning-metrics.test.ts` | 7-day JST window, activeDays, rating counts/rates, denominator 0, card0, invalid timestamps, mnemonic split, comparable false |
| L2 Action | `frontend/src/actions/deck-actions.test.ts` | auth redirect, owner deck missing returns null before reading child rows, review/session/mnemonic queries use actor owner filters, other-user review rows do not affect result, card0 short-circuit |
| L2 SSR markup | `frontend/src/app/decks/[deckId]/page.test.tsx` and/or `frontend/src/components/deck/LearningMetricsPanel.test.tsx` | metrics section visible, empty state, rating labels, no overpraise copy, no crash for 0 totals |
| L1 Existing | existing SRS/date/deck tests | ensure SRS and S-19 status behavior remains unchanged |
| L3 Manual | local browser | mobile 320px and desktop deck detail for todo/done/card0/first-day states, no horizontal scroll |

Commands planned:

```bash
npm --prefix frontend run test -- src/lib/deck/learning-metrics.test.ts src/actions/deck-actions.test.ts 'src/app/decks/[deckId]/page.test.tsx'
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

If route bundling is affected by Server/Client imports, also run:

```bash
npm --prefix frontend run build
```

## 9. Rollout / Rollback

No migration or external service is involved. Rollback is removing the new section, new Action, and new pure module. Existing `review_states` / `study_sessions` data is read-only and not modified.

## 10. Unresolved Questions

- None blocking for MVP. The main limitation is explicit: exact rating history and previous-rating improvement are impossible without a new history source, so they are not part of S-24.
