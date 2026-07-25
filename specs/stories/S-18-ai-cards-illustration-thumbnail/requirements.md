# S-18 要件分析

## 1. 規模判定

**中規模（上限寄り）**。実装 4 ファイル + テスト 4 ファイル程度。
migration・RLS・Storage policy・認証境界の変更は**なし**（後述 §3 D1 の判断による）。
`.claude/steering/implementation-flow.md` §6 に従い `design.md` + `plan.md` を必須成果物とし、
task-executor に `plan.md` 全体を渡す。ファイル数が 6 を超えるため、影響範囲の記述は
大規模と同等の粒度で残す（requirements.md も作成）。

## 2. 実コード確認（issue #61 の前提の再検証結果）

| 主張（issue #61） | 確認結果 | 根拠 |
|---|---|---|
| ルートは `page.tsx` → `AiCardManagementClient` | 正 | `frontend/app/(auth)/ai/cards/page.tsx`（`force-dynamic`・auth 済み） |
| 一覧は `getAiCardListAction` → `list_ai_managed_cards` RPC | 正 | `frontend/src/actions/ai-card-management-actions.ts:49-56`、`frontend/src/lib/ai-card-management/app-ai-repository.ts:15-26` |
| `ManagedAiCard.illustration` は `{ id, status } \| null` で URL を持たない | 正 | `frontend/src/lib/ai-card-management/types.ts:10-13,28` |
| UI は文字表示のみ | 正 | `AiCardManagementClient.tsx:358-360`（`イラスト: {status==='ready' ? '設定済み' : 'なし'}`） |
| 署名 URL の既存パターンは `getSignedUrl(storagePath, 3600)` | 正 | `frontend/src/lib/illustration/storage.ts:62-79`（private `illustrations` バケット・`createServiceRoleClient`）、利用例 `frontend/src/actions/session-actions.ts:246-266` |
| Next の supabase 画像ホスト許可は済み | 正 | `frontend/next.config.mjs` `images.remotePatterns` = `https://*.supabase.co/storage/v1/object/sign/**` |

### 追加で判明した、設計を左右する事実

1. **RPC は既に owner-scope で `illustrations` を join しており、`illustration.id` を返す。**
   `supabase/migrations/20260719000001_s13_ai_card_management_undo.sql:122-128` の
   `LEFT JOIN LATERAL (... WHERE candidate.owner_user_id = actor_id AND
   candidate.illustration_key = c.illustration_key ORDER BY candidate.id LIMIT 1)`。
   したがって「ページ内の ready イラストの id 集合」は RPC 改修なしで既に手に入る。
   欠けているのは `storage_path` のみ。

2. **`listAiCards`（service 層）は Remote MCP ツールと共有されている。**
   `frontend/src/lib/mcp/services.ts:66` が `listAiCards(cards, input)` を
   MCP ツール `list_ai_cards`（`frontend/src/lib/mcp/tools.ts:248`）へそのまま出している。
   → **署名 URL 生成を service 層に入れると、Remote MCP クライアントへ署名 URL が流出する**
   （外部 API 契約の破壊的変更・データ露出）。署名は Server Action 層に置かなければならない。

3. **`illustrations` は owner-scope の直接クエリ実績がある。**
   `ai-card-management-actions.ts:77-83` が同一 action ファイル内で
   `.from("illustrations").select("id, status").eq("owner_user_id", userId)
   .eq("status","ready").not("storage_path","is",null)` を実行している（RLS 併用）。
   `illustrations_select_owner` policy（`20260223000000_s02_schema_rls.sql:241-244`）が最終防衛線。
   → 二次クエリ案は既存の流儀そのままで、新しい権限設計を持ち込まない。

4. **`list_ai_managed_cards` は SECURITY DEFINER・owner 固定・専用権限で、契約テストが厚い。**
   `frontend/src/lib/ai-card-management/migration-contract.test.ts` が
   actor helper の出現回数（`toHaveLength(9)`）・signature 一覧・REVOKE/GRANT を検証。
   関数の返却形を変えるには `CREATE OR REPLACE` に加え
   `ALTER FUNCTION ... OWNER TO s10_migration_owner`（既存 SECURITY DEFINER の owner 維持）と
   REVOKE/GRANT の再指定、新 migration timestamp が必要。

5. **`storage_path` が NULL の `ready` 行が存在しうる。**
   カラムは `storage_path text DEFAULT NULL`（`20260223000000_s02_schema_rls.sql:63`）。
   学習画面も `if (!illustration.storage_path) return pending`（`session-actions.ts:250-252`）で
   防御している。管理画面も同じ防御が必要。

6. **`managedCardSyncKey` は uncontrolled editor の remount キーである。**
   `AiCardManagementClient.tsx:42-53`。署名 URL は毎回値が変わるため、
   **キーに url を含めてはならない**（含めると再取得ごとに編集フォームが remount され、
   入力中の内容が消える回帰になる）。

7. **一覧は 20 件ページングで、追加読込は既存配列へ append する。**
   `AiCardManagementClient.tsx:583-586`。1 リクエストの署名対象は最大 `limit`（既定 20・上限 100）件。
   append された旧ページの署名 URL は時間経過で失効しうる → 失効時の劣化表示が必要。

8. **既存テストが `illustration: { id, status }` のオブジェクトリテラルを使っている。**
   `AiCardManagementClient.test.tsx:44`。`AiCardIllustration` に必須フィールドを足すと
   このテストが型エラーになるため、同一変更内で更新する。

## 3. 決めるべきこと（design.md で確定）

- D1: `storage_path` 取得経路 —（a）RPC 改修 vs（b）Server Action 内 owner-scope 二次クエリ
- D2: 署名 URL の生成場所・バッチ方法・expiry・失敗時の値
- D3: 型拡張の形（`url` を必須にするか任意にするか）と Remote MCP 出力への影響
- D4: UI の描画方法（`next/image` の使い方・alt・レイアウト）と失効時の劣化
- D5: テストの置き方（署名の単体テスト境界・client テストでの `next/image` 扱い）

## 4. 非機能・制約

- `SUPABASE_SERVICE_ROLE_KEY` はブラウザへ露出しない。`getSignedUrl` は
  `createServiceRoleClient` を内部で使うため、**呼び出しは `"use server"` ファイル/server 専用
  モジュールに限定**する（`"use client"` から到達させない）。
- `storage_path` をクライアントへ渡さない（署名 URL 文字列のみ）。
- owner 分離は「Server Action の認証」「`.eq("owner_user_id", userId)` の明示条件」
  「`illustrations_select_owner` RLS」の三層で担保する。
- 署名対象は 1 リクエスト 1 ページ分（≤100・既定 20）の**ユニーク `storage_path`** に限定する。
- `revalidatePath("/ai/cards")` 後の再取得でも署名は毎回新規発行される（キャッシュしない）。
  一覧 action は `noStore()` 済みなので署名 URL が Next のキャッシュに載らない。
- 既存の error contract（`AiCardActionResult` / `AiCardManagementError`）を変えない。
  署名の失敗は **エラーにせず `url: null`** に縮退させる（AC-4）。
