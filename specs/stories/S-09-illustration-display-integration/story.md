# S-09: イラスト表示統合

# 要件概要

## 目的
- E-02 の学習フロー（revealCard, CardBack）にイラスト表示を統合する
- 答え合わせ時（裏面）にイラストを正解テキストと同時に表示する
- イラスト未生成（pending）・生成失敗（failed）時はプレースホルダを表示し、学習を止めない
- Signed URL によるセキュアなイラスト閲覧を実現する

## 解決する課題
- 学習フロー内でイラストを自然に提示し、漢字の意味の視覚的連想を補強する
- E-02 で設置したプレースホルダ領域を実際のイラスト表示に差し替える
- 生成状態に応じた適切な表示制御（ready/pending/failed）

# 機能要件の詳細

## 1. revealCard Server Action の拡張

### 現行（E-02 実装済み、S-07）
`revealCard(sessionId)` は以下を返す:
- `backText`: 正解テキスト
- `illustrationUrl: null`（常に null）
- `intervalPreview`: 評価ボタンの次回目安

### 拡張後
`revealCard(sessionId)` の処理に以下を追加:

**追加処理フロー**:
1. カードの `illustration_key` を取得
2. `illustration_key` が null → `illustrationUrl: null`（イラスト対象外）
3. `illustration_key` が存在:
   a. illustrations テーブルで状態を確認
   b. `status='ready'` → `getSignedUrl(storagePath)` で Signed URL を取得
   c. `status='pending'` → `illustrationUrl: null`（生成中、プレースホルダ表示）
   d. `status='failed'` → `illustrationUrl: null`（失敗、プレースホルダ表示）
   e. レコードなし → `triggerIllustrationGeneration(cardId)` を非同期で呼び出し + `illustrationUrl: null`
4. `illustrationStatus` フィールドを追加して状態を UI に伝える

**拡張後のレスポンス型**:
```
interface CardBackData {
  cardId: string
  skill: 'reading' | 'writing'
  pattern: 'R1' | 'W1'
  frontText: string
  backText: string
  illustrationUrl: string | null       // Signed URL（ready 時のみ）
  illustrationStatus: 'ready' | 'pending' | 'generating' | 'failed' | 'none'
  intervalPreview: IntervalPreview
}
```

**illustrationStatus の意味**:
- `ready`: イラスト利用可能（`illustrationUrl` にURL設定済み）
- `pending`: 既に生成処理中（次回 reveal 時に表示される可能性）
- `generating`: 今回の reveal で生成をトリガーした（初回生成開始）
- `failed`: 生成失敗
- `none`: イラスト対象外（`illustration_key` が null）

## 2. CardBack コンポーネントの更新

### 現行（E-02 実装済み、S-07）
プレースホルダ:「イラスト準備中」テキスト or アイコン

### 更新後
`illustrationStatus` と `illustrationUrl` に基づいた表示分岐:

#### `ready` 状態
- `<img>` タグで Signed URL の画像を表示
- 画像サイズ: 幅 100%（最大 280px）、高さ自動
- 角丸: `rounded-lg`
- 読み込み中: スケルトンプレースホルダ（画像のローディング表示）
- 読み込み失敗（Signed URL 期限切れ等）: プレースホルダにフォールバック

#### `pending` / `generating` 状態
- プレースホルダ表示:
  - 薄いグレー背景の角丸ボックス
  - 中央にローディングアイコン（スピナー）
  - テキスト:「イラストを準備しています...」
  - アニメーション: パルスアニメーション（`animate-pulse`）

#### `failed` 状態
- プレースホルダ表示:
  - 薄いグレー背景の角丸ボックス
  - 中央にアイコン（画像アイコン）
  - テキスト:「イラストは準備中です」
  - ※ユーザーには「失敗」ではなく「準備中」と表示（子ども向け配慮）

#### `none` 状態
- イラスト領域を表示しない（スペースを詰める）

### コンポーネント構成

#### `IllustrationDisplay`（`src/components/study/IllustrationDisplay.tsx`）

新規コンポーネント。CardBack 内で使用。

**Props**:
```
interface IllustrationDisplayProps {
  illustrationUrl: string | null
  illustrationStatus: 'ready' | 'pending' | 'generating' | 'failed' | 'none'
}
```

**実装**:
- `status === 'none'` → null を返す（非表示）
- `status === 'ready' && illustrationUrl` → `<Image>` コンポーネントで表示
- `status === 'pending' || status === 'generating'` → ローディングプレースホルダ
- `status === 'failed'` → 静的プレースホルダ
- 画像ロード時の `onError` ハンドラで、読み込み失敗時にプレースホルダにフォールバック

## 3. 画像の最適化

### Next.js Image コンポーネント
- Supabase Storage の Signed URL を `<Image>` コンポーネントの `src` に使用
- `next.config.ts` の `images.remotePatterns` に Supabase Storage のドメインを追加
- `width` / `height` を指定（512x512、生成時のサイズに合わせる）
- `sizes` 属性: `(max-width: 768px) 280px, 280px`

