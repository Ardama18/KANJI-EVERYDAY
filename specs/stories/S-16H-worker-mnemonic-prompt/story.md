# S-16H 画像生成ワーカーを承認済み slots 駆動の S-16B プロンプトに配線

親 Epic: E-16（#40）／issue #59。依存 S-16A(#41 `card_mnemonics`)、S-16B(#42 テンプレ正本
`frontend/src/lib/illustration/prompt.ts`)、S-11(#commit/worker)、#55(card_mnemonics owner 修正)。

## 背景

AI カード作成で実際に画像を生成しているのは Supabase Edge Function `ai-card-import-worker`
（`ILLUSTRATION_PROVIDER=openai` / `https://api.openai.com/v1/images/generations` / 1024x1024）。
そのプロンプトは `supabase/functions/_shared/ai-card-import/supabase.ts` の `parseClaimPrompt` →
`supabase/functions/_shared/illustration-prompt-policy.ts` の
`generateIllustrationPrompt(backText, skill)`（旧・汎用プロンプト）で組まれており、承認済み
`card_mnemonics.slots` も S-16B テンプレも使われていない。しかも旧プロンプトは
「文字・テキストは一切描かないでください。」を含み、漢字を主役にする E-16 の狙いと逆。

S-16E/S-16G が配線したのは frontend `triggerIllustrationGeneration` → `generator.ts` 経路だけで、
AI カード作成のワーカー経路は未配線。これが「AI カード作成の画像品質が悪い」の直接原因。

## ゴール

ワーカーの画像プロンプトを、承認済み `card_mnemonics.slots` 駆動の S-16B ニーモニック・
インフォグラフィック・テンプレート（漢字を主役／正確な字形／形の手掛かり／意味の手掛かり／
記憶の物語／構成／禁止事項＋末尾「画像内の文字は正確な『{kanji}』のみ・正方形・高解像度」）に
置き換える。複数字は S-16B と同様に部首→絵の 1 対 1 マッピングを外し、語全体 1 場面にする。

## 受入条件（AC）

- AC-1: `image_mode='ai'` かつ承認済み slots があるジョブで、生成プロンプトが S-16B テンプレ
  （承認 slots 差し込み・ブロック構成・末尾指定）になる。
- AC-2: 複数字 slots で【形の手掛かり】の部首→絵マッピングが出力されない。
- AC-3: 承認済み経路で旧汎用プロンプト（「文字・テキストは一切描かない」等）が使われない。
- AC-4: 未承認（slots 無し／不正形）ジョブの扱いが設計の決定どおりに動く。
- AC-5: 差し込み文字列のサニタイズと安全系（怖い/暴力/不適切の禁止）が維持される。
- AC-6: `npm --prefix frontend run check` 通過、Edge Function の `deno check` ゲート通過。

## Out of Scope

- 画像モデルの変更（`OPENAI_IMAGE_MODEL` 見直しは follow-up）。
- 承認 UI・下書き生成・表示（S-16C/D/F）の変更。
- 旧 ready 画像の一括再生成。
- remote への migration 適用（ship 時にユーザー判断で実施）。
