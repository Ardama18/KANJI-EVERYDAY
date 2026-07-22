# S-16E 実装計画 — 生成トリガーを承認済みスロット駆動に改修

単一情報源。全フェーズ・全タスクを記載順に実装する。`tasks/` や個別 task ファイルは生成・参照・更新しない。

## 前提の共有形状

`card_mnemonics.slots`（jsonb）は canonical `MnemonicSlots`（`@/lib/illustration/prompt`）と一致:
```
{ kanji: string; isSingleKanji: boolean; shapeHint: { part: string; picture: string }; meaningHint: string; story: string }
```

## Phase 1: 実装差し替えインターフェースの新シグネチャ化

対象: `frontend/src/actions/illustration-generation-runtime.ts`

- [x] 先頭に `import type { MnemonicSlots } from "@/lib/illustration/prompt";` を追加。
- [x] `ProcessIllustrationGenerationArgs` を
  `{ illustrationId: string; illustrationKey: string; slots: MnemonicSlots; ownerUserId: string }` に変更
  （`backText`/`skill` を削除、`slots` を追加）。
- [x] default no-op 実装・`__set*ForTest`/`__reset*ForTest` は挙動変更なし（型のみ追随）。

完了条件: 型エラーなし。

## Phase 2: generator を実 slots 駆動へ（暫定アダプタ撤去）

対象: `frontend/src/lib/illustration/generator.ts`

- [x] `ProcessIllustrationGenerationInput` の `backText: string;` と `skill: IllustrationSkill;` を
  `slots: MnemonicSlots;` に差し替え。
- [x] import を調整: `MnemonicSlots` を `./prompt` から import。`./types` の import から
  未使用になった `IllustrationSkill` を削除（他が使っていれば残す。要 grep 確認）。
- [x] `processIllustrationGeneration` 内の暫定アダプタ（`// S-16E で承認済み slots を配線するまでの暫定アダプタ...`
  コメントと `generatePromptFn({ kanji: input.backText, isSingleKanji: ..., shapeHint: { part:"", picture:"" },
  meaningHint: input.backText, story: input.backText })`）を撤去し、
  `const prompt = generatePromptFn(input.slots);` に置換。
- [x] Gemini 呼び出し・storage upload・status 遷移（ready/failed）・失敗時 model_info は現行を完全踏襲（変更しない）。

完了条件: 型エラーなし。暫定アダプタの痕跡（shapeHint 空・isSingleKanji 文字数近似・backText→仮slots）が残っていない。

## Phase 3: trigger を承認済み card_mnemonics 駆動へ

対象: `frontend/src/actions/illustration-actions.ts`

- [x] `card_mnemonics` 取得用の型・関数を追加:
  - `CardMnemonicRow = { slots: unknown }`（または `Json`）。
  - `TriggerSupabaseClient` に `from(table: "card_mnemonics")` オーバーロードを追加:
    `select("slots").eq("owner_user_id", value).eq("illustration_key", value).eq("status","approved").maybeSingle()`。
  - `findApprovedMnemonicForOwner({ supabase, illustrationKey, ownerUserId })` を追加し
    owner スコープ＋`status='approved'` で `slots` を1件取得（`maybeSingle`）。エラーは `assertNoQueryError`。
- [x] `parseMnemonicSlots(value: unknown): MnemonicSlots | null` を追加。
  `kanji:string`, `isSingleKanji:boolean`, `shapeHint:{part:string,picture:string}`,
  `meaningHint:string`, `story:string` を型ガードで検証し、揃わなければ `null`。
- [x] `triggerIllustrationGeneration` の流れを変更:
  1. 既存どおり auth → `findCardForOwner` → `illustration_key` 有無チェック。
  2. **追加**: `findApprovedMnemonicForOwner` を呼ぶ。行なし、または `parseMnemonicSlots` が `null` の場合は
     **insert/retry せず** `{ ok: true, started: false, illustrationId: null }` を返す（AC-2）。
  3. 既存の `findLatestIllustration` → `resolveShouldStartGeneration`（ready/pending は `started:false` で温存、AC-3）。
  4. insert/retry で pending 行を確保。
  5. processArgs を `{ illustrationId, illustrationKey, slots, ownerUserId }` に変更（`backText`/`skill` 撤去）。
     `slots` は Phase 3 で得た検証済み `MnemonicSlots`。
- [x] cards の `select` から `back_text, skill` を外し `select("id, owner_user_id, illustration_key")` にする。
  `CardLookupRow` から `back_text`/`skill` を削除。
- [x] `import type { MnemonicSlots } from "@/lib/illustration/prompt";` を追加。
- [x] Server 用 `createServerClient` のみ使用。Browser client と混在させない。server-only secret 非参照。

完了条件: 型エラーなし。承認なしで insert/update が呼ばれない。

## Phase 4: テスト追加・更新

### 4a. `frontend/src/lib/illustration/generator.test.ts`（更新 + 追加）
- [x] 既存4テストの input から `backText`/`skill` を削除し `slots: <MnemonicSlots>` に置換。
- [x] **追加 (Unit +1)**: `slots` がそのまま `generatePromptFn` に渡ることを検証
  （`generatePromptFn` の spy に対し `toHaveBeenCalledWith(slots)`。実 `generatePrompt` を使い
  出力プロンプトが `generateIllustrationFn` の `prompt` に渡ることを確認してもよい）。AC-1。

### 4b. `frontend/src/actions/illustration-actions.test.ts`（更新 + 追加）
- [x] Supabase double に `card_mnemonics` テーブルの from 分岐を追加し、承認 slots を返せるようにする
  （既定は承認済み slots ありにして既存の retry/insert テストが `started:true` を維持）。
- [x] 既存の `processMock` 期待値から `backText`/`skill` を削除し `slots` を含める（AC-1 の受け渡し）。
- [x] **追加 (Unit +1)**: 承認レコード無し（`card_mnemonics` maybeSingle が `null`）のとき
  `{ ok:true, started:false, illustrationId:null }` を返し、insert/update/processMock が
  呼ばれないことを検証。AC-2。

### 4c. Integration（+2）
- [x] `frontend/src/actions/` または適切な場所に統合寄りテストを追加/拡張:
  - trigger→生成（承認あり）: 承認 slots → pending 確保 → process 呼び出しに検証済み slots が渡る。
  - 未承認スキップ: 承認なし → pending 行が作られず生成起動しない。
  （既存の unit double 方式で AC を満たせる場合は 4b の拡張で代替可。新規ファイルを増やさず既存テストの
  it を追加する方針を優先。ただし Testing Plan の Integration +2 相当のケースを必ずカバーする。）

### 4d. 波及確認
- [x] `session-actions.test.ts` など `triggerIllustrationGeneration` / process args を参照するテストが
  新シグネチャで壊れていないか確認し、必要なら最小修正。

完了条件: `npm --prefix frontend run check` が pass。追加/更新テストが green。

## Phase 5: 品質ゲート

- [x] リポジトリルートで `npm --prefix frontend run check`（lint + typecheck + Vitest）を実行し pass を確認。
- [x] 変更が Server/Client 境界・環境変数・production build に触れないため `build` は任意。
  ただし import 変更で不安があれば `npm --prefix frontend run build` も実行。

## スコープ外（触れない）
- 承認 UI（S-16D）・表示（S-16F）・旧画像の一括再生成。
- 本番経路への runtime 実装登録（default no-op のまま）。
- migration / RLS / schema / seed の変更。
- 無関連ファイルの変更。
