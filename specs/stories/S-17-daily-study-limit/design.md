# 設計書: 一日最大学習枚数と将来予定カードの可視化

## 1. 現行調査

- `frontend/src/lib/srs/queue.ts` の `buildSessionQueue(cards, today, newLimit)` は `due` と `learn` を全件キューへ入れ、`new` だけ `newLimit` で制限している。
- `frontend/src/lib/srs/classify.ts` は `reviewState === null` を `new`、`dueDate <= today && level <= 1` を `learn`、`dueDate <= today && level >= 2` を `due`、`dueDate > today` を `null` にする。
- `frontend/src/actions/session-actions.ts` の `startStudySession()` は `decks.new_limit_per_day` だけを取得し、`buildSessionQueue()` へ渡す。active sessionがある場合は再利用する。
- `frontend/src/actions/session-actions.ts` の進捗は `queue.due/learn/new` のユニーク数と `review_states.last_reviewed_at >= session.created_at` のユニーク数で計算し、retryを重複加算しない。
- `frontend/src/actions/deck-actions.ts` の `getDecksWithCounts()` と `getDeckOverview()` は `countByCategory()` だけを使うため、将来予定カードは表示データから落ちる。
- `frontend/src/components/deck/DeckCard.tsx` は `New/Learn/Due` バッジのみを表示する。
- `frontend/app/(auth)/decks/[deckId]/page.tsx` は今日の `counts.total` が0なら「今日の学習は完了しています」と表示するが、将来予定やカード総数は表示しない。
- `supabase/migrations/20260223000000_s02_schema_rls.sql` の `decks` は `new_limit_per_day integer NOT NULL DEFAULT 10` を持つ。`study_sessions` と `review_states` は既存学習データであり、本Storyで破壊しない。
- `frontend/src/types/database.ts` は生成済み型として `decks.Row/Insert/Update` に `new_limit_per_day` だけを持つ。

## 2. Scope / Non-goal

S-17はE-02の固定間隔SRSに、デッキ単位の総学習上限と将来予定カードの可視化を追加する。SRSの間隔テーブルや評価意味は変更しない。`new_limit_per_day` は新規カード上限として残し、`daily_study_limit` は復習・学習中・新規を含む一日のユニークカード上限として扱う。

DB migrationは `decks.daily_study_limit` の追加に限定する。`review_states` と `study_sessions` の既存行は更新・削除せず、active sessionのキューも再構築しない。

## 3. データモデル

### Migration

新規migrationを追加する。

```sql
ALTER TABLE public.decks
  ADD COLUMN daily_study_limit integer NOT NULL DEFAULT 20;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_daily_study_limit_check
  CHECK (daily_study_limit BETWEEN 1 AND 100);
```

既存行はPostgreSQL defaultにより20を持つ。`decks_update_owner` policyと `set_decks_updated_at` triggerは既存のまま列更新にも適用されるため、RLS追加は不要。

### TypeScript database type

`frontend/src/types/database.ts` の `decks` を更新する。

- `Row.daily_study_limit: number`
- `Insert.daily_study_limit?: number`
- `Update.daily_study_limit?: number`

## 4. SRSキュー設計

### 公開契約

既存呼び出しを明示的なlimit objectへ移行する。

```ts
export interface SessionQueueLimits {
  newLimit: number;
  dailyStudyLimit: number;
}

export function buildSessionQueue(
  cards: readonly CardWithState[],
  today: string,
  limits: SessionQueueLimits
): SessionQueue
```

S-05の3引数契約は維持し、第3引数の意味を数値からlimit objectに更新する。既存呼び出しはS-17内で全て移行する。

### 制限ルール

1. `newLimit` は現行と同じく `finite -> floor -> max(0)`、無効値は0。
2. `dailyStudyLimit` も `finite -> floor -> max(0)`、無効値は0。
3. 入力配列を1回走査し、分類ごとに全候補を入力順で集める。
4. `remaining = normalizedDailyStudyLimit` から開始する。
5. `queue.due = dueCandidates.slice(0, remaining)`。
6. `remaining -= queue.due.length`。
7. `queue.learn = learnCandidates.slice(0, remaining)`。
8. `remaining -= queue.learn.length`。
9. `queue.new = newCandidates.slice(0, Math.min(normalizedNewLimit, remaining))`。
10. `queue.retry = []`。

この設計により、`Due` が総上限を満たした日は `Learn` と `New` は当日の新規セッションに入らない。キューに入らなかったカードの `review_states` は変更しないため、翌日以降または次の開始判定で再度候補になる。

## 5. 当日残り枠

`daily_study_limit` を「セッション1回の上限」ではなく「JST日付ごとのデッキ内ユニークカード上限」として扱う。

