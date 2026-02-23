# S-08: イラスト生成バックエンド

# 要件概要

## 目的
- Gemini API（Nano Banana）を使って漢字カードのイラストを生成するバックエンド機能を実装する
- 生成結果を Supabase Storage に保存し、キャッシュとして再利用する
- illustrations テーブルで生成状態（pending/ready/failed）を管理する
- Server Actions（triggerIllustrationGeneration, getIllustrationUrl）を実装する

## 解決する課題
- 漢字の意味を視覚的に連想できるイラストの自動生成
- 生成結果のキャッシュにより、同じカードで繰り返し API を呼ばない
- 生成失敗時の状態管理と劣化動作の基盤

# 機能要件の詳細

## 1. プロンプトテンプレート

### ファイル構成（`src/lib/illustration/prompt.ts`）

#### `generatePrompt(backText: string, skill: 'reading' | 'writing'): string`

カードの正解テキスト（`back_text`）とスキル種別から、Gemini API に渡すプロンプトを生成する。

**プロンプト構成**:
```
[スタイル指定]
- シンプルでかわいいフラットイラスト
- 白い背景
- 小学生向けの明るい色使い
- 絵柄の一貫性を保つ（統一されたアートスタイル）

[コンテンツ指定]
- 「{backText}」の意味を視覚的に表現するイラスト
- 文字・テキストは一切描かない
- 1つの概念をシンプルに表現

[安全制約]
- 怖い表現、暴力的な表現は禁止
- 不適切な表現は禁止
- 子ども向けの安全なコンテンツのみ
```

**スキル別の調整**:
- `reading`: 漢字の意味（back_text はひらがな）を視覚化
- `writing`: 漢字の意味（back_text は漢字を含む単語）を視覚化
- 実質的に同じ概念を視覚化するため、プロンプトの大きな差異はない

#### `sanitizePromptInput(text: string): string`

ユーザー入力由来のテキストをサニタイズ:
- プロンプトインジェクション対策（制御文字の除去）
- 最大長制限（100文字）

## 2. Gemini API 連携

### ファイル構成（`src/lib/illustration/gemini-client.ts`）

#### `generateIllustration(prompt: string): Promise<Buffer | null>`

Gemini API（Nano Banana）を呼び出してイラスト画像を生成する。

**処理フロー**:
1. Gemini API に画像生成リクエストを送信
2. 成功: 画像データ（Buffer）を返す
3. 失敗（API エラー、レート制限、安全フィルタ拒否）: null を返す

**API 設定**:
- モデル: Gemini Nano Banana（画像生成対応モデル）
- 出力形式: PNG
- 画像サイズ: 512x512 程度（モバイル表示に十分、ストレージ節約）

**エラーハンドリング**:
- API キー未設定: 起動時に警告ログ、生成リクエストはスキップ
- レート制限: null を返し、呼び出し側で failed ステータスに
- 安全フィルタ拒否: null を返し、model_info にフィルタ情報を記録
- ネットワークエラー: null を返し、model_info にエラー情報を記録

### 環境変数
- `GEMINI_API_KEY`: Gemini API キー（サーバー専用、`NEXT_PUBLIC_` 付けない）

## 3. Supabase Storage 操作

### ファイル構成（`src/lib/illustration/storage.ts`）

#### `uploadIllustration(imageBuffer: Buffer, storagePath: string): Promise<boolean>`

生成されたイラスト画像を Supabase Storage にアップロードする。

**処理フロー**:
1. `illustrations` バケットに画像をアップロード
2. Content-Type: `image/png`
3. 成功: true、失敗: false

#### `getSignedUrl(storagePath: string, expiresIn?: number): Promise<string | null>`

Supabase Storage の Signed URL を発行する。

**パラメータ**:
- `storagePath`: Storage 内のファイルパス
- `expiresIn`: 有効期限（秒）、デフォルト 3600（1時間）

**処理フロー**:
1. `supabase.storage.from('illustrations').createSignedUrl(storagePath, expiresIn)`
2. 成功: Signed URL 文字列を返す
3. 失敗: null を返す

### Storage パス規則
- 公開カード用: `public/{illustration_id}.png`
- 個人カード用: `{user_id}/{illustration_id}.png`

### バケット設定
- バケット名: `illustrations`
- アクセス: 非公開（private）
- Signed URL でのみ閲覧可能

## 4. イラスト生成フロー（統合処理）

### ファイル構成（`src/lib/illustration/generator.ts`）

#### `processIllustrationGeneration(illustrationId: string, illustrationKey: string, backText: string, skill: 'reading' | 'writing', ownerUserId: string | null): Promise<void>`

非同期でイラスト生成の全工程を実行する。

