# S-05: SRS エンジン

# 要件概要

## 目的
- 間隔反復（SRS）の計算ロジックを純粋関数として実装する
- セッション内のキュー管理ロジック（出題順、retry 追加、完了判定）を実装する
- UI や DB に依存しない純粋ロジック層として構築し、単体テストで品質を保証する

## 解決する課題
- 3段階評価（Good/Hard/Again）に基づく復習間隔の自動計算
- セッション内でのカード出題順序管理（due → learn → new → retry）
- ❌（Again）評価時の当日再提示と無限ループ防止

# 機能要件の詳細

## 1. 固定テーブル定数

### 間隔テーブル（`src/lib/srs/constants.ts`）

```
GOOD_INTERVALS = [1, 3, 7, 14, 30, 60, 120]  // 日
HARD_INTERVALS = [1, 2, 4, 7, 14, 30, 60]     // 日
MAX_GOOD_LEVEL = 6  // GOOD_INTERVALS.length - 1
MAX_HARD_LEVEL = 6  // HARD_INTERVALS.length - 1
RETRY_TODAY_LIMIT = 2  // 同日再提示の上限回数
```

### 評価値（Rating）
```
type Rating = 'good' | 'hard' | 'again'
```

## 2. ReviewState 更新ロジック

### 型定義（`src/lib/srs/types.ts`）

```
interface ReviewState {
  level: number          // 0..MAX_GOOD_LEVEL
  dueDate: string        // YYYY-MM-DD（JST基準）
  lastRating: Rating | null
  retryTodayCount: number
  lastReviewedAt: string | null  // ISO 8601
}

interface RatingResult {
  newState: ReviewState
  addToRetryQueue: boolean  // true なら retry_queue に追加
}

interface IntervalPreview {
  good: { interval: number; label: string }   // 例: { interval: 3, label: "3日後" }
  hard: { interval: number; label: string }   // 例: { interval: 1, label: "1日後" }
  again: { label: string }                    // 固定: { label: "今日さいご + 明日" }
}
```

### 計算関数（`src/lib/srs/calculate.ts`）

#### `calculateRating(state: ReviewState | null, rating: Rating, today: string): RatingResult`

**✅ Good**:
- `interval = GOOD_INTERVALS[state.level]`（state が null の場合は level=0）
- `newState.dueDate = addDaysJST(today, interval)`
- `newState.level = min(state.level + 1, MAX_GOOD_LEVEL)`
- `newState.lastRating = 'good'`
- `newState.retryTodayCount = state?.retryTodayCount ?? 0`（変更なし）
- `newState.lastReviewedAt = new Date().toISOString()`
- `addToRetryQueue = false`

**⚠️ Hard**:
- `interval = HARD_INTERVALS[state.level]`（state が null の場合は level=0）
- `newState.dueDate = addDaysJST(today, interval)`
- `newState.level = state?.level ?? 0`（据え置き）
- `newState.lastRating = 'hard'`
- `newState.retryTodayCount = state?.retryTodayCount ?? 0`（変更なし）
- `newState.lastReviewedAt = new Date().toISOString()`
- `addToRetryQueue = false`

**❌ Again**:
- `newState.dueDate = getTomorrowJST(today)`
- `newState.level = 0`
- `newState.lastRating = 'again'`
- `newState.retryTodayCount = (state?.retryTodayCount ?? 0) + 1`
- `newState.lastReviewedAt = new Date().toISOString()`
- `addToRetryQueue = newState.retryTodayCount <= RETRY_TODAY_LIMIT`

**初回レビュー（state が null）**:
- level=0 として扱い、上記ルールを適用

#### `getIntervalPreview(state: ReviewState | null): IntervalPreview`

評価ボタンに表示する「次回目安」を計算:
- `good`: `{ interval: GOOD_INTERVALS[level], label: "${interval}日後" }`
- `hard`: `{ interval: HARD_INTERVALS[level], label: "${interval}日後" }`
- `again`: `{ label: "今日さいご + 明日" }`

※ `level` は `state?.level ?? 0`

## 3. カード分類ロジック

### 型定義

```
type CardCategory = 'new' | 'learn' | 'due'

interface CardWithState {
  cardId: string
  reviewState: ReviewState | null  // null = New
}
```

### 分類関数（`src/lib/srs/classify.ts`）

#### `classifyCard(reviewState: ReviewState | null, today: string): CardCategory`

- `reviewState === null` → `'new'`
- `reviewState.level <= 1 && reviewState.dueDate <= today` → `'learn'`
- `reviewState.level >= 2 && reviewState.dueDate <= today` → `'due'`
- `reviewState.dueDate > today` → 該当なし（今日の対象外）

#### `countByCategory(cards: CardWithState[], today: string): { new: number; learn: number; due: number }`

