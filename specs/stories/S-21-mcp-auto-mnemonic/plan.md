# 作業計画書: S-21 Remote MCP 登録カードのニーモニック自動生成・自動承認（issue #70）

前提: `design.md` の D0（MCP からの `image.mode="ai"` 許可）についてユーザー承認が済んでいること。
未承認のまま Phase 2 以降に進まない。

作業ディレクトリはリポジトリルート。品質ゲートは `npm --prefix frontend run check`。
`tasks/` や個別 task ファイルは生成・参照・更新しない。

---

## Phase 0: 着手前確認（実装なし）

- [x] 0-1. D0 の承認、migration 適用先環境、`maxDuration` 追加、新規環境変数の追加を確認済みであること。
- [x] 0-2. `ls supabase/migrations` で `20260727000000` prefix が未使用であることを確認する。
      使用済みなら次の未使用 UTC timestamp に繰り上げる（prefix 衝突は `supabase db push` が黙って
      スキップするため）。
- [x] 0-3. `git log --oneline -5` と `npm --prefix frontend run check` を実行し、着手前の状態を記録する。
      `*.int.test.ts` は `S10_TEST_DATABASE_URL` 未設定時に失敗する既知事象なので、これを回帰と混同しない。

---

## Phase 1: 単体 mnemonic 生成関数（D2 / D3）

### 1-1. `openai-adapter.ts` の共有化

- `DEVELOPER_POLICY`、`JAPANESE_FIELD_GUIDANCE` を export する。
- `parseMnemonic` を export し、`slots.kanji` / `slots.isSingleKanji` を **呼び出し側から注入できる**
  形にする（既存 concept 経路は従来どおりモデル出力から取る。挙動を変えない）。
- 完了条件: 既存 `openai-adapter.test.ts` / `generate-route.regression-1.test.ts` が無改変で通る。

### 1-2. 漢字導出（D2）

- `frontend/src/lib/ai-card-generation/mnemonic-generation.ts` に
  `deriveKanjiTarget(items)` を実装する。
  - concept 単位に束ね、`R1` 優先で代表 item を選ぶ。
  - `kanjiText = pattern==="R1" ? front : back`、`meaningText` は逆側。
  - NFKC 正規化（`normalizeDisplayText` を再利用）。
  - `\p{Script=Han}` を含まない、または code point 長 > 16 は `null`（対象外）。
  - `isSingleKanji = Array.from(kanjiText).length === 1`。

### 1-3. 生成本体（D3）

- `buildMnemonicResponsesPayload(config, input)`: strict json_schema `kanji_card_mnemonic`。
  `shapeHint.part/picture`(≤100)・`meaningHint`(≤100)・`story`(≤100)・
  `explanation.summary`(≤120)・`explanation.mappings`(2–4, part/meaning ≤100)。
  各 `description` に `JAPANESE_FIELD_GUIDANCE`。developer ロールに `DEVELOPER_POLICY`。
  `slots.kanji` / `isSingleKanji` は schema に含めない。
- `generateMnemonicDraft(...)`: fetch → parse → 導出値を注入 → `sanitizeMnemonicSlots` /
  `sanitizeMnemonicExplanation`。全ての失敗経路で `null` を返し例外を投げない。
  provider の body / error を log にも戻り値にも載せない。

### 1-4. moderation 合流（D3）

- `moderateMnemonicDraft(config, draft, fetcher)`: `generation-service.ts:60-68` と同じ整形の文字列を
  既存 `moderate({ kind:"text" }, flaggedCode:"OPENAI_OUTPUT_MODERATION")` に渡す。
  flagged / unavailable は `false` を返す（当該 concept のみ破棄）。

### 1-5. テスト `frontend/src/lib/ai-card-generation/mnemonic-generation.test.ts`

- [x] payload が strict / mappings 2–4 / maxLength / 日本語指示を含み、`kanji` を schema に含めない。
- [x] 正常応答 → 正本形の `MnemonicDraft` を返し、`slots.kanji` / `isSingleKanji` が **導出値**である
      （モデルが別の漢字を返しても上書きされない）。
