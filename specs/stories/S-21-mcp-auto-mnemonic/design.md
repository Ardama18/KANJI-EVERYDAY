# Design Doc: Remote MCP 登録カードのニーモニック自動生成・自動承認（S-21 / issue #70）

適用 ADR: ADR-012（承認済み mnemonic は preview token に載せず commit body に同伴させる／owner は RPC が
認証済み actor から決める／server 側で再 sanitize する）。本 Story は ADR-012 の決定 4 / 5 を
Remote MCP 経路へ拡張するだけで、新規 ADR は起こさない。

---

## D0. 前提決定: MCP からの `image.mode = "ai"` を許可する（要承認・着手条件）

### 問題

`card_mnemonics` は `(owner_user_id, illustration_key)` で一意で、`illustration_key` は NOT NULL。
#52（説明表示）も #59（画像生成）も `cards.illustration_key` を起点に引く。
`cards.illustration_key` は concept job に illustration 行があるときだけ設定され、illustration 行は
`ai_s14_enqueue_import_internal` が `image_mode <> 'none'` のときだけ作る。
一方 MCP tool schema は `image.mode === "ai"` を拒否し（`tools.ts:32`）、upload 用 tool も無い。

→ **現状の MCP カードは全て `illustration_key = NULL`。RPC を拡張しても書ける行が存在しない。**

### 選択肢

| 案 | 内容 | 評価 |
|---|---|---|
| **D0-A（採用）** | `tools.ts` の `refine` を外し、`image.mode="ai"` を MCP から許可する（flag 連動） | MCP カードがアプリ経路と同じ illustration / mnemonic パイプラインに合流する。差分は 1 refine。外部 tool 契約変更 ＋ 画像生成コスト発生 |
| D0-B | 現状維持し `upload` のみ対象 | MCP 単体では `uploadId` を取得できず、実質不達。AC-1 / AC-3 を満たさない |
| D0-C | `card_mnemonics` のキーを card 基準へ変更 | #52 / #59 / #55 / S-16D / S-16H の全経路に波及。本 issue の範囲を大きく超える |

### 決定

**D0-A を採用**。ただし外部 MCP tool 契約と料金に影響するため、**実装着手前にユーザー承認を得る**
（requirements.md §8-1）。承認が得られない場合、本 Story の AC-1 / AC-3 は達成不能であり、issue の
スコープ再定義が必要になる。

`refine` は無条件撤廃ではなく `isAiCardImportEnabled()` 連動にする。flag 無効時は従来どおり
`image.mode="ai"` を VALIDATION_ERROR で拒否する（AC-6）。tool schema は静的な zod オブジェクトなので、
schema 自体は `ai` を許可し、**services 層（`createMcpToolServices`）で flag 無効時に `ai` を拒否**する。
schema を実行時 flag で組み替えると tool descriptor / 契約テストが不安定になるため。

---

## D1. 生成タイミング: MCP commit 時（preview では生成しない）

| 案 | 評価 |
|---|---|
| **commit 時（採用）** | conceptId が確定し、preview token / importRequestHash の契約に一切触れない。生成物は同一リクエスト内で RPC へ渡され、MCP client を経由しない |
| preview 時 | 生成物を commit まで運ぶには (a) MCP 応答に載せる（**AC-5 違反・#61 の教訓に真正面から反する**）か (b) サーバ側 state を持つ（S-14 は無状態設計）。いずれも不可 |
| worker 側（S-16H の claim 直前） | レイテンシ 0・漏洩面 0 で理論上は最良。ただし Deno worker の claim 契約・prompt 構築の非同期化・S-16C 相当ロジックの Deno 側複製・別 RPC が必要で、検証は既に HEAD で失敗している deno gate に依存する（`test:s11:deno` の magick-codec TS2769）。今回は採らず、**D1-alt として記録**し、commit レイテンシが実運用で問題化した場合の移行先とする |

### 冪等性・再試行との整合

`s14_remote_commit_import` は `ai_import_batches (owner_user_id, idempotency_key)` の存在で再 commit を検出する。
拡張後も **mnemonic upsert は新規／再 commit の両分岐で実行する**（S-16D と同じ構造）。
`ON CONFLICT (owner_user_id, illustration_key) DO UPDATE` なので再試行は冪等。
ただし再試行のたびに Next 側で OpenAI 生成が走る点はコスト増になるため、D7 の上限で抑える。

