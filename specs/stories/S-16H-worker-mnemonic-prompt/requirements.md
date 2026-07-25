# S-16H 要件分析

## 1. 規模判定

**中〜大規模**。変更ファイル数は 6〜8 だが、SECURITY DEFINER RPC の migration を伴うため
`.claude/steering/implementation-flow.md` §6 の「migration / 権限に影響 → 規模を引き上げる」に従い
大規模として扱い、`design.md` + `plan.md` を必須成果物とする。

## 2. 実コード確認（本 issue の前提の再検証結果）

| 主張（issue #59） | 確認結果 | 根拠 |
|---|---|---|
| ワーカーが画像を生成する | 正 | `supabase/functions/_shared/ai-card-import/worker.ts:418` `obtainImage` → `provider.generate` |
| provider は OpenAI images API / 1024x1024 | 正 | `supabase/functions/_shared/ai-card-import/providers/openai.ts:18,36` |
| プロンプトは `parseClaimPrompt` → 旧 policy | 正 | `supabase/functions/_shared/ai-card-import/supabase.ts:279-290`、`supabase/functions/_shared/illustration-prompt-policy.ts:21-35` |
| 旧 policy は「文字・テキストは一切描かない」 | 正 | `illustration-prompt-policy.ts:32` |
| S-16B テンプレ正本は frontend にある | 正 | `frontend/src/lib/illustration/prompt.ts:27-74`（issue 本文の目標プロンプトと文言一致） |
| S-16B テンプレはワーカー未配線 | 正 | `generatePrompt` の参照は `frontend/src/lib/illustration/generator.ts` のみ |
| claim RPC 名 | `public.claim_ai_import_concept(uuid,bigint,uuid)` | `supabase/migrations/20260715000000_s11_ai_card_async_processing.sql:982` |
| `parseClaimPrompt` の row 供給元 | 同 RPC の返り値 jsonb（`backText` / `skill` を `image_mode='ai'` のときだけ含む） | 同 SQL:1024-1033 |
| `card_mnemonics` owner は修正済み | 正（owner = `s10_migration_owner`） | `supabase/migrations/20260724000000_s16_card_mnemonics_owner_fix.sql` |

### 追加で判明した重要事実（設計を左右する）

1. **claim RPC は `job.illustration_id` を保持している**（SQL:1023-1032 で `illustration_id` を返却）。
   `card_mnemonics` は `(owner_user_id, illustration_key)` で一意、`illustration_key` は
   `public.illustrations` にある。よって claim RPC 内で
   `jobs.illustration_id → illustrations → card_mnemonics` の owner-scope join が可能。
2. **worker には `owner_user_id` も `illustration_key` も渡っていない**（claim の返り値に無い）。
   したがって「ワーカーが service-role で自力取得」する案でも claim RPC の返り値追加が必要になる。
3. **ジョブを terminal 失敗させるとカード自体が作られない**。
   `ai_s11_fail_concept_locked`（SQL:1216-1223）は `ai_import_items.status='failed'`,
   `result_card_id=NULL` にし、`illustrations.status='failed'` にする。カード行は
   `finalize_ai_import_concept` の中でしか作られない（SQL:1273-）。
   → 「未承認は画像を作らない」を "ジョブ失敗" で実装すると **カードごと失われる**。
4. **`image_mode='ai'` のジョブは画像なしで finalize できない**。
   `finalize_ai_import_concept` は `job.illustration_id IS DISTINCT FROM p_illustration_id` で
   CONFLICT を投げ（SQL:1294）、`p_illustration_id IS NOT NULL` なら digest/幅/高さを必須にする
   （SQL:1342-1347）。「カードは作るが画像だけスキップ」は S-11 の finalize 契約変更が必要。
5. **未承認ジョブは実際に到達しうる**。`commit_generated_import_async` の `p_mnemonics` は
   `DEFAULT NULL`（`20260722000000_s16_commit_generated_import_mnemonics.sql`）で、Remote MCP 経路
   (`commit_import_async`) は mnemonics を書かない。`card_mnemonics.slots` に形状 CHECK も無い。
6. **Edge Function のテストは Vitest で行われている**（Deno のテストランナーは未導入）。
   `specs/stories/S-11-ai-card-async-processing/tests/*.test.ts` が
   `supabase/functions/_shared/ai-card-import/*.ts` を相対 import しており、型検査は
   `npm --prefix frontend run test:s11:deno`（= `deno check` ゲート）が担う。
   `frontend/tsconfig.json` は `allowImportingTsExtensions: true` なので frontend 側テストからも
   Deno モジュールを import して型検査できる。

## 3. 決めるべきこと（design.md で確定）

- D1: slots をワーカーへ渡す経路（claim RPC join か worker fetch か）
- D2: S-16B テンプレの Deno 実装形態と frontend 正本との drift 防止
- D3: 未承認（slots 無し／不正形）ジョブの扱い
- D4: 旧 policy の撤去範囲と安全系（禁止表現）の担保方法
- D5: migration の範囲・権限・timestamp

## 4. 非機能・制約

- `SUPABASE_SERVICE_ROLE_KEY` / `OPENAI_API_KEY` をブラウザへ露出しない（変更なし）。
- 差し込み文字列は制御文字除去＋100 文字上限（既存 `sanitizePromptInput` と同一仕様）。
- OpenAI プロンプト長: 新テンプレは約 600 文字。`dall-e-3` の 4000 文字上限内。
- worker の `SafeLogEvent` / `SafeImportErrorCode` の enum を増やさない（ログに未検証文字列を載せない）。
- 既存の claim → provider → storage → finalize のトランザクション境界と冪等性を変えない。
