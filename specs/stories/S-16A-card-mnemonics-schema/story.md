# S-16A 承認済みニーモニックの保存（card_mnemonics テーブル）

- Epic: E-16 漢字ニーモニック・インフォグラフィック画像 ＋ 答え側の説明表示（#40）
- GitHub Issue: #41
- 優先度: Critical
- スコープ: **スキーマのみ**（承認 UI・生成・表示・プロンプトテンプレートは S-16C/D/E/F の対象で本 Issue 対象外）

## ユーザーストーリー

solo dev として、承認済みのニーモニック穴埋め（画像プロンプト用 `slots`）と表示用の説明文（`explanation`）を
永続化したい。生成時（プロンプト組立）と表示時（説明表示）の両方から owner-scoped に読み書きできるようにするため。

## 背景

`illustrations` テーブルには説明列がなく、承認はカード作成時＝`illustrations` 行が存在する前に起きる。
そのため既存テーブルを拡張せず、独立テーブル `public.card_mnemonics` を新設する。

## データ形（正本・Epic #40 準拠）

```jsonc
// slots — 画像プロンプトの穴埋め
{ "kanji": "見", "isSingleKanji": true,
  "shapeHint": { "part": "下の「見」", "picture": "目" },
  "meaningHint": "見る・気づく",
  "story": "目で見たものが頭の中で光って記憶に残る" }

// explanation — 表示用の説明
{ "summary": "目で見たものが、頭の中で光って記憶に残る。",
  "mappings": [
    { "part": "下の「見」", "meaning": "目で見る" },
    { "part": "上の光", "meaning": "頭の中で気づき、記憶する" },
    { "part": "目から光へ伸びる線", "meaning": "見た情報が記憶になる" } ] }
```
