# S-07: 学習セッションフロー

# 要件概要

## 目的
- Anki風の学習フロー（表→Show Answer→裏→3段階評価）を実装し、「まいにち漢字」のコア体験を完成させる
- セッション管理 Server Actions（startStudySession, getNextCard, revealCard, rateCard）を実装する
- 評価ボタンに次回目安（◯日後）を表示し、学習者が復習感覚を掴めるようにする

## 解決する課題
- 入力なしで漢字の読み・書きを反復練習できる学習体験の実現
- SRS ロジック（S-05）をセッション管理と統合し、実際の学習サイクルを回す
- ❌評価時の当日再提示（retry_queue）を含むセッション管理の完全実装

# 機能要件の詳細

## 1. 学習セッション開始

### トリガー
デッキ概要画面（S-06）の「はじめる」ボタンタップで `startStudySession` を呼び出す。

### 処理フロー（`startStudySession(deckId: string)`）
1. 認証チェック
2. デッキの所有者チェック
3. 既存のアクティブセッション確認（`finished_at IS NULL` かつ同一デッキ）
   - あれば既存セッションを再開（新規作成しない）
4. デッキ内カード + ReviewState を取得
5. `buildSessionQueue` でキューを構築（S-05 のロジック使用）
6. `study_sessions` テーブルに INSERT（キューを JSONB で保存）
7. 作成したセッション ID を返す
8. `/decks/[deckId]/study?session=[sessionId]` へ遷移

## 2. カード表示（表面 = 問題）

### 処理フロー（`getNextCard(sessionId: string)`）
1. 認証チェック + セッション所有者チェック
2. セッションの JSONB キューを読み取り
3. `getNextCardId(queue)` で次のカード ID と source を取得
4. カード ID が null → セッション完了（`finished_at` を更新）
5. カード情報（`cards` テーブル）を取得
6. セッションの `current_card_id` と `revealed = false` を更新
7. 表面情報のみ返す

**レスポンス型**:
```
interface CardFrontData {
  sessionId: string
  cardId: string
  skill: 'reading' | 'writing'
  pattern: 'R1' | 'W1'
  frontText: string
  progress: {
    current: number    // 何枚目
    total: number      // 全カード数
    remaining: number  // 残りカード数
  }
}
| null  // セッション完了
```

### 表面の表示
- **R1（読みカード）**: 漢字を含む単語を大きく表示（例: 「温かい」）
  - ラベル: 「よみがなは？」
- **W1（書きカード）**: ひらがなを大きく表示（例: 「あたたかい」）
  - ラベル: 「かんじでかくと？」
- テキストのみ（イラスト表示禁止）
- 進捗バー or テキスト（例: 「3 / 18」）

### 操作
- 「答えを見る」ボタン（大サイズ、画面下部固定）

## 3. カード表示（裏面 = 答え合わせ）

### 処理フロー（`revealCard(sessionId: string)`）
1. 認証チェック + セッション所有者チェック
2. `current_card_id` が設定されていること + `revealed = false` を確認
3. `revealed = true` に更新
4. カードの裏面情報を取得
5. 現在の ReviewState を取得（なければ null = 初回）
6. `getIntervalPreview(reviewState)` で各ボタンの次回目安を計算
7. 裏面情報 + 次回目安を返す（イラストは E-03 で追加、ここでは null）

**レスポンス型**:
```
interface CardBackData {
  cardId: string
  skill: 'reading' | 'writing'
  pattern: 'R1' | 'W1'
  frontText: string
  backText: string
  illustrationUrl: string | null  // E-03 で追加、ここでは常に null
  intervalPreview: IntervalPreview
}
```

### 裏面の表示
- **R1**: 正解のひらがな読みを大きく表示（例: 「あたたかい」）
- **W1**: 正解の漢字を大きく表示（例: 「温かい」）
- イラスト領域: プレースホルダ（「イラスト準備中」テキスト or アイコン）
  - E-03 で実装後、ここに実際のイラストが表示される
- 3つの評価ボタン（次回目安付き）

## 4. 評価（3段階）

### 処理フロー（`rateCard(sessionId: string, rating: Rating)`）
1. 認証チェック + セッション所有者チェック
2. `current_card_id` が設定されていること + `revealed = true` を確認
3. `review_states` から現在の状態を取得（なければ null）
4. `calculateRating(state, rating, today)` で新しい状態を計算（S-05）
5. `review_states` を UPSERT（INSERT ON CONFLICT UPDATE）
6. `addToRetryQueue` が true → セッションの `queue_retry` に追加
7. 現在のキューから消化済みカードを削除（`dequeueCard`）
8. セッションの JSONB キューを更新
9. `current_card_id = null`, `revealed = false` にリセット
10. 自動的に次のカードを取得して返す（`getNextCard` 相当の処理）

**レスポンス型**:
```
interface RateResult {
  nextCard: CardFrontData | null  // null ならセッション完了
}
```

### 評価ボタンの表示

3つ固定、横並び:

| ボタン | アイコン | ラベル | 次回目安 | カラー |
|--------|---------|--------|---------|--------|
| Again | ❌ | むり | 「今日さいご + 明日」 | 赤系 |
| Hard | ⚠️ | あやしい | 「◯日後」 | 黄系 |
| Good | ✅ | できた | 「◯日後」 | 緑系 |

- ボタンは左から Again → Hard → Good の順
- 次回目安は各ボタンの下に小さめのテキストで表示

## 5. セッション完了

