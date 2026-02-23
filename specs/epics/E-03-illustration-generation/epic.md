# E-03: イラスト生成・表示

## エピック概要

Gemini API（Nano Banana）を使って漢字カードのイラストを生成し、学習の答え合わせ時に表示する機能を実装する。イラストは連想補強のために裏面でのみ提示し、生成結果は Supabase Storage にキャッシュして再利用する。

### 目的
- 漢字の意味を視覚的に連想できるイラストを生成・提供する
- イラストを答え合わせ時（裏面）にのみ表示し、問題中のヒント化を防ぐ
- 生成結果をキャッシュし、同じカードで繰り返し生成しない
- イラスト未生成・生成失敗でも学習を止めない（劣化動作）

### スコープ

**含むもの**:
- Gemini API（Nano Banana）によるイラスト生成
- Supabase Storage へのイラスト保存（非公開バケット）
- Signed URL によるイラスト閲覧
- illustrations テーブルによる生成状態管理（pending/ready/failed）
- reveal 時のイラスト取得・表示（E-02 の revealCard を拡張）
- プレースホルダ表示（pending/failed 時）
- プロンプト制約の実装

**含まないもの**:
- イラストの手動アップロード（Phase 2 以降）
- イラストの編集・差し替え UI
- 生成済みイラストの一括管理画面

## 技術スタック

- **イラスト生成**: Gemini API（Nano Banana）
- **ストレージ**: Supabase Storage（非公開バケット `illustrations`）
- **サーバーロジック**: Next.js Server Actions
- **テスト**: Vitest

## 共通設計方針

### イラスト表示ルール（必須）
- **表（問題）では絶対に表示しない**
- **裏（答え合わせ）で正解テキストと同時に表示**
- 未生成（pending）時はプレースホルダを表示し、学習を止めない
- 生成失敗（failed）時もプレースホルダを表示

### 生成タイミング
- `revealCard` 実行時に `illustrations` テーブルを確認
- `ready` → Signed URL を生成して返す
- レコードなし → `pending` レコードを作成し、非同期で生成開始。プレースホルダを返す
- `failed` → プレースホルダを返す（リトライは別途検討）

### プロンプト制約
- 文字（テキスト）を描かない
- 背景はシンプル
- 怖い/暴力/不適切な表現は禁止
- 絵柄の一貫性を重視（プロンプトテンプレートで統一）

## ストーリー間で共有する設計・実装

### illustrations テーブル活用

```
status: 'pending' | 'ready' | 'failed'
storage_path: '{user_id}/{id}.png'  -- ただし公開カードは 'public/{id}.png'
```

### イラスト生成フロー

```
revealCard()
  → illustrations テーブル確認
  → ready: Signed URL を返す
  → なし: pending レコード作成 → 非同期生成トリガー → プレースホルダを返す
  → failed: プレースホルダを返す

非同期生成:
  → Gemini API 呼び出し（プロンプト制約適用）
  → 成功: Storage にアップロード → status='ready', storage_path 更新
  → 失敗: status='failed', model_info にエラー情報記録
```

### Storage 設計
- バケット名: `illustrations`
- アクセス: 非公開（private）
- 閲覧: Signed URL（有効期限: 1時間程度）
- パス: `public/{illustration_id}.png`（公開カード用）/ `{user_id}/{illustration_id}.png`（個人カード用）

### Server Actions 拡張

```
src/actions/
  illustration-actions.ts ... getIllustrationUrl, triggerIllustrationGeneration
```

- `getIllustrationUrl(illustrationKey)`: ready なら Signed URL、それ以外なら null
- `triggerIllustrationGeneration(cardId)`: pending 作成 + 非同期生成開始

E-02 の `revealCard` を拡張し、イラスト URL を返すように修正。

### プロンプトテンプレート

```
src/lib/illustration/prompt.ts
```

- カードの `back_text`（正解）と `skill`（reading/writing）を基にプロンプト生成
- 共通制約（文字なし、シンプル背景、安全コンテンツ）を付与

## セキュリティ要件

- Gemini API キーはサーバー専用環境変数で管理（`GEMINI_API_KEY`）
- Signed URL は短時間有効（1時間程度）
- 不適切コンテンツの生成防止（プロンプト制約 + Gemini の安全フィルタ）

## パフォーマンス要件

- イラスト生成は非同期で行い、学習フローをブロックしない
- 生成済みイラストは Storage キャッシュにより再生成しない
- Signed URL の発行は軽量（reveal のレイテンシに影響を与えない）

## テスト戦略

- プロンプト生成ロジック: Vitest で単体テスト
- イラスト状態管理（pending/ready/failed 遷移）: Vitest で単体テスト
- Gemini API 呼び出し: モック使用のテスト + 手動で実 API 確認
- Signed URL 発行: 統合テストまたは手動確認

## 想定リスクと対策

| リスク | 影響度 | 発生確率 | 対策 |
|-------|--------|---------|------|
| Gemini API の生成品質が不安定 | 中 | 中 | プロンプト制約で品質担保、failed 時はプレースホルダ |
| Gemini API のレート制限 | 中 | 中 | 非同期生成 + キャッシュで API 呼び出し回数を最小化 |
| 不適切なイラストが生成される | 高 | 低 | プロンプト制約 + Gemini 安全フィルタ + 将来的に管理者確認 |
| Storage 容量の肥大化 | 低 | 低 | Phase 2 以降でライフサイクル管理を検討 |

## このエピックのストーリー

- [S-08](../../stories/S-08-illustration-generation-backend/) - Gemini API 連携、プロンプトテンプレート、Supabase Storage アップロード、illustrations 状態管理
- [S-09](../../stories/S-09-illustration-display-integration/) - revealCard 拡張、CardBack イラスト表示、Signed URL、プレースホルダ表示
