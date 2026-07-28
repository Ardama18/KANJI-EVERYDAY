# S-24 Implementation Plan

## Phase 1: Domain Aggregation

- 対象要件: REQ-03〜06, REQ-12, SHOULD-01, SHOULD-03〜05, NFR-DATE-01
- 対象ファイル:
  - `frontend/src/lib/deck/learning-metrics.ts` (new)
  - `frontend/src/lib/deck/learning-metrics.test.ts` (new)
- 実装内容:
  - `DeckLearningMetrics` DTO と rating/session/card/mnemonic 入力 row 型を定義する。
  - `buildRecentJstDateWindow(today, days = 7)` を実装し、今日を含む7日間を返す。
  - `summarizeRatingBreakdown(rows)` を実装し、`again/hard/good/total` と integer percentage または `null` を返す。
  - `summarizeDeckLearningMetrics(input)` を実装し、`activeDays`、`recentDays`、`latestRatings`、`mnemonicTrend` を返す。
  - `getJstDateForInstant` と `addDaysJST` を使い、invalid timestamp と window 外 row を除外する。
- 完了条件:
  - 分母 0 の rate は `null` になり、0% と混同しない。
  - `again/hard/good` の合計と率が固定 fixture で一致する。
  - `2026-02-23T15:00:00.000Z` が JST `2026-02-24` に入る。
  - card0 / session0 / review0 / mnemonic片側のみの入力で例外が出ない。
- 検証:
  - `npm --prefix frontend run test -- src/lib/deck/learning-metrics.test.ts`
- Security / data risk:
  - Pure function なので DB owner 境界は持たない。owner 境界は Phase 2 の Action test で固定する。

## Phase 2: Read-only Server Action

- 対象要件: REQ-02, REQ-06〜11, NFR-SEC-01〜02, NFR-PERF-01
- 対象ファイル:
  - `frontend/src/actions/deck-actions.ts`
  - `frontend/src/actions/deck-actions.test.ts`
- 実装内容:
  - `getDeckLearningMetrics(deckId: string): Promise<DeckLearningMetrics | null>` を追加する。
  - `requireAuthenticatedUserId` を使い、未認証は既存 deck read と同じ `/login` redirect にする。
  - 最初に `decks.select("id").eq("id", deckId).eq("owner_user_id", userId).maybeSingle()` で owner deck を確認する。
  - owner deck がなければ `null` を返し、`deck_cards` / `review_states` / `study_sessions` / `cards` / `card_mnemonics` を読まない。
  - owner 確認済み deck ID で `deck_cards` を取得し、card0 なら empty metrics を返す。
  - `review_states` は `.eq("user_id", userId).in("card_id", cardIds)` で取得する。
  - `study_sessions` は `.eq("user_id", userId).eq("deck_id", deck.id)` で取得する。
  - `cards` は `.eq("owner_user_id", userId).in("id", cardIds)` で `illustration_key` を取得する。
  - `card_mnemonics` は actor owner と approved status と illustration keys で取得する。key が0件なら query を skip する。
  - Supabase error は raw detail を含めず sanitized Error にする。
- 完了条件:
  - Action result は Phase 1 DTO を返し、UI 側の追加集計を不要にする。
  - 他 user の review state / session / mnemonic fixture が混ざっても result に影響しない。
  - child row queries が owner deck missing 時に呼ばれない。
  - DB schema / migration / RLS / SRS / AI prompt に差分がない。
- 検証:
  - `npm --prefix frontend run test -- src/actions/deck-actions.test.ts`
- Security / data risk:
  - RLS だけに依存せず、Action query の owner filter と二重にする。

## Phase 3: Deck Detail UI

- 対象要件: REQ-01〜03, REQ-05, REQ-12〜13, NFR-UI-01
- 対象ファイル:
  - `frontend/app/(auth)/decks/[deckId]/page.tsx`
  - `frontend/src/components/deck/LearningMetricsPanel.tsx` (new)
  - `frontend/src/components/deck/LearningMetricsPanel.test.tsx` (new, or page test assertions if kept inline)
  - `frontend/src/app/decks/[deckId]/page.test.tsx`
- 実装内容:
  - `DeckOverviewPage` で `getDeckOverview` と `getDeckLearningMetrics` を同じ `deckId` で呼ぶ。
  - `overview` が `null` の場合は既存どおり `notFound()` とし、metrics を表示しない。
  - `getTodayJST()` は page 内で1回評価し、既存 `resolveDeckStudyStatus` と metrics panel の表示に渡す。
  - `LearningMetricsPanel` は `status` と `metrics` を受け取り、集計済み DTO を表示するだけにする。
  - Section heading は `最近の学習メモ`、直近7日、最新評価内訳、ニーモニック傾向を落ち着いた親向け文言で表示する。
  - `metrics === null` は owner mismatch の場合だけであり、overview がある正常経路では発生しない想定。ただし defensive に metrics 欠落時の短い fallback を持たせる。
  - empty state: card0 / review0 / session0 / comparable false の文言を明示し、数値 0 のみで意味が分からない状態にしない。
- 完了条件:
  - デッキ詳細で親が最近の学習日数と最新評価内訳を読める。
  - `むり / あやしい / できた` のラベルと値が入れ替わらないことを markup test で検知できる。
  - 子ども本人への過度な称賛・ランキング表現がない。
  - 320px 幅で横スクロールしない構造を維持する。
- 検証:
  - `npm --prefix frontend run test -- 'src/app/decks/[deckId]/page.test.tsx' src/components/deck/LearningMetricsPanel.test.tsx`
  - 実装後に必要なら local browser で `/decks/[deckId]` を mobile / desktop 確認。
- Security / data risk:
  - UI は card content、raw timestamps、owner IDs を表示しない。

## Phase 4: Regression and Quality Gates

- 対象要件: 全 AC, NFR-COMPAT-01
- 対象ファイル:
  - 変更済みファイル全体
- 実装内容:
  - 変更差分が `frontend/src/lib/deck/learning-metrics.ts`、`frontend/src/actions/deck-actions.ts`、deck detail UI と関連 test に収まっていることを確認する。
  - `supabase/**`、SRS calculate/queue、AI prompt、MCP tool contract に差分がないことを確認する。
- 完了条件:
  - 受入条件と test の対応が `requirements.md` / `design.md` / `plan.md` と一致する。
  - lint と typecheck が通る。
- 検証:
  - `npm --prefix frontend run test -- src/lib/deck/learning-metrics.test.ts src/actions/deck-actions.test.ts 'src/app/decks/[deckId]/page.test.tsx' src/components/deck/LearningMetricsPanel.test.tsx`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run typecheck`
  - Route / Server Component import に変更が出るため、時間が許せば `npm --prefix frontend run build`
- Security / data risk:
  - Build/test output に secret、raw DB error、card contentの不要露出がないことを確認する。

## Handoff Notes

- `plan.md` が実装の単一情報源である。`tasks/` や個別 task file は作成しない。
- 実装開始時は `$ar-core:implement https://github.com/Ardama18/KANJI-EVERYDAY/issues/76 --auto` で再開し、成果物があるため plan から task-executor へ進める。
- 本 story は DB schema 変更を意図していない。現行 schema で出せない履歴メトリクスが必要になった場合は、新 story / ADR へ切り出す。