---

## D2. 漢字の導出（サーバ側で決定論的に決める）

`output-mapper.ts:62-83` が正本のマッピング。

- `R1`: `front = kanjiSide`, `back = counterpartSide`
- `W1`: `front = counterpartSide`, `back = kanjiSide`

導出規則:

1. concept 単位でまとめ、`R1` の item を優先して代表とする（`claim_ai_import_concept` の
   `ORDER BY CASE items.pattern WHEN 'R1' THEN 0 ELSE 1 END` と同じ優先順）。
2. 代表 item から `kanjiText = pattern === "R1" ? front : back`、
   `meaningText = pattern === "R1" ? back : front`。
3. `kanjiText` を NFKC 正規化し、CJK 統合漢字（`\p{Script=Han}`）を 1 文字以上含まないものは
   **生成対象外**（かなのみ・記号のみのカードに mnemonic は無意味）。
4. `slots.kanji = kanjiText`、`isSingleKanji = Array.from(kanjiText).length === 1`。
   code point 長が 16 を超えるものは `card_mnemonics.slots` の正本形（maxLength 16）に収まらないため対象外。
5. **`kanji` / `isSingleKanji` はモデル出力を採用しない。** モデルには入力として与え、
   出力 schema からは外す（D3）。同一 concept に R1 / W1 が両方あっても導出結果は 1 つに収束する。

---

## D3. 単体 mnemonic 生成関数（新設）

新規 `frontend/src/lib/ai-card-generation/mnemonic-generation.ts`。S-16C の concept 生成からの
「切り出し」ではなく**新設**とする。`buildResponsesPayload` は concept 配列生成（kanjiSide /
counterpartSide を含む）専用で、単体生成とは入力も出力も違うため、切り出すと双方が歪む。
正本形の値（maxLength・mappings 2–4・`JAPANESE_FIELD_GUIDANCE`・`DEVELOPER_POLICY`）は
`openai-adapter.ts` から **export して共有**し、二重定義を作らない。

```
export interface MnemonicGenerationInput {
  readonly kanji: string;          // D2 で導出（モデルは変更できない）
  readonly isSingleKanji: boolean; // D2 で導出
  readonly meaning: string;        // 相手側テキスト
}

// 成功時 MnemonicDraft、失敗時 null（例外を投げない = 呼び出し側でカード登録を止めない）
export async function generateMnemonicDraft(args: {
  config: OpenAiCardGenerationConfig;
  input: MnemonicGenerationInput;
  fetcher?: typeof fetch;
}): Promise<MnemonicDraft | null>;
```

- OpenAI Responses API / `strict: true` / `json_schema` name `kanji_card_mnemonic`。
- schema は S-16C の `mnemonic` サブツリーから `slots.kanji` / `slots.isSingleKanji` を除いたもの
  （`shapeHint.part/picture`、`meaningHint`、`story`、`explanation.summary`、`explanation.mappings` 2–4）。
  各フィールドの `description` は既存 `JAPANESE_FIELD_GUIDANCE` を再利用（#57）。
- `developer` ロールに既存 `DEVELOPER_POLICY` を再利用し、user 入力（front/back 由来）は
  untrusted content として扱う旨を維持する。
- parse は `openai-adapter.ts` の `parseMnemonic` と同じ判定を使う。`parseMnemonic` を
  export して **導出済み kanji / isSingleKanji を注入してから検証する形**に整える（既存呼び出しの挙動は不変）。
- 返す前に `sanitizeMnemonicSlots` / `sanitizeMnemonicExplanation`（`mnemonic-sanitize.ts`）を通す。
  ここで NFKC 正規化・code point 長 cap・mappings 2–4 が再確認される。
- 例外・schema 不一致・refusal・timeout は全て `null` を返す（AC-4）。ログには provider body を出さない。

### moderation の合流

concept 単位で、生成テキストを `generation-service.ts:60-68` と同じ整形で 1 本の文字列にし、
既存 `moderate({ input: {kind:"text"}, flaggedCode: "OPENAI_OUTPUT_MODERATION" })` を呼ぶ。
flag / unavailable は **その concept のみ破棄**（他 concept と カード登録には影響させない）。
batch 一括ではなく concept 単位にするのは、1 件の flag で全件を失わないため。

