# S-16H 設計

対象 issue: #59。前提の実コード確認は `requirements.md` §2。

## 全体像

```
pgmq ai_card_imports
  └─ ai-card-import-worker (Deno)
       ├─ read_ai_import_queue
       ├─ claim_ai_import_concept  ★ 承認済み card_mnemonics.slots を同一 TX で join して返す（D1）
       ├─ parseClaimPrompt         ★ slots があれば S-16B テンプレでプロンプト生成（D2）
       │                             slots が無い/不正なら旧 policy にフォールバック（D3）
       ├─ provider.generate (OpenAI images)
       ├─ storage write
       └─ finalize_ai_import_concept
```

変更するのは **claim RPC の返り値**と **プロンプト組み立て**のみ。claim → generate → upload →
finalize の状態機械、冪等性、リトライ、補償削除、ログ enum は一切変えない。

## D1: slots をワーカーへ渡す経路 → **claim RPC 内の owner-scope join を採用**

### 比較

| 観点 | (a) claim RPC で join | (b) worker が service-role で自力取得 |
|---|---|---|
| トランザクション性 | claim と同一 TX。claim 時点の承認内容で必ず生成される | claim 後の別 REST 呼び出し。claim とスロットの間に承認更新が入り得る |
| 整合 | `jobs.illustration_id` から辿るので job とスロットの対応が構造的に保証される | worker が owner/illustration_key を突き合わせる実装ミスの余地がある |
| 変更範囲 | migration 1 本（RPC 返り値 +1 キー）＋ worker 1 ファイル | **claim RPC の返り値追加が結局必要**（worker に `owner_user_id` も `illustration_key` も来ていない）＋ worker に REST 取得と `card_mnemonics` の service_role GRANT が追加で必要 |
| 権限 | 追加 GRANT 不要。claim RPC は SECURITY DEFINER で owner = `s10_migration_owner`、`card_mnemonics` も #55 で同 owner。**テーブル owner は RLS をバイパス**するため owner-scope 条件を SQL 側で明示するだけで足りる | `card_mnemonics` を service_role に GRANT SELECT する必要があり、PostgREST 経路に新しい読み取り面を増やす |
| 往復回数 | 増えない | ジョブごとに +1〜2 往復（Edge Function の実行時間・失敗面が増える） |

**決定: (a)**。(b) は「migration を避けられる」という利点が成立しない（返り値追加が必要）うえ、
権限面と整合面で不利。

### 具体

新 migration `supabase/migrations/20260725000000_s16h_claim_returns_mnemonic_slots.sql`:

- `CREATE OR REPLACE FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid)`
  （**DROP しない**。DROP すると `service_role` への EXECUTE GRANT が失われる。
  CREATE OR REPLACE は owner と権限を保持する）
- 本体は S-11 の定義をそのまま維持し、次だけを追加する。
  ```sql
  DECLARE mnemonic_slots jsonb;
  ...
  IF representative.image_mode = 'ai' THEN
    SELECT mnemonics.slots INTO mnemonic_slots
    FROM public.card_mnemonics AS mnemonics
    JOIN public.illustrations AS ill
      ON ill.illustration_key = mnemonics.illustration_key
     AND ill.owner_user_id   = mnemonics.owner_user_id
    WHERE ill.id = job.illustration_id
      AND mnemonics.owner_user_id = job.owner_user_id   -- owner-scope（必須）
      AND mnemonics.status = 'approved';                -- draft は使わない
  END IF;
  ```
- 返り値 jsonb に `'mnemonicSlots', mnemonic_slots` を追加。既存の
  `jsonb_strip_nulls` により未承認時はキー自体が現れない（既存キーの意味は変えない）。
- `backText` / `skill` は**残す**（D3 のフォールバックと既存契約の互換のため）。
- 末尾で `ALTER FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) OWNER TO s10_migration_owner;`
  を冪等に再宣言（DEFINER の実行 identity を明示的に固定する）。GRANT / REVOKE は再宣言しない
  （CREATE OR REPLACE で保持されるため、触ると差分が読みにくくなる）。

`illustrations` の読み取り権限は既存で担保済み（同 owner の RPC が `UPDATE public.illustrations`
と `JOIN public.illustrations` を実行している。`ai_s11_fail_concept_locked` /
`commit_generated_import_async`）。

## D2: S-16B テンプレの Deno 実装と drift 防止 → **`_shared` に等価な純粋モジュールを複製し、出力一致テストで固定**

frontend からの直接 import は採らない: Edge Function は `supabase/functions/` 配下だけがデプロイ
対象で、`frontend/src` への相対 import はデプロイ時のバンドルを壊す。

