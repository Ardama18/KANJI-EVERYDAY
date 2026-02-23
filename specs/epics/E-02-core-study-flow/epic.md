# E-02: 学習コアフロー

## エピック概要

Anki風の学習フローUI と間隔反復（SRS）ロジックを実装する。デッキ一覧→デッキ概要→学習（問題→Show Answer→3段階評価）の一連のフローを完成させ、「まいにち漢字」の中核体験を提供する。

### 目的
- Anki風の学習フロー（表→Show Answer→裏→3段階評価）を実装する
- 間隔反復（SRS）により、復習間隔を自動管理する
- デッキ一覧で今日の学習量（New/Learn/Due）を一目で把握できるようにする
- スマホで親指操作しやすい、テンポの良い学習体験を実現する

### スコープ

**含むもの**:
- デッキ一覧画面（New/Learn/Due カウント表示）
- デッキ概要画面（内訳確認→「はじめる」ボタン）
- 学習画面（表→Show Answer→裏→3段階評価）
- SRS ロジック（固定テーブル方式: Good/Hard/Again）
- セッション管理（キュー構築・消化・retry）
- Server Actions（startStudySession, getNextCard, revealCard, rateCard）
- 評価ボタンに次回目安（◯日後）を表示
- 出題パターン: R1（単語読み）、W1（ひらがな→漢字）
- 読み・書きの復習状態を別管理

**含まないもの**:
- 認証・DB基盤（E-01 で完了済み前提）
- イラスト表示（E-03。裏面にイラスト領域のプレースホルダのみ設置）
- R2（文中読み）、W2（穴埋め）パターン（Phase 2 以降）
- 統計・レポート（Phase 3 以降）

## 技術スタック

- **フレームワーク**: Next.js (App Router), React, Tailwind CSS
- **サーバーロジック**: Next.js Server Actions
- **レンダリング**: SSR（Server Components）+ Client Components（学習操作部分）
- **バックエンド**: Supabase Postgres（E-01 で構築済み）
- **テスト**: Vitest

## 共通設計方針

### 画面構成

| 画面 | パス | レンダリング |
|------|------|-------------|
| デッキ一覧 | `/decks` | Server Component（SSR） |
| デッキ概要 | `/decks/[deckId]` | Server Component（SSR） |
| 学習 | `/decks/[deckId]/study` | Server Component シェル + Client Component |

### 入力なし「つもり運用」
- 読み：声に出して読んだつもり / 書き：紙に書いた・空書きしたつもり
- アプリ操作は **Show Answer → 3択評価（❌ むり / ⚠️ あやしい / ✅ できた）** のみ

### 評価ボタンの表示
- ✅ できた：`GOOD_INTERVALS[level]日後`
- ⚠️ あやしい：`HARD_INTERVALS[level]日後`
- ❌ むり：固定「今日さいご + 明日」

## ストーリー間で共有する設計・実装

### SRS ロジック

**固定テーブル**:
- `GOOD_INTERVALS = [1, 3, 7, 14, 30, 60, 120]`（日）
- `HARD_INTERVALS = [1, 2, 4, 7, 14, 30, 60]`（日）

**更新ルール**:

| 評価 | interval | level | due_date | 追加動作 |
|------|----------|-------|----------|---------|
| ✅ できた | `GOOD_INTERVALS[level]` | `min(level+1, max)` | `today + interval` | なし |
| ⚠️ あやしい | `HARD_INTERVALS[level]` | 据え置き | `today + interval` | なし |
| ❌ むり | - | `0` | `tomorrow` | retry_queue に追加（当日最後に再提示） |

**❌ むりの無限ループ防止**: `retry_today_count` 上限（同日2回まで）

### セッション管理

**出題順**: `due → learn → new → retry（最後）`

**キュー構築**（セッション開始時）:
1. `queue_due`: `level >= 2` かつ `due_date <= today` のカード
2. `queue_learn`: `level <= 1` かつ `due_date <= today` のカード
3. `queue_new`: ReviewState が無いカード（`new_limit_per_day` 以内）
4. `queue_retry`: 空（❌評価時に動的追加）

### Server Actions

```
src/actions/
  deck-actions.ts    ... getDecksWithCounts, getDeckOverview
  session-actions.ts ... startStudySession, getNextCard, revealCard, rateCard
```

- `getDecksWithCounts()`: デッキ一覧 + New/Learn/Due 集計
- `getDeckOverview(deckId)`: 1デッキの内訳 + 設定
- `startStudySession(deckId)`: セッション作成 + キュー構築
- `getNextCard(sessionId)`: 次カード（表のみ）取得。全キュー空なら完了
- `revealCard(sessionId)`: 裏情報 + 各ボタンの次回目安を返す（イラストは E-03 で追加）
- `rateCard(sessionId, rating)`: ReviewState 更新 + retry キュー操作

### カード状態の分類（表示カウント用）
- **New**: ReviewState がまだ無いカード
- **Learn**: ReviewState あり、`level <= 1` かつ `due_date <= today`
- **Due**: ReviewState あり、`level >= 2` かつ `due_date <= today`

### 共通コンポーネント
- `src/components/study/CardFront.tsx`: カード表面（問題テキスト + Show Answer ボタン）
- `src/components/study/CardBack.tsx`: カード裏面（正解テキスト + イラスト領域 + 評価ボタン）
- `src/components/study/RatingButtons.tsx`: 3段階評価ボタン（次回目安表示付き）
- `src/components/deck/DeckCard.tsx`: デッキ一覧の1行（名前 + New/Learn/Due）

## セキュリティ要件

- Server Actions 内で必ず認証チェックを行う
- セッション ID の所有者チェック（他ユーザーのセッションを操作不可）
- RLS に加え、アプリケーション層でもデータアクセスを制御

## パフォーマンス要件

- rate → 次カード表示のレイテンシを最小化（Server Actions の応答速度優先）
- セッション内のカード情報は study_sessions の JSONB キューで管理し、カード取得時の DB クエリを最小化
- スマホで親指操作しやすいボタンサイズ（最小 48px タッチターゲット）

## テスト戦略

- SRS ロジック（level/due_date 更新）: Vitest で単体テスト（最優先）
- セッションキュー操作（出題順、retry 追加、完了判定）: Vitest で単体テスト
- Server Actions: Vitest でロジックテスト
- 学習フロー UI: 手動確認（MVP段階）

## 想定リスクと対策

| リスク | 影響度 | 発生確率 | 対策 |
|-------|--------|---------|------|
| SRS パラメータが子どもに合わない | 中 | 中 | 固定テーブル方式で後から調整容易 |
| セッション中のブラウザ離脱でキューが中断 | 中 | 高 | セッションを DB に保存しているため、再開可能な設計 |
| retry_queue の無限ループ | 高 | 低 | retry_today_count 上限（同日2回）で防止 |

## このエピックのストーリー

- [S-05](../../stories/S-05-srs-engine/) - SRS 計算ロジック（固定テーブル、レベル更新、キュー管理）+ 単体テスト
- [S-06](../../stories/S-06-deck-list-and-overview/) - デッキ一覧画面（New/Learn/Due カウント）、デッキ概要画面（内訳 +「はじめる」ボタン）
- [S-07](../../stories/S-07-study-session-flow/) - 学習画面（表→Show Answer→裏→3段階評価）、セッション管理、評価ボタン（次回目安表示）