### 利用量計上

`reserve_provider_usage_internal` は `kind='card_generation'` かつ `source='remote_mcp'` のとき
**units ≠ 0 を VALIDATION_ERROR にする**（`20260714000000_...sql:2730-2731`）。
つまり remote MCP 経路で text 生成の units を計上する余地は現行 schema に無い。

決定: **新しい kind も units も足さない**（issue 指示どおり）。既存の commit 時
`reserve_provider_usage_internal(..., 'card_generation', 'remote_mcp', ..., 0, ...)` をそのまま維持する。
画像側は従来どおり worker の `illustration_concept`（source=`remote_mcp`、units 1/concept）で計上される。
**mnemonic text 呼び出しが quota に計上されないことは既知の受容ギャップ**として記録し、
コストガードは D7 の上限で行う。units 契約を変えるなら別 Story（quota schema 変更）。

---

## D4. 対象カード

**`image.mode === "ai"` の concept のみ**。

- `none`: illustration 行が作られず `illustration_key` が無いので、そもそも `card_mnemonics` に書けない。
  生成もしない（無駄な OpenAI 呼び出しを避ける）。
- `upload`: illustration 行は作られるので技術的には対象にできるが、MCP 単体では到達不能な経路であり、
  かつ upload 画像は生成画像ではないため slots 駆動の意味が薄い。**今回は対象外**とし、
  RPC 側では conceptId 一致で解決できるため将来の拡張余地は残す（RPC は image_mode を見ない）。
- 漢字を含まない・16 code point 超の kanji side は D2-3/4 により対象外。

---

## D5. `s14_remote_commit_import` の拡張

### signature 変更の方法（issue 指示の訂正）

issue は「`CREATE OR REPLACE`・DROP しない」としているが、**PostgreSQL では引数を増やすと signature が
変わるため `CREATE OR REPLACE` は既存関数を置換せず、新しい overload を作る**。overload を 2 つ残すと、
`p_mnemonics` に DEFAULT を付けた場合に 8 named args の呼び出しが "function is not unique" で失敗する。

採用: **S-16D（`20260722000000_...sql:14-24`）と同じ形**。

```sql
DROP FUNCTION IF EXISTS public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text);

CREATE FUNCTION public.s14_remote_commit_import(
  p_client_id text, p_session_id text, p_idempotency_key text,
  p_import_request_hash text, p_generation_request_hash text, p_preview_token text,
  p_request jsonb, p_card_reservation_key text,
  p_mnemonics jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ ... $$;

ALTER FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)
  OWNER TO s10_migration_owner;
REVOKE ALL ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)
  TO authenticated;
```

- DROP で GRANT が落ちるが、**同一 migration（＝同一トランザクション）内で再宣言**するので外部から
  権限欠落状態は観測されない。S-16H が「DROP しない」としたのは signature 不変ケースの話であり、
  本件には当てはまらない。
- `DEFAULT NULL` により、旧デプロイ（8 named args）からの呼び出しも解決できる。overload は残さない。
- 本体ロジックは `20260720000004` の内容を**一字一句そのまま持ち込み**、差分を (a) 引数追加、
  (b) 2 箇所の `RETURN ai_s14_enqueue_import_internal(...)` を `result := ...` に変え末尾で `RETURN result`、
  (c) mnemonic upsert ブロック追加、の 3 点に限定する。preview token 検証・generation hash 検証・
  reservation の順序は変更しない。

### mnemonic upsert ブロック

S-16D の実装（`20260722000000_...sql:93-131`）を owner だけ差し替えて踏襲する。