**処理フロー**:
1. `generatePrompt(backText, skill)` でプロンプト生成
2. `generateIllustration(prompt)` で Gemini API 呼び出し
3. 成功の場合:
   a. Storage パスを決定（ownerUserId が null なら `public/`、あれば `{userId}/`）
   b. `uploadIllustration(imageBuffer, storagePath)` で Storage にアップロード
   c. illustrations テーブルを更新: `status='ready'`, `storage_path`, `prompt`, `model_info`
4. 失敗の場合:
   a. illustrations テーブルを更新: `status='failed'`, `prompt`, `model_info`（エラー情報）

## 5. Server Actions

### ファイル構成（`src/actions/illustration-actions.ts`）

#### `triggerIllustrationGeneration(cardId: string): Promise<void>`

カードのイラスト生成をトリガーする。

**処理フロー**:
1. 認証チェック
2. カード情報を取得（card_id → illustration_key, back_text, skill, owner_user_id）
3. illustrations テーブルで既存レコードを確認:
   - `status='ready'` → 何もしない（既に生成済み）
   - `status='pending'` → 何もしない（生成中）
   - `status='failed'` → pending にリセットして再生成
   - レコードなし → pending レコードを INSERT
4. `processIllustrationGeneration` を非同期で呼び出し（await しない）
   - Next.js の `waitUntil` や `after` を使用してバックグラウンド実行
   - または Supabase Edge Function へのデリゲート（将来の選択肢）

#### `getIllustrationUrl(illustrationKey: string): Promise<string | null>`

イラストの Signed URL を取得する。

**処理フロー**:
1. illustrations テーブルで `illustration_key` に一致するレコードを検索
2. `status='ready'` かつ `storage_path` が存在 → `getSignedUrl(storagePath)` を返す
3. それ以外 → null を返す

## 6. illustrations テーブル状態管理

### 状態遷移図

```
(レコードなし) → pending → ready
                    ↓
                  failed → pending（リトライ時）
```

### 各状態の意味
- **レコードなし**: まだ生成要求されていない
- **pending**: 生成処理中（Gemini API 呼び出し中）
- **ready**: 生成完了、Storage にアップロード済み
- **failed**: 生成失敗（API エラー、安全フィルタ拒否等）

### テーブル操作
- INSERT (pending): `triggerIllustrationGeneration` で新規作成
- UPDATE (ready): `processIllustrationGeneration` 成功時
- UPDATE (failed): `processIllustrationGeneration` 失敗時
- UPDATE (pending): failed → リトライ時

# 技術要件

## ファイル構成

```
src/lib/illustration/
  prompt.ts          # プロンプトテンプレート + サニタイズ
  gemini-client.ts   # Gemini API クライアント
  storage.ts         # Supabase Storage 操作
  generator.ts       # 生成フロー統合処理
  index.ts           # バレルエクスポート
src/actions/
  illustration-actions.ts  # Server Actions
```

## 非同期生成の実装方法

MVP では以下の方法で非同期実行:
- Next.js の `after()` API（Next.js 15+）を使用して、レスポンス送信後にバックグラウンド処理
- `revealCard` のレスポンスにはプレースホルダ情報を含め、生成完了は次回 reveal 時に反映

## セキュリティ要件
- `GEMINI_API_KEY` はサーバー専用環境変数（`NEXT_PUBLIC_` 付けない）
- プロンプトインジェクション対策（`sanitizePromptInput`）
- Signed URL は1時間有効（短時間で失効）
- illustrations テーブルの RLS: 公開イラスト（owner_user_id IS NULL）は全員閲覧可、個人イラストは owner のみ

## テスト要件（`src/lib/illustration/*.test.ts`）

### プロンプト生成テスト

| テスト | 入力 | 期待 |
|--------|------|------|
| 読みカード | backText="あたたかい", skill="reading" | プロンプトに「あたたかい」が含まれる |
| 書きカード | backText="温かい", skill="writing" | プロンプトに「温かい」が含まれる |
| 安全制約が含まれる | 任意 | プロンプトに「文字を描かない」「怖い表現禁止」が含まれる |
| サニタイズ | 制御文字入り | 制御文字が除去される |
| 長すぎるテキスト | 200文字テキスト | 100文字に切り詰め |

### 状態管理テスト

| テスト | 初期状態 | 操作 | 期待結果 |
|--------|---------|------|---------|
| 新規生成開始 | レコードなし | trigger | pending レコード作成 |
| 生成成功 | pending | process(成功) | ready, storage_path 設定 |
| 生成失敗 | pending | process(失敗) | failed, model_info にエラー |
| リトライ | failed | trigger | pending にリセット |
| 既に ready | ready | trigger | 何もしない |
| 既に pending | pending | trigger | 何もしない |

### Gemini API テスト（モック）

| テスト | モック動作 | 期待 |
|--------|----------|------|
| 正常生成 | Buffer を返す | Buffer が返る |
| API エラー | throw | null が返る |
| API キー未設定 | env 未設定 | null が返る、警告ログ |
