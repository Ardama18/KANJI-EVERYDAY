# S-16E Design

## 現状（Verified Current State）

- `frontend/src/actions/illustration-actions.ts` `triggerIllustrationGeneration(cardId)`:
  cards から `back_text`/`skill` を取得、illustrations の最新1件を owner+key で取得し
  transition（ready/pending は noop、failed は retry、無ければ insert）を判定、pending 行を
  insert/retry 後に `processIllustrationGeneration` を fire-and-forget。processArgs に `backText`/`skill` を載せる。
- `frontend/src/actions/illustration-generation-runtime.ts`: `ProcessIllustrationGenerationArgs`
  ＝ `{ illustrationId, illustrationKey, backText, skill, ownerUserId }`。差し替えインターフェース
  （default no-op / test setter）。**本番経路は未登録**。
- `frontend/src/lib/illustration/generator.ts`: `ProcessIllustrationGenerationInput`
  ＝ `{ illustrationId, illustrationKey, backText, skill, ownerUserId }`。
  現状 S-16B/S-16C 由来の暫定アダプタ（`backText → 仮 slots`：`shapeHint` 空・
  `isSingleKanji` は `Array.from(backText).length === 1`・`meaningHint`/`story` に `backText`）で
  `generatePromptFn(...)` を呼ぶ。Gemini 呼び出し・storage・status 遷移は現行どおり。
- `card_mnemonics`（S-16A migration）: `(owner_user_id, illustration_key)` UNIQUE、
  `slots jsonb`、`status text CHECK IN ('draft','approved')`、RLS は owner スコープ SELECT。
  commit RPC は `status='approved'` で upsert（S-16D）。`slots` の JSON 形状は
  canonical `MnemonicSlots`（`@/lib/illustration/prompt`）と一致：
  `{ kanji, isSingleKanji, shapeHint:{ part, picture }, meaningHint, story }`。

## 変更方針

### 1. `illustration-generation-runtime.ts`
- `ProcessIllustrationGenerationArgs` の `backText: string; skill: string;` を
  `slots: MnemonicSlots;` に差し替え（`import type { MnemonicSlots } from "@/lib/illustration/prompt"`）。
- default no-op / test setter は型追随のみ（挙動変更なし）。

### 2. `generator.ts`
- `ProcessIllustrationGenerationInput` の `backText`/`skill` を `slots: MnemonicSlots` に差し替え。
- 暫定アダプタ（137-144 行のコメント＋仮 slots 構築）を撤去し、`generatePromptFn(input.slots)` に置換。
- 未使用になる import（`IllustrationSkill`）を削除。`MnemonicSlots` を prompt から import。
- Gemini 呼び出し・storage・status 遷移・failure model_info は現行を完全踏襲。

### 3. `illustration-actions.ts`
- `card.illustration_key` 確定後、`findLatestIllustration` の前に owner スコープ＋`status='approved'`
  の `card_mnemonics` を1件取得する `findApprovedMnemonicForOwner` を追加
  （`.from("card_mnemonics").select("slots").eq("owner_user_id", ownerUserId)
  .eq("illustration_key", key).eq("status","approved").maybeSingle()`）。
- 承認レコードが無ければ **pending 化せず** `{ ok: true, started: false, illustrationId: null }` を返す
  （AC-2）。この分岐は illustrations の insert/retry より前に置き、副作用ゼロを保証。
- 取得した `slots`（jsonb）を `parseMnemonicSlots` で `MnemonicSlots` へ検証・正規化。
  形状不正なら承認なしと同様に skip（`started: false`）。
- processArgs を `{ illustrationId, illustrationKey, slots, ownerUserId }` に変更（`backText`/`skill` を撤去）。
- 承認判定は既存 ready/pending の noop 判定より前でも後でもよいが、pending 副作用の手前に置く。
  ready の場合は従来どおり `started: false` を返し旧イラストを温存（AC-3）。
- cards の `select` から不要になった `back_text`/`skill` を外す。`CardLookupRow` からも削除。
- 認証・所有権は Server 側で検証済み（`auth.getUser` + `owner_user_id` フィルタ）、RLS が最終防衛線。
  Server 用 `createServerClient` のみ使用（Browser client と混在させない）。server-only secret 非参照。

## セキュリティ / 不変条件
- `card_mnemonics` は owner スコープ＋`status='approved'` のみ取得。RLS を最終防衛線に。
- Browser/Server Supabase client 混在なし。`GEMINI_API_KEY`/`SERVICE_ROLE` をブラウザ用モジュールから参照しない。
- 旧 ready 画像は本 issue で一切変更・再生成しない。