```sql
target_batch_id := (result ->> 'batchId')::uuid;
IF p_mnemonics IS NOT NULL THEN
  IF jsonb_typeof(p_mnemonics) <> 'array' THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  FOR mnemonic_row IN SELECT entry.value ->> 'conceptId' AS concept_id,
                             entry.value -> 'slots' AS slots,
                             entry.value -> 'explanation' AS explanation
                      FROM jsonb_array_elements(p_mnemonics) AS entry(value)
  LOOP
    resolved_key := NULL;
    SELECT ill.illustration_key INTO resolved_key
    FROM public.ai_import_concept_jobs AS jobs
    JOIN public.illustrations AS ill ON ill.id = jobs.illustration_id
    WHERE jobs.batch_id = target_batch_id
      AND jobs.owner_user_id = actor_id
      AND jobs.concept_id = mnemonic_row.concept_id
      AND ill.owner_user_id = actor_id;
    IF resolved_key IS NULL THEN CONTINUE; END IF;   -- image none / 未知 conceptId は無視
    INSERT INTO public.card_mnemonics (owner_user_id, illustration_key, slots, explanation, status)
    VALUES (actor_id, resolved_key, mnemonic_row.slots, mnemonic_row.explanation, 'approved')
    ON CONFLICT (owner_user_id, illustration_key) DO UPDATE
      SET slots = EXCLUDED.slots, explanation = EXCLUDED.explanation,
          status = 'approved', updated_at = now();
  END LOOP;
END IF;
RETURN result;
```

- `actor_id` は `ai_s14_remote_mcp_actor(p_client_id, p_session_id)` が JWT claims から導出したもの。
  **payload からは owner を一切取らない。**
- `illustration_key` は RPC 内で materialize 済みの行から解決する。Next 側では計算しない（ADR-012 決定 2）。
- 書き込み可能性の根拠: `card_mnemonics` の owner は #55 で `s10_migration_owner`、
  本 RPC も同 owner の SECURITY DEFINER。table owner は RLS をバイパスする。
- upsert 失敗（想定外）は関数全体を巻き戻す。カード登録もろとも失敗させないため、
  **Next 側は mnemonic を「渡せる場合のみ渡す」設計**（D6）にしてリスク面を最小化する。

### migration ファイル

`supabase/migrations/20260727000000_s21_remote_commit_mnemonics.sql`。
既存最新は `20260726000000_s20_ai_card_mnemonic_edit.sql`。並行スプリントでの prefix 衝突は
`supabase db push` が黙ってスキップする事故につながるため、実装時に `ls supabase/migrations` で
一意性を再確認する。

### Database 型

`frontend/src/types/database.ts` の `s14_remote_commit_import.Args` に `p_mnemonics?: Json | null` を追加。
`database.typecheck.ts` の該当断定も更新する。

---

## D6. Next 側の配線

### 生成の置き場所

`frontend/src/lib/mcp/services.ts` の `commitCardImport` ラッパ内で、共有 service を呼ぶ**前**に生成し、
`input` へ `mnemonics` を注入する。

```
commitCardImport: async (input) => {
  const secret = dependencies.previewSecret;
  if (secret === undefined) return unavailable();
  const mnemonics = await dependencies.generateMnemonics?.(input.request) ?? undefined;
  return await commitCardImport({
    actor: {...}, input: mnemonics === undefined ? input : { ...input, mnemonics },
    repository: imports, secret, nowSeconds, correlationId,
  });
}
```

- **共有 service（`ai-import/service.ts`）は 1 行も変えない。** `parseCommitInput` は既に
  `mnemonics` を optional で受け、`sanitizeMnemonics` が validated request の conceptId 集合に対して
  再検証する（ADR-012 決定 5）。#61 の教訓どおり MCP 固有物を共有 service に足さない。
- MCP tool schema は `.strict()` なので、**client が `mnemonics` を注入することはできない**。
  注入するのは常にサーバ自身。
- `sanitizeMnemonics` は 1 件でも不正なら `undefined` を返して commit 全体を VALIDATION_ERROR にする。
  サーバ生成物は既に sanitize 済みなので通常は起こらないが、**安全側に倒すため注入前に
  `sanitizeMnemonics` 相当の検証を通し、通らないものは配列から落とす**（AC-4）。
- 生成は `McpToolServiceDependencies` に注入可能な関数として渡す（テスト容易性・route-handler で
  既定実装を組み立てる）。既定実装は flag / OpenAI 設定を見て、無効なら `undefined` を返す。

### repository

`remote-mcp-repository.ts` の `commit` で `p_mnemonics: input.mnemonics === undefined ? null :
input.mnemonics.map(entry => ({...}))` を追加。owner は渡さない（RPC が決める）。

---

## D7. レイテンシとコストの制御