`startStudySession()` は新規セッション作成前に次を計算する。

```text
studiedToday = count distinct deck_cards.card_id
  where review_states.user_id = userId
    and review_states.card_id belongs to deck
    and last_reviewed_at is within today's JST start/end

remainingToday = max(0, deck.daily_study_limit - studiedToday)
```

`remainingToday` を `buildSessionQueue(..., { newLimit: deck.new_limit_per_day, dailyStudyLimit: remainingToday })` へ渡す。これにより、同じ日に完了済みセッション後に再度開始しても、一日の上限を超える新規ユニーク出題を防ぐ。

active sessionが存在する場合は既存挙動どおり再利用する。既に作成済みのキューを途中で縮めると、学習再開と進捗表示が壊れるためである。

## 6. デッキ状態集計

`frontend/src/lib/srs/classify.ts` に今日の分類とは別の全体集計を追加する。

```ts
export interface DeckStudySummary {
  totalCards: number;
  learnedCards: number;
  scheduledCards: number;
}

export function summarizeDeckStudyState(
  cards: readonly CardWithState[],
  today: string
): DeckStudySummary
```

- `totalCards`: `cards.length`
- `learnedCards`: `reviewState !== null`
- `scheduledCards`: `reviewState !== null && reviewState.dueDate > today`

`countByCategory()` は今日の `New/Learn/Due` のまま維持する。UIでは「今日の学習対象」と「全体状態」を別のデータとして扱う。

## 7. Server Actions

### `deck-actions.ts`

型を拡張する。

```ts
export interface DeckWithCounts {
  id: string;
  name: string;
  counts: DeckCounts;
  totalCards: number;
  learnedCards: number;
  scheduledCards: number;
  dailyStudyLimit: number;
}

export interface DeckOverview {
  id: string;
  name: string;
  newLimitPerDay: number;
  dailyStudyLimit: number;
  studiedToday: number;
  remainingToday: number;
  counts: DeckCounts & { total: number };
  totalCards: number;
  learnedCards: number;
  scheduledCards: number;
}
```

`fetchOwnedDecks()` と `getDeckOverview()` のselectに `daily_study_limit` を追加する。

`getDecksWithCounts()` は `countByCategory()` と `summarizeDeckStudyState()` の両方を使う。

`getDeckOverview()` は同じ集計に加え、JST日付範囲で `studiedToday` と `remainingToday` を返す。

### 学習上限更新Action

`deck-actions.ts` にフォーム用Actionを追加する。

```ts
export type DeckStudyLimitActionState =
  | { status: "idle"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function updateDeckStudyLimit(
  previousState: DeckStudyLimitActionState,
  formData: FormData
): Promise<DeckStudyLimitActionState>
```

入力:

- `deckId`
- `dailyStudyLimit`

検証:

- `deckId` は空でない文字列。
- `dailyStudyLimit` は整数文字列としてparseできる。
- 範囲は1〜100。

処理:

```text
validate input
  -> auth.getUser()
  -> update decks set daily_study_limit = value where id = deckId and owner_user_id = user.id
  -> revalidatePath("/decks")
  -> revalidatePath(`/decks/${deckId}`)
  -> success state
```

未認証、所有外、DB errorは安全なerror stateにする。

### `session-actions.ts`

`DeckRow` と `requireOwnedDeck()` のselectに `daily_study_limit` を追加する。

新規セッション作成時:

```text
deck = requireOwnedDeck()
activeSession = fetchActiveSession()
if activeSession exists -> reuse
today = getTodayJST()
deckCards = fetchDeckCardsWithReviewStates()
studiedToday = countDeckCardsReviewedOnJstDate(deckCards, userId, today)
remainingToday = max(0, deck.daily_study_limit - studiedToday)
queue = buildSessionQueue(cards, today, {
  newLimit: deck.new_limit_per_day,
  dailyStudyLimit: remainingToday
})
if queue complete -> completed with empty/limit message
insert study_session
```

`countDeckCardsReviewedOnJstDate()` は `last_reviewed_at` のJST日付を `today` と比較する。既存 `frontend/src/lib/date.ts` にJST ISO変換ヘルパーが足りない場合は、既存テストに合わせて最小の純粋ヘルパーを追加する。

## 8. UI設計

### デッキ一覧 `DeckCard`

上段にデッキ名、右側または下段に今日の `New/Learn/Due` バッジを維持する。下段に全体状態を短く表示する。

```text
カード 12枚 / 学習済み 12枚 / 予定 12枚
```

`New/Learn/Due` がすべて0でも、この全体状態によりカード存在が分かる。

### デッキ詳細

セクションを分ける。

- 今日の学習: `New / Learn / Due` と `今日のカード: n枚`
- 全体状態: `カード総数`、`学習済み`、`将来予定`
- 学習設定: `一日最大 n枚` のフォーム、補助表示 `新規カード上限: m枚`