- [x] 漢字導出: R1 / W1 / 同一 concept に両方 / 単字（`isSingleKanji=true`）/ 複数字（`false`）/
      かなのみ（対象外 null）/ 17 code point（対象外 null）。
- [x] 失敗系: network / HTTP 5xx / refusal / schema 不一致 / mappings 1 件 / mappings 5 件 / timeout →
      全て `null`。例外を投げない。
- [x] moderation flagged / unavailable → `false`。

**ゲート**: `npm --prefix frontend run check`

---

## Phase 2: DB migration（D5）— 要承認

### 2-1. `supabase/migrations/20260727000000_s21_remote_commit_mnemonics.sql`

- 冒頭コメントに、DROP + CREATE を選ぶ理由（引数追加は signature 変更のため `CREATE OR REPLACE` では
  置換にならず overload が残り、DEFAULT 付き overload 併存は 8 named args 呼び出しを
  "function is not unique" にする）と、GRANT を同一トランザクション内で再宣言する旨を書く。
- `DROP FUNCTION IF EXISTS public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text);`
- `CREATE FUNCTION ...(..., p_mnemonics jsonb DEFAULT NULL)`。
  本体は `20260720000004_...sql` の内容をそのまま持ち込み、差分は
  (a) 引数追加、(b) 既存 2 箇所の `RETURN ai_s14_enqueue_import_internal(...)` を `result := ...` に変更、
  (c) 末尾に mnemonic upsert ブロック ＋ `RETURN result`、の 3 点のみ。
  preview token 検証・generation hash 検証・reservation 呼び出しの順序は変えない。
- mnemonic upsert は design.md D5 の SQL のとおり。owner は `actor_id` のみ。
  `illustration_key` は `ai_import_concept_jobs JOIN illustrations` を owner スコープで解決。
  解決不能は `CONTINUE`。`ON CONFLICT (owner_user_id, illustration_key) DO UPDATE ... status='approved'`。