- 新規 `supabase/functions/_shared/mnemonic-prompt.ts`（依存 import ゼロの pure TS）
  - `export type MnemonicShapeHint` / `MnemonicSlots`（frontend `prompt.ts` と同形）
  - `export const sanitizePromptInput`（既存 2 実装と同一仕様: 制御文字除去 + 100 文字）
  - `export const buildMnemonicPrompt = (slots: MnemonicSlots): string`
    → frontend `generatePrompt(slots)` と**文字列完全一致**
  - `export const parseMnemonicSlots = (value: unknown): MnemonicSlots | undefined`
    → DB jsonb の防御的検証。`kanji`/`shapeHint.part`/`shapeHint.picture`/`meaningHint`/`story` が
      string、`isSingleKanji` が boolean、サニタイズ後の `kanji` が非空でなければ `undefined`。
      （`card_mnemonics.slots` に形状 CHECK は無く、Remote MCP 経路もあるため必須）
- **正本は frontend `frontend/src/lib/illustration/prompt.ts`**（S-16B）。両ファイルの冒頭に
  相互参照コメント（「正本は◯◯／変更時は drift テストで一致を確認」）を入れる。
- drift 防止は **Vitest の出力一致テスト**（`frontend/tsconfig.json` の
  `allowImportingTsExtensions` により frontend 側テストから Deno モジュールを import して型検査も通る）。
  fixture は 単字 / 複数字 / 制御文字入り / 101 文字超 / 記号入り の 5 種以上。
- 型検査は既存 `npm --prefix frontend run test:s11:deno`（`deno check`）で、worker index からの
  推移的 import として自動的にカバーされる（ゲートのターゲット追加は不要）。

## D3: 未承認（slots 無し／不正形）ジョブ → **旧汎用プロンプトへのフォールバック（生成は続行）**

issue 本文は「スキップが E-16 方針として自然」と示しているが、**現行スキーマではスキップが
"カードごと失う" 以外の形で実装できない**ため採らない。根拠:

1. worker からジョブを terminal 失敗にすると `ai_s11_fail_concept_locked` が
   `ai_import_items.status='failed' / result_card_id=NULL` にし、カードは作られない
   （カード生成は `finalize_ai_import_concept` の中だけ）。ユーザーから見ると「画像が無い」ではなく
   「AI 作成したカードが消えた」になる。E-16 の「未承認は画像を作らない」は
   S-16E では *pending 行を作らない = 既存を温存* を意味しており、カード消失は含意しない。
2. 「カードは作るが画像だけ作らない」は `finalize_ai_import_concept` が
   `job.illustration_id IS DISTINCT FROM p_illustration_id` で CONFLICT を投げるため不可能で、
   finalize の契約変更＋`illustrations` ライフサイクル guard＋illustration 予約の返却処理まで
   波及する。これは本 issue（プロンプト品質）の範囲を超え、S-11 のコア不変条件に触る。

**決定**: `image_mode='ai'` で承認済み slots が取得できない場合は、既存
`generateIllustrationPrompt(backText, skill)` をそのまま使って生成を続行する。旧プロンプトの
「文字・テキストは一切描かないでください。」は**この経路では妥当**でもある（字形の手掛かりが無い状態で
漢字を描かせると誤字の画像を量産するため、描かせないほうが安全）。

follow-up として「未承認 ai ジョブは画像なしでカードだけ finalize する」を別 issue で提案する
（finalize 契約 + illustration lifecycle + 予約返却の設計が必要）。AC-3 は「承認済み経路で旧汎用
プロンプトが使われない」として満たす。

## D4: 旧 policy の撤去範囲と安全系の担保

- `illustration-prompt-policy.ts` は**削除しない**。D3 のフォールバック専用に残す
  （frontend `generator.ts` 経路は S-16E で既に新テンプレ化済みなので、旧 policy の利用箇所は
  ワーカーのフォールバックのみになる）。
- 承認済み経路では旧 policy を一切呼ばない（`parseClaimPrompt` の分岐で保証、テストで固定）。
- **安全系（AC-5）**: S-16B テンプレは「怖い/暴力/不適切の禁止」を含まない。末尾行
  （「画像内の文字は正確な『{kanji}』のみ…」）を末尾のまま保つ必要があるため、
  **【禁止事項】ブロックに 1 行 `・怖い表現、暴力的表現、不適切な表現` を追加**する。
  これは E-16 テンプレ正本の変更にあたるので、
  **frontend `prompt.ts`（正本）と Deno 実装の両方に同時に入れ、`prompt.test.ts` を更新**する
  （drift テストが一致を強制するので、片側だけの変更は CI で落ちる）。
  - 却下案: 末尾行の後ろに安全系を足す → AC-1 の「末尾指定」を壊す。
  - 却下案: 安全系を入れない → AC-5 を満たさない。