`counts.total === 0 && scheduledCards > 0` の場合は、無効ボタン下に「今日の学習はありません。次の予定カードがあります。」のように表示する。`totalCards === 0` の場合だけ、カード未登録の空状態として扱う。

### コンポーネント

`frontend/src/components/deck/DeckStudyLimitForm.tsx` を追加する。

- `"use client"`。
- `useFormState()` と `useFormStatus()` を使う。
- `type="number"`、`min={1}`、`max={100}`、`step={1}`。
- hidden `deckId` を持つ。
- 保存buttonは48px以上。
- errorは `role="alert"`。

## 9. Security / Failure Handling

- `daily_study_limit` 更新はRLSに加え、Actionで `owner_user_id = userId` を条件にする。
- 他owner deck IDでは更新件数0または `maybeSingle` nullを安全なerror stateにする。
- raw Supabase error、SQL、stack、token、他owner情報はUIへ出さない。
- migrationは `decks` の列追加とCHECK制約に限定し、`review_states` / `study_sessions` にDMLを行わない。

## 10. Impact Map

| 影響 | ファイル | 内容 |
|---|---|---|
| 直接 | `supabase/migrations/20260721000000_s17_daily_study_limit.sql` | `decks.daily_study_limit` 追加、CHECK制約 |
| 直接 | `frontend/src/types/database.ts` | `decks` 型更新 |
| 直接 | `frontend/src/lib/srs/types.ts` | `SessionQueueLimits`, `DeckStudySummary` 型 |
| 直接 | `frontend/src/lib/srs/classify.ts` | 全体状態集計関数追加 |
| 直接 | `frontend/src/lib/srs/queue.ts` | 総上限付きキュー構築 |
| 直接 | `frontend/src/actions/session-actions.ts` | daily limit取得、当日残枠計算、queue呼び出し更新 |
| 直接 | `frontend/src/actions/deck-actions.ts` | 詳細/一覧集計拡張、上限更新Action |
| 直接 | `frontend/src/components/deck/DeckCard.tsx` | 全体状態表示 |
| 直接 | `frontend/src/components/deck/DeckStudyLimitForm.tsx` | 上限設定フォーム |
| 直接 | `frontend/app/(auth)/decks/[deckId]/page.tsx` | 今日/全体/設定表示 |
| テスト | `frontend/src/lib/srs/queue.test.ts` | daily limit queue制限 |
| テスト | `frontend/src/lib/srs/classify.test.ts` | 将来予定/学習済み集計 |
| テスト | `frontend/src/actions/session-actions.test.ts` | start session上限、JST当日残枠 |
| テスト | `frontend/src/actions/deck-actions.test.ts` | 将来予定再現、上限更新Action |
| テスト | `frontend/src/components/deck/DeckCard.test.tsx` | 0カウントでも総数/予定表示 |
| テスト | `frontend/src/components/deck/DeckStudyLimitForm.test.tsx` | フォーム表示/状態 |
| テスト | `frontend/src/app/decks/[deckId]/page.test.tsx` | 今日/全体/設定表示 |
| テスト | `frontend/src/lib/srs/daily-study-limit-migration-contract.test.ts` | migration非破壊契約 |

## 11. Test Strategy

必須自動コマンド:

```bash
npm --prefix frontend run check
npm --prefix frontend run build
```

対象絞り込み:

```bash
npm --prefix frontend test -- src/lib/srs/queue.test.ts src/lib/srs/classify.test.ts src/actions/deck-actions.test.ts src/actions/session-actions.test.ts src/components/deck/DeckCard.test.tsx src/app/decks/[deckId]/page.test.tsx
```

DB migration:

```bash
npm --prefix frontend test -- src/lib/srs/daily-study-limit-migration-contract.test.ts
```

UI L3確認は `frontend/` で `npm exec -- next dev` を起動し、ログイン済みtest userで `/decks` と `/decks/{deckId}` をdesktop/mobileで確認する。Playwright scriptは現行packageにないため計画に含めない。

## 12. Rollback / Forward-fix

- code rollbackでUIとAction/SRS変更は戻せる。
- migration rollbackが必要な場合は `ALTER TABLE public.decks DROP CONSTRAINT decks_daily_study_limit_check; ALTER TABLE public.decks DROP COLUMN daily_study_limit;` だが、通常はforward-fixを優先する。
- `daily_study_limit` が厳しすぎる場合は、デッキ詳細フォームでユーザーが調整できる。

## 13. Unresolved Questions

- 一日の上限をユーザー単位に拡張するかはFuture。S-17は既存 `new_limit_per_day` と同じデッキ境界に揃える。