デッキ内のカードをカテゴリ別にカウント。デッキ一覧・デッキ概要の表示に使用。

## 4. セッションキュー管理ロジック

### 型定義（`src/lib/srs/queue.ts`）

```
interface SessionQueue {
  due: string[]      // card_id の配列
  learn: string[]
  new: string[]
  retry: string[]
}
```

### キュー構築関数

#### `buildSessionQueue(cards: CardWithState[], today: string, newLimit: number): SessionQueue`

1. 全カードを分類（classifyCard）
2. `due`: due カードの card_id 配列
3. `learn`: learn カードの card_id 配列
4. `new`: new カードの card_id 配列（`newLimit` 件まで）
5. `retry`: 空配列

### キュー消化関数

#### `getNextCardId(queue: SessionQueue): { cardId: string | null; source: 'due' | 'learn' | 'new' | 'retry' | null }`

出題順に従い次のカード ID を返す:
1. `queue.due` の先頭があれば返す（source: 'due'）
2. `queue.learn` の先頭があれば返す（source: 'learn'）
3. `queue.new` の先頭があれば返す（source: 'new'）
4. `queue.retry` の先頭があれば返す（source: 'retry'）
5. 全キュー空 → `{ cardId: null, source: null }`（セッション完了）

#### `dequeueCard(queue: SessionQueue, source: 'due' | 'learn' | 'new' | 'retry'): SessionQueue`

指定 source の先頭カードを削除した新しいキューを返す（イミュータブル）。

#### `addToRetryQueue(queue: SessionQueue, cardId: string): SessionQueue`

retry キューの末尾に cardId を追加した新しいキューを返す。

#### `isSessionComplete(queue: SessionQueue): boolean`

全キューが空なら true。

# 技術要件

## ファイル構成

```
src/lib/srs/
  constants.ts    # 固定テーブル、制限値
  types.ts        # 型定義（ReviewState, Rating, etc.）
  calculate.ts    # SRS 計算ロジック（calculateRating, getIntervalPreview）
  classify.ts     # カード分類ロジック（classifyCard, countByCategory）
  queue.ts        # キュー管理ロジック（buildSessionQueue, getNextCardId, etc.）
  index.ts        # バレルエクスポート
```

## 設計原則
- 全関数は純粋関数（副作用なし、同じ入力 → 同じ出力）
- DB アクセスなし（引数で必要なデータを受け取る）
- `today` パラメータは外部から注入（テスト容易性）
- イミュータブルなデータ操作（キューの更新は新しいオブジェクトを返す）
- JST 日付ユーティリティ（`src/lib/date.ts`、S-04 で実装済み）に依存

## テスト要件（`src/lib/srs/*.test.ts`）

### calculateRating テスト

| テスト | 入力 | 期待出力 |
|--------|------|---------|
| Good: level 0 → 1 | state={level:0}, rating=good | dueDate=today+1, level=1 |
| Good: level 1 → 2 | state={level:1}, rating=good | dueDate=today+3, level=2 |
| Good: level 6（max） | state={level:6}, rating=good | dueDate=today+120, level=6 |
| Hard: level 据え置き | state={level:2}, rating=hard | dueDate=today+4, level=2 |
| Again: level リセット | state={level:3}, rating=again | dueDate=tomorrow, level=0, addToRetryQueue=true |
| Again: retry上限超過 | state={level:0, retryTodayCount:2}, rating=again | addToRetryQueue=false |
| 初回レビュー: Good | state=null, rating=good | dueDate=today+1, level=1 |
| 初回レビュー: Again | state=null, rating=again | dueDate=tomorrow, level=0, addToRetryQueue=true |

### classifyCard テスト

| テスト | 入力 | 期待出力 |
|--------|------|---------|
| New | reviewState=null | 'new' |
| Learn: level 0, due today | level=0, dueDate=today | 'learn' |
| Learn: level 1, due today | level=1, dueDate=today | 'learn' |
| Due: level 2, due today | level=2, dueDate=today | 'due' |
| 対象外: due tomorrow | level=2, dueDate=tomorrow | 今日の対象外 |

### キュー管理テスト

| テスト | 期待動作 |
|--------|---------|
| 出題順 | due → learn → new → retry の順で消化 |
| retry 追加 | addToRetryQueue で末尾に追加 |
| セッション完了 | 全キュー空で isSessionComplete=true |
| newLimit | new カードが newLimit 件に制限される |

### getIntervalPreview テスト

| テスト | 入力 | 期待出力 |
|--------|------|---------|
| level 0 | state={level:0} | good: "1日後", hard: "1日後", again: "今日さいご + 明日" |
| level 2 | state={level:2} | good: "7日後", hard: "4日後", again: "今日さいご + 明日" |
| null（初回） | state=null | good: "1日後", hard: "1日後", again: "今日さいご + 明日" |
