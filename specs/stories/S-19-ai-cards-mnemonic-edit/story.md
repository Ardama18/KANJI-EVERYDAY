# S-19 /ai/cards のニーモニック表示・編集と不要 UI の削除

親 Epic: E-16（#40）／issue #64。親 Story: S-13（AIカード管理・#14）。
依存: S-16A（`card_mnemonics` テーブルと owner-scoped RLS・#47）、S-16D（承認 UI と `isMnemonicEntryValid`・#50）、
S-13（`list_ai_managed_cards` RPC と `/ai/cards` UI）、S-18（イラストサムネイル表示・#61/#62）。
関連 ADR: ADR-012（初回書き込み境界）、ADR-013（本 Story で追加した編集書き込み境界）。

## 背景

`/ai/cards`（AIカード管理）で編集できるのは表・裏・種類・形式・デッキ・タグ・イラスト選択だけで、
S-16 で導入したニーモニック（覚え方の説明）は**表示すらされていない**。
編集手段は作成時の承認 UI（`frontend/src/components/ai-card-import/MnemonicApprovalList.tsx`）のみで、
登録後は変更できない。承認をそのまま通した分を後から直す動線が存在しない。

一覧 RPC `list_ai_managed_cards` は `illustrations.illustration_key = cards.illustration_key` で
既に join 済みで key を取得しているが、返却 JSON へ射影していない
（`supabase/migrations/20260719000001_s13_ai_card_management_undo.sql:124-127`）。
`card_mnemonics` の主キーは `(owner_user_id, illustration_key)` なので、
key を射影するだけで mnemonic を同 RPC で返せる状態にある。

あわせて、同じ画面にある使えない UI が 2 つある。

- イラスト選択: 候補を `イラスト 8f3a1c2d` のように UUID 先頭 8 桁で並べるだけで、実質選べない。
- 「登録バッチを取り消す」: 確認文が実装を誤って説明している。文面は部分適用のように読めるが、
  `undo_import_internal` はバッチ内に編集済みカードが 1 枚でもあれば `CARD_MODIFIED` で全体を中止する
  （`supabase/migrations/20260719000001_s13_ai_card_management_undo.sql:605-612`）。
  個別削除・複数選択削除と機能も重複している。

## ゴール

`/ai/cards` の各カードで、承認済みニーモニックを表示し、その場で編集して保存できるようにする。
保存内容は `status='approved'` として `card_mnemonics` に確定し、学習画面の説明表示（S-16F 経路）へ反映される。
あわせて上記 2 つの使えない UI を画面から外す。RPC と service 層は Remote MCP が使うため残し、
UI と UI 専用の Server Action だけを消す。

イラスト画像の再生成は本 Story では行わない（`ai_illustration_objects` への新しい特権書き込み口が必要で、
リスクが釣り合わない。詳細は requirements.md の Out of Scope）。

## 受入条件（AC）

正本は `requirements.md` の AC-1〜AC-17。要約は次のとおり。

- 表示・編集: 承認済み mnemonic の 7 項目と `mappings` 全件を表示し、編集・保存できる（AC-1, AC-3）。
  未登録カードは「未設定」でフォームを出さない（AC-2）。保存内容は学習画面へ反映される（AC-4）。
- 検証: 上限違反は保存前に拒否し `card_mnemonics` へ書き込まない（AC-5）。
  所有していない `cardId`、または `cardId` と一致しない `illustrationKey` は `NOT_FOUND`（AC-6）。
- 共有表示: `mnemonicSharedCardCount` が 2 以上のとき共有枚数を表示する（AC-7）。
- 境界維持: MCP の `list_ai_cards` 応答は現行と同一（AC-8）。`list_ai_managed_cards` の owner と
  `authenticated` の EXECUTE 権限を維持（AC-9）。承認フローは不変（AC-11）。
  Remote MCP の `update_ai_card` / `undo_import_batch` は従来どおり動作（AC-15）。
- UI 削除: イラスト選択 `select` と「イラストを保存」が無い（AC-12）。サムネイル表示は残る（AC-13）。
  「登録バッチを取り消す」が無い（AC-14）。options に `illustrations` が無い（AC-16）。
- 既存挙動との一致: 保存中・成功・失敗の表示が既存操作と同一（AC-10）。
- 品質: `npm --prefix frontend run check` 通過（AC-17）。
