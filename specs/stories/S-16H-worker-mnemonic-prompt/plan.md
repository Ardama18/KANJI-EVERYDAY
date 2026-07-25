# S-16H 作業計画

設計は `design.md`（D1〜D5）。この計画書が実装の単一情報源。`tasks/` は作らない。

## Phase 1: S-16B テンプレの Deno 等価実装（正本側の安全系追記を含む）

### T1-1 正本テンプレに安全系 1 行を追加（D4）
- 対象: `frontend/src/lib/illustration/prompt.ts`
- 【禁止事項】ブロックの `・ロゴ、透かし` の直前 or 直後に `・怖い表現、暴力的表現、不適切な表現` を追加。
  末尾行（`画像内の文字は正確な「{kanji}」のみとし、正方形、高解像度で作成してください。`）は
  必ず最終行のまま維持する。
- 冒頭に「このファイルが S-16B テンプレの正本。Edge Function 実装
  `supabase/functions/_shared/mnemonic-prompt.ts` と出力一致を保つこと」のコメントを追加。
- 対象: `frontend/src/lib/illustration/prompt.test.ts` — 【禁止事項】の期待値に安全系行を追加
  （既存の 6 ブロック / 末尾 / サニタイズ検証は壊さない）。

### T1-2 Deno 側モジュールを新規作成
- 新規: `supabase/functions/_shared/mnemonic-prompt.ts`（import ゼロの pure TS）
  - `MnemonicShapeHint` / `MnemonicSlots` 型
  - `sanitizePromptInput`（制御文字除去 + 100 文字。既存 2 実装と同一仕様）
  - `buildMnemonicPrompt(slots)` — T1-1 適用後の frontend `generatePrompt` と文字列完全一致
  - `parseMnemonicSlots(value: unknown)` — jsonb 防御検証。string/boolean 型チェックと
    サニタイズ後 `kanji` 非空を満たさなければ `undefined`
  - 冒頭に「正本は `frontend/src/lib/illustration/prompt.ts`」コメント
- 完了条件: `npm --prefix frontend run typecheck` と後続 T4-1 の一致テストが通る。

## Phase 2: claim RPC の migration（承認済み slots の同一 TX 取得・D1）

> **停止確認事項**: migration を含む。remote への適用はこの計画に含めない（ファイル作成 + SQL 契約
> テストまで）。ローカル Supabase がある場合のみ適用検証し、無ければ「未実行」として報告する。

### T2-1 migration ファイル作成
- 新規: `supabase/migrations/20260725000000_s16h_claim_returns_mnemonic_slots.sql`
- 内容（`design.md` D1 の具体そのまま）:
  1. 冒頭コメントで根拠（issue #59 / #55 の owner 前提 / DROP しない理由）を記述
  2. `CREATE OR REPLACE FUNCTION public.claim_ai_import_concept(p_job_id uuid, p_message_id bigint, p_claim_token uuid)`
     — S-11 `20260715000000_s11_ai_card_async_processing.sql:982-1035` の本体を保持し、
     `DECLARE mnemonic_slots jsonb;` と `image_mode='ai'` 時の owner-scope join、
     返り値への `'mnemonicSlots', mnemonic_slots` 追加のみを差分とする
  3. `ALTER FUNCTION public.claim_ai_import_concept(uuid,bigint,uuid) OWNER TO s10_migration_owner;`
- 禁止事項: `DROP FUNCTION` を書かない / GRANT・REVOKE を書かない / 他の RPC・テーブル・policy・
  trigger を触らない / データ更新文を書かない。
- 完了条件: T4-3 の SQL 契約テストが通る。

## Phase 3: ワーカーのプロンプト配線（D3/D5）

### T3-1 `parseClaimPrompt` を slots 駆動にする
- 対象: `supabase/functions/_shared/ai-card-import/supabase.ts`
- `buildMnemonicPrompt` / `parseMnemonicSlots` を `../../mnemonic-prompt.ts` から import
- `parseClaimPrompt(row, imageMode)`:
  1. `imageMode !== "ai"` → `undefined`（現行どおり）
  2. `parseMnemonicSlots(row.mnemonicSlots ?? row.mnemonic_slots)` が有効 → `buildMnemonicPrompt(slots)`
  3. それ以外 → 既存の `backText`/`skill` 検証 → `generateIllustrationPrompt(backText, skill)`
     （欠落時の `RPC_CONTRACT_ERROR` は現行どおり維持）
- `generateIllustrationPrompt` の import は残す（未承認フォールバック用）。
  `illustration-prompt-policy.ts` 自体は変更しない（安全系 3 表現もそのまま）。