- `ALTER FUNCTION ...(text,text,text,text,text,text,jsonb,text,jsonb) OWNER TO s10_migration_owner;`
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;`
- `GRANT EXECUTE ... TO authenticated;`
- `service_role` への GRANT は付けない（S-14 の境界を維持）。

### 2-2. Database 型

- `frontend/src/types/database.ts` の `s14_remote_commit_import.Args` に `p_mnemonics?: Json | null`。
- `frontend/src/types/database.typecheck.ts` の該当断定を更新。

### 2-3. 契約テスト `frontend/src/lib/card-mnemonics/remote-commit-mnemonics-migration-contract.test.ts`

既存 `frontend/src/lib/mcp/migration-contract.test.ts` / `claim-mnemonic-slots-migration-contract.test.ts`
と同じ「migration SQL をテキストとして読んで断定する」方式。

- [x] `p_mnemonics jsonb DEFAULT NULL` を持つ 9 引数版が定義されている。
- [x] 8 引数版の `DROP FUNCTION IF EXISTS` があり、同一ファイル内に 9 引数版の
      `OWNER TO s10_migration_owner` / `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` /
      `GRANT EXECUTE ... TO authenticated` が揃っている。
- [x] `TO service_role` を含まない。
- [x] `SECURITY DEFINER` と `SET search_path = pg_catalog, pg_temp` を保持している。
- [x] `INSERT INTO public.card_mnemonics` と `'approved'` と
      `ON CONFLICT (owner_user_id, illustration_key)` を含む。
- [x] owner に `actor_id` を使い、`p_mnemonics` 由来の owner フィールドを読んでいない
      （`->> 'owner'` 系が出現しない）。
- [x] `ai_s14_remote_mcp_actor` / preview token 検証 / `expected_generation_hash` /
      `reserve_provider_usage_internal(... 'card_generation', 'remote_mcp' ... 0 ...)` が残っている（回帰防止）。
- [x] migration ファイル名の timestamp が `supabase/migrations/` 内で一意である。

**ゲート**: `npm --prefix frontend run check`

---

## Phase 3: MCP 配線（D0 / D4 / D6 / D7）

### 3-1. tool schema（D0）

- `frontend/src/lib/mcp/tools.ts` の `image` union から `.refine(image => image.mode !== "ai", ...)` を外す。
- 既存 `tools.test.ts` の「ai を拒否する」ケースを、flag 有効時は受理・flag 無効時は
  services 層で拒否、という新しい期待に更新する。

### 3-2. flag ガード（D0 / AC-6）

- `frontend/src/lib/mcp/services.ts` の `previewCardImport` / `commitCardImport` で、
  `isAiCardImportEnabled()` が false のとき `image.mode === "ai"` を含む request を
  `VALIDATION_ERROR` で拒否する（従来動作の維持）。

### 3-3. 生成の注入（D6）

- `McpToolServiceDependencies` に
  `generateMnemonics?: (request) => Promise<readonly CommitMnemonicEntry[] | undefined>` を追加。
- `commitCardImport` ラッパで、`image.mode==="ai"` の concept のみを対象に生成し、
  結果があれば `{ ...input, mnemonics }` として共有 service に渡す。
  **`frontend/src/lib/ai-import/service.ts` は変更しない。**
- 注入前にサーバ側で `sanitizeMnemonics` 相当の検証を行い、通らないエントリは配列から落とす
  （1 件の不正で commit 全体を VALIDATION_ERROR にしない）。

### 3-4. 既定実装と上限（D7）

- `frontend/src/lib/mcp/route-handler.ts` の `createDefaultMcpRouteDependencies` で
  `generateMnemonics` の既定実装を組み立てる。`isAiCardImportEnabled()` false または
  `getOpenAiCardGenerationConfig()` undefined なら `undefined` を返す関数にする。
- `frontend/src/lib/env.ts` に `getMcpAutoMnemonicConfig()` を追加。
  `MCP_AUTO_MNEMONIC_MAX_CONCEPTS`（既定 20 / 0–50）、`MCP_AUTO_MNEMONIC_BUDGET_MS`（既定 45000 / 5000–120000）。
  既存 `parseIntegerEnv` を再利用。
- 並列度 4、予算超過分はスキップ。
- `frontend/app/api/mcp/route.ts` に `export const maxDuration = 60;` を追加。

### 3-5. repository（D6）

- `frontend/src/lib/ai-import/remote-mcp-repository.ts` の `commit` に
  `p_mnemonics: input.mnemonics === undefined ? null : input.mnemonics.map(...)` を追加。owner は渡さない。

### 3-6. テスト

`frontend/src/lib/ai-import/remote-mcp-repository.test.ts` に追加:
- [x] `mnemonics` 指定時、`p_mnemonics` が conceptId / slots / explanation のみで RPC へ渡る
      （owner / userId / clientId を含まない）。
- [x] `mnemonics` 未指定時は `p_mnemonics: null`。既存 8 引数分の呼び出し内容は不変。

`frontend/src/lib/mcp/services.test.ts` に追加:
- [x] flag 有効 + `image.mode="ai"` → 生成が呼ばれ、共有 service に `mnemonics` が渡る。
- [x] `image.mode="none"` のみの request → 生成を呼ばない。
- [x] flag 無効 → 生成を呼ばず、`image.mode="ai"` を含む request を VALIDATION_ERROR にする。
- [x] 生成が全件 null / throw → `mnemonics` を渡さず commit は成功する（AC-4）。
- [x] **commit tool の戻り値に slots / explanation / illustration_key / storage 情報が含まれない**
      （キー集合を断定。AC-5）。
- [x] client が `mnemonics` を tool 入力に付けても `.strict()` で弾かれる（`tools.test.ts`）。

`frontend/src/lib/mcp/route-contract.test.ts`:
- [x] 既存の応答契約に回帰がない（＋既定生成器が flag / provider 設定 / 上限 0 で provider を呼ばない）。

**ゲート**: `npm --prefix frontend run check` ＋ `npm --prefix frontend run build`
（route の `maxDuration` 追加が production build に影響するため）

---

## Phase 4: 統合検証（可能な場合のみ）

テストは追加済み。**実行は未実施**: この環境に `S14_TEST_DATABASE_URL`（当該 int suite が要求する変数）が
無く、`describe.skipIf` により 17 件すべて skip された（`npm --prefix frontend run check` の出力で
`src/lib/mcp/real-db.int.test.ts (17 tests | 17 skipped)`）。成功も失敗も観測していない。

- [x] 4-1. `S10_TEST_DATABASE_URL` が使える環境で `frontend/src/lib/mcp/real-db.int.test.ts` に追加:
      MCP commit（`image.mode="ai"` ＋ `p_mnemonics`）→ `card_mnemonics` に `status='approved'` 行が
      1 件、`owner_user_id` が actor、`illustration_key` が
      `'s11:'||batchId||':'||sha256(conceptId)` と一致する。（追加済み / 未実行）
- [x] 4-2. 別 owner の JWT では当該行が見えない（owner 分離）。（追加済み / 未実行）
- [x] 4-3. 同一 idempotencyKey での再 commit が冪等（行が増えない・status が approved のまま）。（追加済み / 未実行）
- [x] 4-4. `p_mnemonics = null` で従来どおり動く（＋`image.mode="none"` は解決不能で CONTINUE）。（追加済み / 未実行）
- 併せて既存の `has_function_privilege` 断定を 9 引数 signature へ更新した（migration 適用後に成立する形）。
- 環境が無い場合は「未実行」として完了報告に明記する。推測で成功と書かない。

---

## Phase 5: 仕上げ

- [x] 5-1. `npm --prefix frontend run check` と `npm --prefix frontend run build` を実行し出力を記録する。
      check: lint OK / typecheck OK / Vitest 1184 passed・29 skipped、失敗は着手前 baseline と同じ 3 suite
      （`S-10 .int` / `S-10 .e2e` / `ai-card-management/real-db.int`。いずれも `S10_TEST_DATABASE_URL` 未設定）。
      build: 成功（`/api/mcp` は従来どおり dynamic）。
- [x] 5-2. `git diff` / `git status` で変更範囲を確認する。共有 service（`ai-import/service.ts`）と
      `supabase/functions/` に差分が無いことを確認する。→ 両者の `git diff --stat` は空。
- [x] 5-3. 受入条件 AC-1〜AC-8 とテストの対応表を完了報告に載せる。未実行項目を明記する。
- [x] 5-4. `meta.json.status` を `implementation_review` に更新する。

---

## 完了条件

- Phase 1〜3 の全タスクとテストが完了し、`check` が通る。
- 共有 service と worker に差分が無い。
- MCP tool 応答に mnemonic / storage 内部情報が含まれないことがテストで断定されている。
- migration が DROP + CREATE ＋ owner / REVOKE / GRANT 再宣言を含み、契約テストで検証されている。
- 生成 / moderation 失敗時にカード登録が継続することがテストで確認されている。
- flag 無効時に従来動作となることがテストで確認されている。

## リスク

| リスク | 対応 |
|---|---|
| D0 未承認だと機能が完全に無効（書ける行が無い） | Phase 0 で必ず確認。未承認なら着手しない |
| MCP commit のレイテンシ超過 | D7 の上限・並列度・予算・kill switch。超過分はスキップして commit 成功 |
| mnemonic text 呼び出しが quota 未計上 | 既知の受容ギャップ。`MCP_AUTO_MNEMONIC_MAX_CONCEPTS` がコストガード。units 変更は別 Story |
| migration timestamp 衝突 | Phase 0-2 で一意性確認 |
| DROP による GRANT 消失 | 同一 migration 内で再宣言。契約テストで断定 |
| 再 commit のたびに再生成されコストが増える | 上限内。RPC 側 upsert は冪等 |
