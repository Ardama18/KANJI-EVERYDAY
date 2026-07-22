# S-16E 生成トリガーを承認済みスロット駆動に改修

親 Epic: E-16（#40）。依存 S-16A(#41)/S-16B(#42)/S-16D(#44) は main にマージ済み。

## 背景

画像生成が承認済みニーモニックを使うよう配線する。現状は `cards.back_text`/`cards.skill`
から生成時にプロンプトを組むが、これを承認済み `card_mnemonics.slots`（S-16A）＋新テンプレ
（S-16B の `generatePrompt(slots)`）駆動に改める。**承認が無ければ生成しない（旧イラストは温存）**。

## 受入条件（AC）

- AC-1: 承認済み slots のとき、新テンプレ（S-16B `generatePrompt`）で組んだプロンプトが Gemini に渡る。
- AC-2: 承認レコード（owner + illustration_key + status='approved'）が無い illustration_key では
  pending 行が作られず、生成が起動しない（`{ ok: true, started: false }` を返す）。
- AC-3: 既存の ready 画像は変化しない（旧イラスト温存）。
- AC-4: 生成成功で `illustrations.status='ready'`・storage_path 設定、失敗時の model_info 記録は現行同様。
- AC-5: `npm --prefix frontend run check` 通過。