- 非変更: `ClaimedConcept` 型、`worker.ts`、`provider.ts`、`providers/openai.ts`、ログ enum、
  `SafeImportErrorCode`。

## Phase 4: テスト

### T4-1 Deno テンプレ実装の単体テスト（+1 ファイル / 6 ケース程度）
- 新規: `frontend/src/lib/illustration/worker-mnemonic-prompt.test.ts`
  （`../../../../supabase/functions/_shared/mnemonic-prompt.ts` を相対 import）
- ケース:
  1. 単字: 全ブロック見出し（正確な字形/形の手掛かり/意味の手掛かり/記憶の物語/構成/禁止事項）と
     slots 差し込みが出る（AC-1）
  2. 単字: 末尾行が `画像内の文字は正確な「{kanji}」のみとし、正方形、高解像度で作成してください。`（AC-1）
  3. 複数字: 【形の手掛かり】と部首→絵マッピングが出ない／【正確な字形】は維持／
     【記憶の物語】が語全体 1 場面（AC-2）
  4. サニタイズ: 制御文字除去・101 文字→100 文字（AC-5）
  5. 安全系: 【禁止事項】に `怖い表現、暴力的表現、不適切な表現` を含む（AC-5）
  6. `parseMnemonicSlots`: 正常 jsonb を通し、型不正・`shapeHint` 欠落・空 kanji・null を
     `undefined` にする（AC-4）

### T4-2 drift 防止テスト（+1 ファイル / 1 ケース）
- 新規: `frontend/src/lib/illustration/worker-prompt-parity.test.ts`
- frontend `generatePrompt(slots)` と Deno `buildMnemonicPrompt(slots)` の出力が
  fixture 5 種以上（単字・複数字・制御文字入り・101 文字超・記号/絵文字入り）で完全一致することを検証。
- `sanitizePromptInput` の出力一致も同時に検証。

### T4-3 claim RPC migration の SQL 契約テスト（+1 ファイル / 5 ケース程度）
- 新規: `frontend/src/lib/card-mnemonics/claim-mnemonic-slots-migration-contract.test.ts`
  （`owner-fix-migration-contract.test.ts` と同じ read+normalize 方式）
- ケース:
  1. `create or replace function public.claim_ai_import_concept` を含み、
     `drop function` を含まない
  2. join が owner-scope（`mnemonics.owner_user_id = job.owner_user_id`）かつ
     `mnemonics.status = 'approved'` を条件に持つ
  3. 返り値に `'mnemonicslots'` を含み、既存キー（`backtext` / `skill` / `illustrationid` /
     `imagemode` / `claimtoken`）も保持している
  4. `alter function public.claim_ai_import_concept(uuid,bigint,uuid) owner to s10_migration_owner` を含む
  5. `grant` / `revoke` / `create policy` / `alter table` / `update public.` / `delete from` /
     `truncate` を含まない（権限とデータに触らない）
  6. timestamp prefix が既存 migration と衝突しない（`supabase/migrations` の一覧を読んで確認）

### T4-4 worker プロンプト分岐のテスト（+1 ファイル / 4 ケース）
- 新規: `frontend/src/lib/card-mnemonics/worker-claim-prompt.test.ts`
  （`supabase/functions/_shared/ai-card-import/supabase.ts` の `createSupabaseDatabase` を
  `fetchImplementation` スタブで呼び、`claim()` の返り値 `prompt` を検証）
- ケース:
  1. `mnemonicSlots` あり（単字）→ prompt が S-16B テンプレ（先頭行・末尾行一致）で、
     旧文言 `文字・テキストは一切描かないでください。` を含まない（AC-1/AC-3）
  2. `mnemonicSlots` あり（複数字）→ 部首→絵マッピングを含まない（AC-2）
  3. `mnemonicSlots` なし → 旧 `generateIllustrationPrompt` 出力にフォールバック（AC-4）
  4. `mnemonicSlots` が不正形（型違い / shapeHint 欠落）→ フォールバック（AC-4）
  5. `imageMode='upload'` / `'none'` → `prompt` が `undefined`（回帰防止）

### T4-5 統合テスト（環境依存・任意）
- 対象: `specs/stories/S-11-ai-card-async-processing/tests/ai-card-async-processing.int.test.ts`
- `S10_TEST_DATABASE_URL` がある場合のみ: 承認済み `card_mnemonics` を入れたジョブで
  `claim_ai_import_concept` を呼び、返り値に `mnemonicSlots` が入る／別 owner の行では入らないことを検証。
- **URL が無い環境では実行しない**（既存 `*.int.test.ts` と同じ env ゲート方針）。実行できなかった場合は
  完了報告に「未実行（S10_TEST_DATABASE_URL 未設定）」と明記する。

## Phase 5: 品質ゲート

