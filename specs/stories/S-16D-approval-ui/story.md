# S-16D 承認 UI（AiCardForm/AiCardImportClient へ編集・承認欄追加 → card_mnemonics 保存）

- Epic: E-16 漢字ニーモニック・インフォグラフィック画像 ＋ 答え側の説明表示（#40）
- GitHub Issue: #44
- 優先度: High
- 依存: S-16A（#41 `card_mnemonics` テーブル・RLS）・S-16C（#43 `PreviewEnvelope.mnemonicDraft`（conceptId 単位））— いずれも main にマージ済み
- スコープ: AI カードインポートの承認 UI（`AiCardImportClient` / mnemonic 承認欄）＋ commit 経路（route/service/repository）＋ commit RPC の mnemonic 対応 ＋ 関連テスト
- スコープ外: 画像生成トリガー（S-16E）・答え側表示（S-16F）・Remote MCP 経由承認

## ユーザーストーリー

solo dev として、S-16C が返す `mnemonicDraft`（concept 単位の `slots` / `explanation`）を、
既存 AI カード生成プレビュー（`AiCardImportClient` + `AiCardForm`）で編集・承認し、commit 時に
owner スコープで `card_mnemonics`（`status='approved'`）へ保存したい。
ハイブリッド方針（AI 下書き → 人が承認）の「人が承認」側を成立させ、S-16E の画像生成へ確定データを渡すため。

## 背景（Verified Current State）

- `AiCardImportClient.tsx`（`frontend/app/(auth)/decks/[deckId]/ai/new/`）が preview→commit の実オーケストレータ。
  `AiCardForm` は生成フォームのみ。commit は `/api/ai/imports/commit` へ POST する。
- 現状 `AiCardImportClient` の `parseGeneratedResult` は `mnemonicDraft` を破棄している（client 境界で落ちる）。
- `illustration_key` は commit RPC `commit_generated_import_async` 内で
  `'s11:' || batchId || ':' || sha256hex(conceptId)` として **サーバ側で採番**される（image_mode≠'none' の concept のみ）。
  `batchId` は commit ごとにランダム UUID → client には確定不能。`none` の concept は `illustration_key = NULL`。
- commit は **非同期**（RPC は 202 で `{batchId,status:'queued'}` を返し、カードは worker が後で作成）。
  ただし illustration 行（＝ key の materialization）は commit RPC 内で同期的に作られる。
- preview-token は `{v,userId,reservationKey,importRequestHash,expiresAt}` を HMAC 署名。
  `importRequestHash` は request items（conceptId/front/back/image/tags/deck）を被覆するが **mnemonic 内容は含まない**。

## 受入条件（サマリ）

1. 下書き（S-16C 出力）を初期値として concept 単位で編集し、承認して commit できる。
2. commit 後 `card_mnemonics` に `status='approved'` の行が owner スコープで保存される（`illustration_key` は RPC 採番値と一致）。
3. `explanation.mappings` は 2–4 件で追加・削除でき、範囲外は保存前に弾く（client＋server 両方）。
4. 未承認 commit では `card_mnemonics` に書かれず、UI に「ニーモニック未承認：画像は生成されません」を明示する。
5. 他 owner のデータは読めない/書けない（RLS が最終防衛線、owner は認証セッション由来）。
6. `npm --prefix frontend run check` 通過。