### 設定（`next.config.ts`）
```
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: '*.supabase.co',
      pathname: '/storage/v1/object/sign/**',
    },
  ],
}
```

## 4. 学習フローへの影響

### 表面（問題）
- **変更なし**: イラストは表面では絶対に表示しない（E-02 と同じ）

### 裏面（答え合わせ）
- 正解テキストの下にイラスト領域を配置
- イラスト → 評価ボタンの順で縦に積む
- イラストの有無で評価ボタンの位置が変わるが、ボタンは常に画面下部固定

### テンポへの影響
- イラスト表示は revealCard のレスポンスに含まれるため、追加の API 呼び出しは不要
- 画像の読み込みは非同期（テキスト情報は即座に表示、画像は遅延ロード可能）
- `priority` 属性は付けない（学習テキストの表示速度を優先）

# 技術要件

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/actions/session-actions.ts` | `revealCard` にイラスト取得ロジックを追加 |
| `src/components/study/CardBack.tsx` | `IllustrationDisplay` コンポーネントを組み込み |
| `src/components/study/IllustrationDisplay.tsx` | 新規作成: イラスト表示コンポーネント |
| `next.config.ts` | `images.remotePatterns` に Supabase Storage を追加 |

## 新規ファイル

| ファイル | 説明 |
|---------|------|
| `src/components/study/IllustrationDisplay.tsx` | イラスト表示 / プレースホルダコンポーネント |

## セキュリティ要件
- Signed URL は revealCard のレスポンスでのみ返す（表面には含めない）
- Signed URL の有効期限: 1時間（学習セッション中に十分な時間）
- 画像 URL はクライアントに露出するが、一時的なアクセストークンのため問題なし

## パフォーマンス要件
- revealCard のレスポンス時間に対するイラスト関連処理のオーバーヘッド: 50ms 以内を目標
  - illustrations テーブル SELECT: 軽量
  - Signed URL 生成: 軽量（Supabase SDK のローカル処理）
  - 生成トリガー（非同期）: レスポンスをブロックしない
- 画像の遅延ロード: `loading="lazy"` を指定し、テキスト表示を優先

# UIデザイン仕様

## 裏面レイアウト（イラスト統合後）

```
┌─────────────────────────────────┐
│ ← 小学3年生の漢字     3 / 18     │
├─────────────────────────────────┤
│                                   │
│           温かい                   │
│         あたたかい                 │
│                                   │
│   ┌───────────────────┐          │
│   │                     │          │
│   │   [イラスト画像]      │          │
│   │   280 x 280          │          │
│   │                     │          │
│   └───────────────────┘          │
│                                   │
│  ❌ むり    ⚠️ あやしい   ✅ できた  │
│  今日+明日    3日後        7日後    │
└─────────────────────────────────┘
```

### イラスト表示エリア
- 最大幅: 280px
- 角丸: `rounded-xl`
- 中央寄せ
- 正解テキストと評価ボタンの間に配置
- 背景: 白（画像が無い場合はグレー）

### プレースホルダ（pending/generating）
```
┌───────────────────┐
│                     │
│     ⟳ (スピナー)    │
│  イラストを準備       │
│  しています...       │
│                     │
└───────────────────┘
```
- サイズ: 280 x 200px（画像より低い高さでスペース節約）
- 背景: `bg-gray-100`
- テキスト: `text-gray-400`
- アニメーション: `animate-pulse`

### プレースホルダ（failed）
```
┌───────────────────┐
│                     │
│     🖼 (アイコン)   │
│  イラストは準備中     │
│  です                │
│                     │
└───────────────────┘
```
- サイズ: 280 x 200px
- 背景: `bg-gray-50`
- テキスト: `text-gray-300`
- アニメーションなし（静的）

## テスト要件

### IllustrationDisplay コンポーネントテスト

| テスト | 入力 | 期待 |
|--------|------|------|
| ready 状態 | url="https://...", status="ready" | img タグが表示される |
| pending 状態 | url=null, status="pending" | スピナー + テキスト表示 |
| generating 状態 | url=null, status="generating" | スピナー + テキスト表示 |
| failed 状態 | url=null, status="failed" | アイコン + テキスト表示 |
| none 状態 | url=null, status="none" | 何も表示しない |
| 画像ロード失敗 | url="invalid", status="ready" | プレースホルダにフォールバック |

### revealCard 拡張テスト

| テスト | illustrations 状態 | 期待 |
|--------|-------------------|------|
| ready | status=ready, storage_path あり | illustrationUrl に Signed URL、status=ready |
| pending | status=pending | illustrationUrl=null, status=pending |
| failed | status=failed | illustrationUrl=null, status=failed |
| レコードなし | レコードなし | illustrationUrl=null, status=generating、生成トリガー |
| illustration_key なし | カードに illustration_key 未設定 | illustrationUrl=null, status=none |