MCP commit は外部 client の同期 tool 呼び出し。items は最大 50。

- 生成対象 concept 数上限: `MCP_AUTO_MNEMONIC_MAX_CONCEPTS`（既定 20、範囲 0–50）。超過分はスキップ。
- 並列度: 4（固定）。
- 全体 wall-clock 予算: `MCP_AUTO_MNEMONIC_BUDGET_MS`（既定 45_000、範囲 5_000–120_000）。
  予算超過後に未着手の concept はスキップ。
- 1 呼び出しの timeout: 既存 `generationTimeoutMs` / `moderationTimeoutMs` をそのまま使う。
- `frontend/app/api/mcp/route.ts` に `export const maxDuration = 60;` を追加（Vercel 実行時間に影響 → 要承認）。
- スキップは失敗ではない。カードは通常どおり作られ、画像は #59 のフォールバックプロンプトになる。
- `MCP_AUTO_MNEMONIC_MAX_CONCEPTS=0` で生成を完全停止できる（緊急 kill switch）。

---

## D8. セキュリティ

- **owner 三層**: 認証 = MCP OAuth Bearer → JWT claims、所有権 = RPC 内 `ai_s14_remote_mcp_actor`
  由来の `actor_id` のみを owner に使う、RLS = `card_mnemonics` の owner policy（DEFINER は table owner
  としてバイパスするが、SQL 側の owner-scope 条件で明示的に絞る）。
- **MCP 出力非露出**: `commitCardImport` の戻りは `parseCommitAsyncResponse`（batchId / status のみ）。
  slots / explanation / illustration_key / storage path を応答に載せない。`list_ai_cards` の
  allowlist 射影（`services.ts:100-116`）も変更しない。テストで応答 shape を断定する。
- **secret 非漏洩**: `OPENAI_API_KEY` は `getOpenAiCardGenerationConfig()` 経由で server module のみが読む。
  生成モジュールは Client Component から import されない。provider の body / error をログにも応答にも出さない。
- **untrusted input**: front / back は MCP client 由来。`DEVELOPER_POLICY` の untrusted content 宣言を維持し、
  生成物は strict schema + sanitize で受ける。

---

## D9. 失敗時の挙動（AC-4）

| 失敗 | 挙動 |
|---|---|
| flag off / OpenAI 設定不備 | 生成せず `mnemonics` を渡さない。従来動作 |
| 生成 API の network / HTTP / timeout / refusal / schema 不一致 | 当該 concept を `null` 扱いで除外 |
| moderation flagged / unavailable | 当該 concept を除外 |
| sanitize 不通過 | 当該 concept を除外 |
| 全 concept 除外 | `mnemonics` を渡さず従来どおり commit |
| RPC 側で illustration_key 解決不可 | `CONTINUE` で当該 concept のみスキップ。commit は成功 |

いずれもカード登録をブロックしない。

---

## D10. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `supabase/migrations/20260727000000_s21_remote_commit_mnemonics.sql` | 新規（D5） |
| `frontend/src/types/database.ts` / `database.typecheck.ts` | `p_mnemonics` 追加 |
| `frontend/src/lib/ai-card-generation/mnemonic-generation.ts` | 新規（D3） |
| `frontend/src/lib/ai-card-generation/openai-adapter.ts` | 定数 / `parseMnemonic` の export と kanji 注入対応（既存挙動不変） |
| `frontend/src/lib/mcp/tools.ts` | `image.mode="ai"` の refine 撤廃（D0） |
| `frontend/src/lib/mcp/services.ts` | 生成の注入（D6）／flag 無効時の `ai` 拒否 |
| `frontend/src/lib/mcp/route-handler.ts` | 既定の生成依存を組み立て |
| `frontend/src/lib/ai-import/remote-mcp-repository.ts` | `p_mnemonics` 送出 |
| `frontend/src/lib/env.ts` | `MCP_AUTO_MNEMONIC_MAX_CONCEPTS` / `MCP_AUTO_MNEMONIC_BUDGET_MS` |
| `frontend/app/api/mcp/route.ts` | `maxDuration` |
| テスト各種 | plan.md 参照 |

`frontend/src/lib/ai-import/service.ts`（共有 service）は**変更しない**。
`supabase/functions/`（worker）も**変更しない**。