```bash
npm --prefix frontend run check          # lint + typecheck + vitest
npm --prefix frontend run test:s11:deno  # deno check（新モジュールは worker 経由で推移的に検査）
```
- `build` は不要（ルーティング / Server Component / 環境変数 / production bundling に影響しない）。
- `deno` 未インストールの環境では `test:s11:deno` が `not_run`(exit 2) を返す。その場合は
  フォールバックせず「未実行」として報告する（ゲートのフォールバックは禁止）。

## 完了条件（AC 対応表）

| AC | 満たす成果物 | 検証 |
|---|---|---|
| AC-1 S-16B テンプレ化 | T1-2 / T3-1 / T2-1 | T4-1(1,2) / T4-4(1) |
| AC-2 複数字で部首マッピング無し | T1-2 | T4-1(3) / T4-4(2) |
| AC-3 承認経路で旧プロンプト不使用 | T3-1 | T4-4(1) |
| AC-4 未承認の扱い（フォールバック） | T3-1 | T4-1(6) / T4-4(3,4) |
| AC-5 サニタイズ・安全系維持 | T1-1 / T1-2 | T4-1(4,5) / T4-2 |
| AC-6 check + deno check | 全体 | Phase 5 — **部分達成**（→「AC-6 の達成状況」） |
| drift 防止 | T1-1 / T1-2 | T4-2 |

## 変更ファイル一覧（想定 9 ファイル + 任意 1）

新規 6:
- `supabase/functions/_shared/mnemonic-prompt.ts`
- `supabase/migrations/20260725000000_s16h_claim_returns_mnemonic_slots.sql`
- `frontend/src/lib/illustration/worker-mnemonic-prompt.test.ts`
- `frontend/src/lib/illustration/worker-prompt-parity.test.ts`
- `frontend/src/lib/card-mnemonics/claim-mnemonic-slots-migration-contract.test.ts`
- `frontend/src/lib/card-mnemonics/worker-claim-prompt.test.ts`

変更 3:
- `frontend/src/lib/illustration/prompt.ts`（安全系 1 行 + 正本コメント）
- `frontend/src/lib/illustration/prompt.test.ts`（期待値更新）
- `supabase/functions/_shared/ai-card-import/supabase.ts`（`parseClaimPrompt` 分岐）

任意 1:
- `specs/stories/S-11-ai-card-async-processing/tests/ai-card-async-processing.int.test.ts`（env ゲート）

## デプロイ順序（PR に明記する）

1. migration 適用（`claim_ai_import_concept` が `mnemonicSlots` を返すようになる）
2. Edge Function `ai-card-import-worker` を再デプロイ

逆順でも安全に degrade する（`mnemonicSlots` が来ない間はフォールバックで旧プロンプト）。
remote 適用はユーザー承認のうえ ship 時に実施する。

## 実装完了記録

- [x] T1-1 正本テンプレに安全系 1 行 + 正本コメントを追加（`prompt.ts` / `prompt.test.ts`）
- [x] T1-2 Deno 側モジュール `supabase/functions/_shared/mnemonic-prompt.ts` を新規作成
- [x] T2-1 migration `20260725000000_s16h_claim_returns_mnemonic_slots.sql` を作成（remote 未適用）
- [x] T3-1 `parseClaimPrompt` を slots 駆動にし、未承認は旧 policy へフォールバック
- [x] T4-1 Deno テンプレ実装の単体テスト（9 ケース。うち 3 ケースは review 指摘 F-4 で追加した
      `parseMnemonicSlots` の防御ケース）
- [x] T4-2 drift 防止テスト（fixture 5 種の出力一致）
- [x] T4-3 claim RPC migration の SQL 契約テスト（7 ケース）
- [x] T4-4 worker プロンプト分岐のテスト（6 ケース）
- [x] T4-5 統合テスト追記（IT-S16H-01〜05・`S10_TEST_DATABASE_URL` env ゲート・未設定環境では skip）。
      IT-S16H-05 は `illustrations` と `card_mnemonics` をどちらも ownerB に揃えて join の ON 条件を
      成立させ、ジョブ側 owner だけを ownerA にすることで、migration の
      `WHERE mnemonics.owner_user_id = job.owner_user_id` を behavioral に固定する。