- サニタイズ（D2 の `sanitizePromptInput`）は差し込み 5 文字列すべてに適用（frontend 正本と同一）。

## D5: worker 側の配線

`supabase/functions/_shared/ai-card-import/supabase.ts`:

```ts
function parseClaimPrompt(row, imageMode): string | undefined {
  if (imageMode !== "ai") return undefined;
  const slots = parseMnemonicSlots(row.mnemonicSlots ?? row.mnemonic_slots);
  if (slots !== undefined) return buildMnemonicPrompt(slots);        // ★ 承認済み経路
  const backText = stringValue(row.backText ?? row.back_text);       // ← 既存のまま
  const skill = stringValue(row.skill);
  if (backText === undefined || (skill !== "reading" && skill !== "writing")) {
    throw new Error("RPC_CONTRACT_ERROR");
  }
  return generateIllustrationPrompt(backText, skill);                 // ★ 未承認フォールバック
}
```

`ClaimedConcept.prompt` の型・`obtainImage`・provider 呼び出しは無変更。
`worker.ts:454`（`prompt === undefined` → `PROVIDER_CONFIG_ERROR`）の意味も変わらない
（`imageMode='ai'` では必ず prompt が入る）。

## セキュリティ / 権限境界

- `card_mnemonics` の読み取りは **claim RPC 内のみ**、`owner_user_id = job.owner_user_id` の
  owner-scope 条件付き。PostgREST 経由の新しい読み取り面を作らない（service_role への GRANT なし）。
- SECURITY DEFINER + `SET search_path = pg_catalog, pg_temp` を維持。owner は
  `s10_migration_owner`（#55 で `card_mnemonics` も同 owner なので RLS バイパスで読める）。
- `PERFORM public.ai_s11_require_service_role();` を先頭に維持（呼び出し元の制限は不変）。
- 承認済み slots はユーザー入力由来なので、プロンプト差し込み前にサニタイズ（制御文字・長さ）。
  外部 API へ送るのは既に本人が承認した学習用テキストのみで、送信データ種別は変わらない。
- 新しい secret / 環境変数 / 外部依存は無し。

## Migration の適用範囲（停止確認事項）

- timestamp は `20260725000000`（既存最大は `20260724000000`。同一 prefix 衝突なし）。
- 本ストーリーでは **migration ファイルの作成と SQL 契約テストまで**行う。
  `supabase db push` などの **remote 適用は行わない**（`.claude/steering/implementation-flow.md` §7）。
  ローカル Supabase がある場合のみ適用検証し、無ければ「未実行」として報告する。
- ロールバック: 本 PR を revert すると claim RPC は S-11 定義に戻り（旧プロンプトに戻る）、
  データ変換は一切していないので追加作業は不要。

## リスク

| リスク | 影響 | 対応 |
|---|---|---|
| claim RPC の再定義ミスで S-11 の状態機械が壊れる | ジョブ処理停止 | 追加は DECLARE 1 行 + SELECT 1 文 + 返り値 1 キーのみ。SQL 契約テストで「既存文（reserve/UPDATE/RETURN のキー）が保持されている」ことを検査。DROP FUNCTION を書かない |
| S-16B 正本テンプレへの安全系 1 行追加が S-16B の期待出力を変える | 既存テスト失敗 | 同 PR で `prompt.test.ts` を更新。drift テストで両実装の一致を固定 |
| frontend / Deno の実装 drift | 品質差の再発 | Vitest 出力一致テスト（fixture 5 種以上）。両ファイルに相互参照コメント |
| 未承認ジョブで旧プロンプトが残る | 画像品質が旧のまま（カードは失われない） | 設計上の意図。follow-up issue で「画像なし finalize」を提案 |
| モデル側のプロンプト書き換え（dall-e-3）で字形指示が薄まる | 画像品質 | 本 issue の範囲外（`OPENAI_IMAGE_MODEL` 見直しは follow-up）。プロンプト長は上限内 |
| migration が remote 未適用のまま worker をデプロイ | `mnemonicSlots` が来ず全ジョブがフォールバック | 失敗ではなく現状維持に degrade する順序（worker 先行デプロイでも安全）。ship 時に migration → worker の順で適用することを PR に明記 |
