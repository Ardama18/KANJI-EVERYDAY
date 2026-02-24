# S-06: デッキ一覧 & デッキ概要

# 要件概要

## 目的
- デッキ一覧画面で、今日の学習量（New/Learn/Due）を一目で把握できるようにする
- デッキ概要画面で、内訳を確認してから「はじめる」ボタンで学習画面への導線に進めるようにする（実セッション処理は S-07）
- Server Actions（getDecksWithCounts, getDeckOverview）を実装し、SSR でデータ取得する

## 解決する課題
- ユーザーが「今日何をどれだけやるか」を即座に把握できる
- デッキ選択→学習画面遷移のスムーズな導線を提供する（S-06 は導線とプレースホルダまで）

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
- 2段階取得で `new/learn/due` を返す（デッキ0件時は1クエリ、デッキ1件以上は最大2クエリ）

## 2. デッキ概要画面（`/decks/[deckId]`）

### 画面概要
1つのデッキの学習内訳を表示し、「はじめる」ボタンで学習画面へ遷移する導線を提供する（実セッション作成は S-07）。

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
- タップで `/decks/[deckId]/study` へ遷移（S-06 では導線のみ）
- `/decks/[deckId]/study` は S-06 でプレースホルダ画面を表示し、404 を回避する
- `startStudySession` は S-06 では呼び出さない（実処理は S-07）
- 今日のカードが0件の場合: 「今日の学習は完了しています」メッセージ + ボタン非活性

### データ取得
- Server Component で `getDeckOverview(deckId)` を呼び出し、SSR で描画
- デッキが存在しない or 他ユーザーのデッキ → 404 ページ

## 3. Server Actions

### `getDecksWithCounts()`（`src/actions/deck-actions.ts`）

**処理フロー**:
1. 認証チェック（未認証 → エラー）
2. ユーザーの全デッキを取得（`decks` テーブル、`owner_user_id = auth.uid()`）
3. 取得結果が0件なら空配列を返す（クエリ総数は1回）
4. デッキ1件以上なら、deckId 群を使って `deck_cards + review_states` をまとめて取得する（2段階目）
5. 2段階目の結果をメモリでデッキごとに束ね、`countByCategory` で New/Learn/Due をカウント
6. 結果を返す（クエリ総数は最大2回）

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
- カウントが0の場合も必ず表示し、グレー背景（`bg-gray-* text-gray-*`）で統一

# 技術要件

## ページ構成

| ファイル | 種別 | 説明 |
|---------|------|------|
| `app/(auth)/decks/page.tsx` | Server Component | デッキ一覧ページ |
| `app/(auth)/decks/[deckId]/page.tsx` | Server Component | デッキ概要ページ |
| `app/(auth)/decks/[deckId]/study/page.tsx` | Server Component | S-06用プレースホルダページ（404回避） |
| `src/actions/deck-actions.ts` | Server Actions | getDecksWithCounts, getDeckOverview |
| `src/components/deck/DeckCard.tsx` | Client Component | デッキ一覧の1行 |

## データ取得最適化
- デッキ一覧: 2段階取得を固定（1段階目: デッキ一覧、2段階目: deckId 群のカード/ReviewState）。クエリ数は最大2回（デッキ0件時は1回）
- デッキ概要: 1デッキ分のデータを取得

## セキュリティ
- Server Actions 内で `auth.uid()` を検証
- RLS に加え、アプリケーション層でも `owner_user_id` チェック
- 他ユーザーのデッキ ID を直接指定してもアクセス不可

## エラーハンドリング
- 認証切れ: `/login` へリダイレクト（固定）
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