- [ ] Phase 5 `npm --prefix frontend run check` — **lint / typecheck / vitest は pass だが、env ゲート
      3 suite により終了コードは非ゼロ**。lint **pass** / typecheck **pass** /
      vitest **1017 passed・25 skipped・test failure 0 件**。
      - ただし `check` 自体は**非ゼロ終了する**。`S10_TEST_DATABASE_URL` 未設定のため次の 3 suite が
        収集時に throw して FAIL する（S-16H とは無関係の既知の環境依存。いずれも S-16H の差分に含まれない）。
        - `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
        - `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts`
        - `frontend/src/lib/ai-card-management/real-db.int.test.ts`
- [ ] Phase 5 `npm --prefix frontend run test:s11:deno` — **FAIL（S-16H 起因ではない既存ゲート不良）**
      - deno 2.9.4（TypeScript 6.0.3）をローカルへ導入して**実行済み**。
        「deno 未インストールで `not_run`」という以前の記録は誤りだったため訂正する。
      - 失敗箇所は `supabase/functions/_shared/ai-card-import/magick-codec.ts:95` の
        `WebAssembly.compile(bytes)`。TS2769（`Uint8Array<ArrayBufferLike>` が `BufferSource` に
        不適合）。deno 2.9.4 / TypeScript 6.0.3 の lib 変更由来。
      - S-16H は `magick-codec.ts` を変更していない（`git diff HEAD -- .../magick-codec.ts` が空）。
        同ファイル単体の `deno check` でも同一エラーで失敗するため、pristine HEAD でも再現する既存不良。
      - 代替確認: S-16H が追加/変更した Deno 側 2 ファイルは個別の `deno check` で **pass**（exit 0）。
        ゲート（`s11-deno-gate.ts`）と同じ `--config` を渡して同条件で検査している。
        `deno check --config supabase/functions/deno.json supabase/functions/_shared/mnemonic-prompt.ts supabase/functions/_shared/ai-card-import/supabase.ts`
      - ゲートのフォールバックはしない。`magick-codec.ts` の型エラーは本ストーリー外の別 issue とする。
- [ ] migration の remote 適用（`supabase db push`）— **未実行**（ship 時にユーザー承認のうえ実施）
- [ ] Edge Function `ai-card-import-worker` の再デプロイ — **未実行**（同上）
- [ ] migration のローカル適用検証と IT-S16H-01〜05 の実行 — **未実行**。
      port 54322 で稼働している local Supabase は別 worktree（`issue-10-clone`）のもので、適用済み
      migration は `20260719000000` まで＝`card_mnemonics`（`20260721000001`）も #55 の owner fix も
      含まない。他 worktree の環境を書き換えることになるため適用しない。
      `S10_TEST_DATABASE_URL` も未設定なので統合テストは skip のままであり、
      claim RPC の実 DB 挙動（`mnemonicSlots` の返却と owner-scope 除外）は未検証。
      SQL 契約テスト（T4-3・静的な SQL 文字列検証）と worker 側の分岐テスト（T4-4）でのみ担保している。

### AC-6 の達成状況: **部分達成**

- 達成: `check` の lint / typecheck / unit（vitest）はいずれも pass（test failure 0 件）。
- 未達: `test:s11:deno` は既存の `magick-codec.ts` 型エラーにより FAIL。S-16H 起因ではないが、
  ゲートとしては未達のまま。別 issue 化を推奨する。
- 未検証: claim RPC の実 DB 挙動。上記の理由でローカル / remote いずれも適用していない。

## code-review 指摘対応

- [x] F-1 [Medium] Phase 5 の完了記録を実測に合わせて訂正（`check` の実測値、`test:s11:deno` の
      FAIL とその原因、AC-6 部分達成、未検証範囲を明記）。
- [x] F-2 [Low] IT-S16H-05 を追加し、`claim_ai_import_concept` の
      `WHERE mnemonics.owner_user_id = job.owner_user_id` を behavioral に固定。
      従来の cross-owner fixture（`illustrations`=ownerA / `card_mnemonics`=ownerB）は join の
      ON 条件だけで除外されるため WHERE 句を消しても pass してしまっていた。
      新 fixture は両者を ownerB へ揃え、ジョブ側 owner だけを ownerA にする。
- [x] F-4 [Low] `parseMnemonicSlots` の防御テストを追加
      （`__proto__` 経由の payload と `Object.prototype` 非汚染 / 数値・boolean・真偽値文字列などの
      primitive / `shapeHint` が配列・null・primitive のケース）。

## follow-up 候補（本ストーリー外）

- `supabase/functions/_shared/ai-card-import/magick-codec.ts:95` の `WebAssembly.compile(bytes)` が
  deno 2.9.4 / TypeScript 6.0.3 で TS2769 になり `test:s11:deno` ゲートが通らない（既存不良）。
- 未承認 ai ジョブを「画像なしでカードだけ finalize」する設計（`finalize_ai_import_concept` の
  契約変更 + illustration lifecycle guard + illustration 予約の返却）。
- `OPENAI_IMAGE_MODEL` の見直し（dall-e-3 のプロンプト書き換えが字形指示を薄める懸念）。
