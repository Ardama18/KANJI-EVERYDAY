# S-16C ニーモニック＋説明の AI 下書き生成（OpenAI）

- Epic: E-16 漢字ニーモニック・インフォグラフィック画像 ＋ 答え側の説明表示（#40）
- GitHub Issue: #43
- 優先度: High
- 依存: S-16A（#41 `card_mnemonics` テーブル・正本データ形）・S-16B（#48 インフォグラフィックプロンプトテンプレート・`MnemonicSlots` 型）— いずれも main にマージ済み
- スコープ: `contracts.ts` / `output-mapper.ts` / `generate/route.ts` とそのテスト
- スコープ外: 承認 UI・保存（S-16D）、画像生成配線（S-16E）

## ユーザーストーリー

solo dev として、既存の `ai-card-generation`（OpenAI アダプタ・moderation・利用量予約）を再利用して、
ニーモニックの穴埋め（`slots`）と表示用説明（`explanation`）の「AI 下書き」を concept 単位で生成したい。
承認 UI（S-16D）がそのまま編集・保存できる下書きを、既存カード生成と同一リクエスト内で得るため。

## 背景

S-16A で `card_mnemonics`（`slots` / `explanation`）の正本データ形が確定し、S-16B で `MnemonicSlots` を
使うインフォグラフィックプロンプトテンプレートが導入された。S-16C は「その下書きを AI で作る」層で、
既存の OpenAI Responses 呼び出し・moderation・`reserve_provider_usage` を再利用し、新しい provider kind や
新しい moderation 段を増やさない。`mnemonicDraft` は後続 UI（S-16D）が未導入の間も既存 UI を壊さないよう
`PreviewEnvelope` に **optional** で載せる。

## データ形（正本・Epic #40 / S-16A 準拠）

```jsonc
// slots — 画像プロンプトの穴埋め（frontend/src/lib/illustration/prompt.ts の MnemonicSlots 正本）
{ "kanji": "見", "isSingleKanji": true,
  "shapeHint": { "part": "下の「見」", "picture": "目" },
  "meaningHint": "見る・気づく",
  "story": "目で見たものが頭の中で光って記憶に残る" }

// explanation — 表示用の説明（mappings は 2–4 件）
{ "summary": "目で見たものが、頭の中で光って記憶に残る。",
  "mappings": [
    { "part": "下の「見」", "meaning": "目で見る" },
    { "part": "上の光", "meaning": "頭の中で気づき、記憶する" } ] }
```

## 受入条件（サマリ）

1. OpenAI 応答の `mnemonic` が `slots` / `explanation` スキーマ（Epic #40 正本形）に適合し、`mappings` は 2–4 件。
2. moderation の input/output 両段を通過し、フラグ時は既存エラーコードで返る。
3. 利用量予約が既存同様に記録される（新 kind を作らない＝`card_generation` の枠内）。
4. 異常系（`mnemonic` 欠損・`mappings` 0 件/過多・過長）は既存エラー体系（`AiCardGenerationError` / `safeError` コード）で返る。
5. `npm --prefix frontend run check` 通過。
