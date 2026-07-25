# S-18 AIカード管理画面で生成イラストをサムネイル表示

親 Epic: E-16（#40）／issue #61。親 Story: S-13（AIカード管理・#14）。
依存: S-08/S-09（`illustrations` テーブル・private `illustrations` バケット・`getSignedUrl`）、
S-13（`list_ai_managed_cards` RPC と `/ai/cards` UI）。

## 背景

`/ai/cards`（AIカード管理）は、カードに紐づくイラストの有無を
`イラスト: 設定済み / なし` の文字だけで示している
（`frontend/src/components/ai-card-management/AiCardManagementClient.tsx:359`）。
一覧 API（`getAiCardListAction` → `list_ai_managed_cards` RPC）が返す
`ManagedAiCard.illustration` は `{ id, status }` だけで画像 URL を持たないため、
管理者（=本人）はどのカードにどの絵が付いているのか目で確認できず、
イラスト差し替え（`setAiCardIllustrationAction`）の判断が
`イラスト {id の先頭 8 文字}` という ID 表示に頼っている。

学習画面（S-09）では同じ private バケットの画像を
`getSignedUrl(storage_path, 3600)` でサーバ署名し `next/image` で表示する経路が既にある。
管理画面はこの既存パターンを再利用できていないだけである。

## ゴール

`/ai/cards` の各カードで、`status='ready'` のイラストをサムネイル画像として表示する。
表示対象は常に owner（ログイン中ユーザー）自身のイラストのみとし、
URL はサーバ側で生成した期限付き署名 URL のみをクライアントへ渡す。
`storage_path` はクライアントへ出さない。

## 受入条件（AC）

- AC-1: `/ai/cards` で、`status='ready'` かつ実体（`storage_path`）のあるイラストを持つカードに
  画像サムネイルが表示される。
- AC-2: イラスト未設定／未 ready のカードは従来どおり文言のみで、レイアウトが壊れない。
- AC-3: 表示される画像は owner 自身のイラストのみ。他ユーザーの画像・`storage_path` が
  レスポンスへ混入しない。
- AC-4: 署名 URL はサーバ側生成・期限付き（3600 秒）。署名に失敗・失効しても
  一覧・検索・編集・削除・イラスト設定は継続動作する。
- AC-5: 既存の管理機能（一覧・フィルタ・追加読込・編集・削除・undo・イラスト設定）に回帰なし。
  Remote MCP の `list_ai_cards` ツール出力に署名 URL や `storage_path` を出さない。
- AC-6: `npm --prefix frontend run check` 通過。

## Out of Scope

- イラスト設定ドロップダウン（`AiCardManagementOptions.illustrations`）のサムネイル化。
  必要なら follow-up。
- イラストの拡大表示・ライトボックス・ギャラリー等の追加 UX。
- 画像生成・プロンプト（S-16E/G/H 済）、承認 UI・下書き生成（S-16C/D）。
- `list_ai_managed_cards` RPC が同一 `illustration_key` に複数行あるとき
  `ORDER BY id LIMIT 1` で 1 件を選ぶ既存挙動の見直し。
- migration・RLS・Storage policy の変更（本 Story では不要）。