### 表示
全キューが空になったら完了画面を表示:
- 「今日の学習おわり！」メッセージ
- 学習結果サマリー:
  - 学習したカード数
- 「デッキ一覧にもどる」ボタン → `/decks`

### データ更新
- `study_sessions.finished_at = now()` に更新

## 6. セッション中断・再開

### 中断
- ブラウザを閉じる or 「戻る」でセッションから離脱
- セッションの状態は DB に保存されているため、データは失われない

### 再開
- デッキ概要の「はじめる」ボタンで、アクティブセッション（`finished_at IS NULL`）があれば再開
- 再開時は `current_card_id` が設定されていればそのカードから、なければ `getNextCard` で次のカードから

# 技術要件

## ページ構成

| ファイル | 種別 | 説明 |
|---------|------|------|
| `app/(auth)/decks/[deckId]/study/page.tsx` | Server Component | 学習ページシェル |
| `src/components/study/StudyClient.tsx` | Client Component | 学習フロー全体を管理 |
| `src/components/study/CardFront.tsx` | Client Component | カード表面 |
| `src/components/study/CardBack.tsx` | Client Component | カード裏面 |
| `src/components/study/RatingButtons.tsx` | Client Component | 3段階評価ボタン |
| `src/components/study/SessionComplete.tsx` | Client Component | セッション完了画面 |
| `src/actions/session-actions.ts` | Server Actions | startStudySession, getNextCard, revealCard, rateCard |

## 学習画面のレンダリング戦略

### Server Component シェル（`page.tsx`）
- URL から `deckId` と `sessionId` を取得
- セッションが有効か検証
- `StudyClient` に初期データを渡す

### Client Component（`StudyClient.tsx`）
- 学習フローの状態管理（表示中のカード、表/裏切り替え、ローディング）
- Server Actions の呼び出し（`revealCard`, `rateCard`）
- 状態遷移: 表面 → (Show Answer) → 裏面 → (評価) → 次の表面 or 完了

### 状態管理
```
type StudyState =
  | { phase: 'front'; card: CardFrontData }
  | { phase: 'back'; card: CardFrontData; backData: CardBackData }
  | { phase: 'complete' }
  | { phase: 'loading' }
```

## Server Actions の実装

### トランザクション整合性
- `rateCard` 内の ReviewState 更新 + キュー更新は、可能な限り1つのクエリで実行
- Supabase の RPC（Postgres 関数）を使うか、Sequential な UPDATE で実装

### 認証チェック共通化
```
async function requireAuth(): Promise<string> {
  // Supabase から auth.uid() を取得
  // 未認証なら throw or redirect
}
```

### セッション所有者チェック共通化
```
async function requireSessionOwner(sessionId: string, userId: string): Promise<StudySession> {
  // セッション取得 + user_id チェック
  // 不一致なら throw
}
```

## パフォーマンス要件
- `rateCard` → 次カード表示: 200ms 以内を目標
- `rateCard` のレスポンスに次カードデータを含めることで、追加の `getNextCard` 呼び出しを省略
- ローディング状態は最小限の表示（スピナー or スケルトン）

# UIデザイン仕様

## 学習画面（表面）

```
┌─────────────────────────────────┐
│ ← 小学3年生の漢字     3 / 18     │
├─────────────────────────────────┤
│                                   │
│         よみがなは？               │
│                                   │
│           温かい                   │
│         （大きなテキスト）           │
│                                   │
│                                   │
│                                   │
│  ┌─────────────────────────┐      │
│  │      答えを見る            │      │
│  └─────────────────────────┘      │
└─────────────────────────────────┘
```

- 問題テキスト: 中央、大きめフォント（32px 以上）
- スキルラベル: 問題テキストの上に小さく
- 「答えを見る」ボタン: 画面下部固定、全幅、高さ 56px 以上

## 学習画面（裏面）

```
┌─────────────────────────────────┐
│ ← 小学3年生の漢字     3 / 18     │
├─────────────────────────────────┤
│                                   │
│           温かい                   │
│         あたたかい                 │
│        （大きなテキスト）            │
│                                   │
│   ┌───────────────────┐          │
│   │  イラスト準備中       │          │
│   │  (プレースホルダ)     │          │
│   └───────────────────┘          │
│                                   │
│  ❌ むり    ⚠️ あやしい   ✅ できた  │
│  今日+明日    3日後        7日後    │
└─────────────────────────────────┘
```

- 正解テキスト: 中央、大きめフォント
- 問題テキスト: 正解の上に小さめで表示（参照用）
- イラスト領域: 正解テキストの下、角丸ボックス、プレースホルダ
- 評価ボタン: 画面下部固定、横3分割
  - 各ボタン: アイコン + ラベル + 次回目安（小テキスト）
  - 最小タッチターゲット: 48px × 48px
  - 横幅は均等3分割

## セッション完了画面

```
┌─────────────────────────────────┐
│                                   │
│         🎉                        │
│    今日の学習おわり！              │
│                                   │
│    18枚のカードを学習しました      │
│                                   │
│  ┌─────────────────────────┐      │
│  │   デッキ一覧にもどる       │      │
│  └─────────────────────────┘      │
│                                   │
└─────────────────────────────────┘
```

## アニメーション・トランジション
- カード切り替え時: フェードまたはスライドトランジション（シンプルに）
- 評価ボタンタップ後: 即座に次カードを表示（テンポ最優先）
- ローディング: 軽量なスケルトン or スピナー

## レスポンシブ
- モバイル: 全幅、ボタンは画面下部固定
- タブレット: 最大幅 `max-w-lg`、中央寄せ
