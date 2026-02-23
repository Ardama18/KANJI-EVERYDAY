# S-06: デッキ一覧 & デッキ概要

# 要件概要

## 目的
- デッキ一覧画面で、今日の学習量（New/Learn/Due）を一目で把握できるようにする
- デッキ概要画面で、内訳を確認してから「はじめる」ボタンで学習を開始できるようにする
- Server Actions（getDecksWithCounts, getDeckOverview）を実装し、SSR でデータ取得する

## 解決する課題
- ユーザーが「今日何をどれだけやるか」を即座に把握できる
- デッキ選択→学習開始のスムーズな導線を提供する

# 機能要件の詳細

## 1. デッキ一覧画面（`/decks`）

### 画面概要
認証済みユーザーのデッキを一覧表示し、各デッキの今日の学習内訳（New/Learn/Due）をカウント表示する。

### 表示要素

#### ヘッダー
- アプリ名: 「まいにち漢字」
- ログアウトボタン（右上）

#### デッキリスト
各デッキ行に以下を表示:
- **デッキ名**（例: 「小学3年生の漢字」）
- **New カウント**: 青色バッジ（新規カード数）
- **Learn カウント**: 赤色バッジ（定着途中カード数）
- **Due カウント**: 緑色バッジ（復習期限カード数）
- デッキ行タップで `/decks/[deckId]`（デッキ概要）へ遷移

#### 空状態
- デッキが0件の場合: 「デッキがまだありません」メッセージを表示

### カウント計算
S-05 の `countByCategory` 関数を使用:
- **New**: そのデッキ内で ReviewState が無いカード数
- **Learn**: ReviewState あり、`level <= 1` かつ `due_date <= today` のカード数
- **Due**: ReviewState あり、`level >= 2` かつ `due_date <= today` のカード数

### データ取得
- Server Component で `getDecksWithCounts()` を呼び出し、SSR で描画
- ユーザーの全デッキ + 各デッキの New/Learn/Due を1回のデータ取得で返す

## 2. デッキ概要画面（`/decks/[deckId]`）

### 画面概要
1つのデッキの学習内訳を表示し、「はじめる」ボタンで学習セッションを開始する。

### 表示要素

#### ヘッダー
- 戻るボタン（← デッキ一覧へ）
- デッキ名

#### 内訳表示
- **New**: 新規カード数（青色）
- **Learn**: 定着途中カード数（赤色）
- **Due**: 復習期限カード数（緑色）
- **合計**: 今日の学習カード数

#### 開始ボタン
- 「はじめる」ボタン（大サイズ、プライマリカラー）
- タップで学習セッションを開始（`startStudySession` Server Action を呼び出し）
- セッション作成成功後、`/decks/[deckId]/study` へ遷移
- 今日のカードが0件の場合: 「今日の学習は完了しています」メッセージ + ボタン非活性

### データ取得
- Server Component で `getDeckOverview(deckId)` を呼び出し、SSR で描画
- デッキが存在しない or 他ユーザーのデッキ → 404 ページ

## 3. Server Actions

### `getDecksWithCounts()`（`src/actions/deck-actions.ts`）

**処理フロー**:
1. 認証チェック（未認証 → エラー）
2. ユーザーの全デッキを取得（`decks` テーブル、`owner_user_id = auth.uid()`）
3. 各デッキについて:
   a. `deck_cards` でデッキ内のカード ID を取得
   b. 各カードの `review_states` を取得（`user_id = auth.uid()`）
   c. `countByCategory` で New/Learn/Due をカウント
4. 結果を返す

**レスポンス型**:
```
interface DeckWithCounts {
  id: string
  name: string
  counts: {
    new: number
    learn: number
    due: number
  }
}
```

### `getDeckOverview(deckId: string)`（`src/actions/deck-actions.ts`）

**処理フロー**:
1. 認証チェック
2. デッキ取得（`id = deckId`, `owner_user_id = auth.uid()`）
3. デッキが存在しない → null を返す
4. デッキ内カード + ReviewState を取得
5. `countByCategory` で New/Learn/Due をカウント
6. 結果を返す

**レスポンス型**:
```
interface DeckOverview {
  id: string
  name: string
  newLimitPerDay: number
  counts: {
    new: number
    learn: number
    due: number
    total: number  // new + learn + due
  }
}
```

## 4. コンポーネント

### `DeckCard`（`src/components/deck/DeckCard.tsx`）
- デッキ一覧の1行コンポーネント
- Props: `{ deck: DeckWithCounts }`
- デッキ名 + New/Learn/Due バッジ
- `<Link href={`/decks/${deck.id}`}>` でラップ

### カウントバッジ
- New: 青色背景（`bg-blue-500 text-white`）
- Learn: 赤色背景（`bg-red-500 text-white`）
- Due: 緑色背景（`bg-green-500 text-white`）
- カウントが0の場合は非表示またはグレーアウト

# 技術要件

## ページ構成

| ファイル | 種別 | 説明 |
|---------|------|------|
| `app/(auth)/decks/page.tsx` | Server Component | デッキ一覧ページ |
| `app/(auth)/decks/[deckId]/page.tsx` | Server Component | デッキ概要ページ |
| `src/actions/deck-actions.ts` | Server Actions | getDecksWithCounts, getDeckOverview |
| `src/components/deck/DeckCard.tsx` | Client Component | デッキ一覧の1行 |

## データ取得最適化
- デッキ一覧: 1回の SQL クエリで全デッキ + カード数 + ReviewState を取得（可能な限り JOIN で集約）
- デッキ概要: 1デッキ分のデータを取得

## セキュリティ
- Server Actions 内で `auth.uid()` を検証
- RLS に加え、アプリケーション層でも `owner_user_id` チェック
- 他ユーザーのデッキ ID を直接指定してもアクセス不可

## エラーハンドリング
- 認証切れ: ログインページへリダイレクト
- デッキ不存在: 404 ページ表示（`notFound()` 使用）

# UIデザイン仕様

## デッキ一覧画面

### レイアウト
- 全幅レイアウト（モバイルファースト）
- デッキリスト: カード形式で縦に積む
- 各カードの高さ: 最小 72px（タッチターゲット確保）

### カード行デザイン
```
┌─────────────────────────────────┐
│ 小学3年生の漢字                    │
│              New: 10  Learn: 3  Due: 5 │
└─────────────────────────────────┘
```
- デッキ名: 左寄せ、太字
- カウントバッジ: 右寄せ、小さめの丸角バッジ

## デッキ概要画面

### レイアウト
```
┌─────────────────────────────────┐
│ ← 小学3年生の漢字                  │
├─────────────────────────────────┤
│                                   │
│   New     Learn     Due           │
│   10       3         5            │
│                                   │
│   今日のカード: 18枚               │
│                                   │
│  ┌─────────────────────────┐      │
│  │      はじめる              │      │
│  └─────────────────────────┘      │
│                                   │
└─────────────────────────────────┘
```

- カウント: 大きめの数字で中央寄せ、色分け表示
- 「はじめる」ボタン: 全幅、大サイズ（高さ 56px 以上）、プライマリカラー
- 0件時: ボタンをグレーアウトし「今日の学習は完了しています」テキスト

### レスポンシブ
- モバイル: 全幅、縦積み
- タブレット: 最大幅 `max-w-lg` 程度、中央寄せ
