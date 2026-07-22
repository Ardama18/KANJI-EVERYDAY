# S-16G 生成 runtime を本番登録して no-op を解消

親 Epic: E-16（#40） / Issue: #53

## ストーリー

E-16（承認 slots → 新テンプレ → 生成トリガー → 表示）は実装・マージ済みだが、
画像生成の実行系が本番未登録のため本番で画像が生成されない。
`runProcessIllustrationGeneration`（`frontend/src/actions/illustration-generation-runtime.ts`）が
呼ぶ実装の default が **no-op**（`async () => { return; }`）で、実生成ロジック
`processIllustrationGeneration`（`frontend/src/lib/illustration/generator.ts`）は
テスト用 setter 経由でしか差し込まれない。

本番の server 実行時に `runProcessIllustrationGeneration` が実ロジックを呼ぶよう配線する。

## 受入条件（Issue #53）

1. 本番 server 実行時、承認済み slots で trigger → 実 `processIllustrationGeneration` が呼ばれ
   Gemini → storage → `illustrations.status='ready'` まで到達（no-op でない）。
2. 未承認 illustration_key では生成が起動しない（S-16E 挙動不変）。
3. server-only secret（`SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY`）がブラウザバンドルへ露出しない
   （`build` で client bundle 非混入を確認）。
4. テスト差し替え機構（`__set/__reset...ForTest`）が引き続き機能する。
5. `npm --prefix frontend run check` と `npm --prefix frontend run build` を通過。

## Out of Scope

- 旧 ready 画像の一括再生成。
- プロンプトテンプレ・slots スキーマ・承認 UI・表示（S-16B〜F 対応済み）の変更。
