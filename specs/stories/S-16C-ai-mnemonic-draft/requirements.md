# S-16C 要件定義

## 目的

ニーモニック穴埋め（`slots`）と表示用説明（`explanation`）の「AI 下書き」を、既存 `ai-card-generation` の
OpenAI アダプタ・moderation・利用量予約（`reserve_provider_usage`）を再利用して concept 単位で生成し、
`PreviewEnvelope` に optional な `mnemonicDraft` として搬送する。

## 検証済み現状（コード実測・2026-07-22）

- `frontend/app/api/ai/card-drafts/generate/route.ts`: `isAiCardImportEnabled` ゲート → 認証 → deck 所有権確認 →
  `generateCardDraft(...)` に moderation / `reserve_provider_usage`（`p_kind: "card_generation"`）/
  `requestOpenAiConcepts` / `previewCardImport`（HMAC 付き `PreviewEnvelope`）の依存を注入。エラーは
  `AiCardGenerationError` → `safeError(code, httpStatus)` で返す。
- `frontend/src/lib/ai-card-generation/contracts.ts`: `PreviewEnvelope`、`ResponsesPayload`（JSON Schema strict
  `kanji_card_concepts`、`concepts[].{kanjiSide, counterpartSide}`）、`OpenAiConceptOutput`。
- `frontend/src/lib/ai-card-generation/openai-adapter.ts`: `buildResponsesPayload`（strict schema を生成）＋
  `parseOpenAiResponse`（`concept` を `Object.keys(concept).length !== 2` 等で厳格検証）＋ `requestOpenAiConcepts`。
- `frontend/src/lib/ai-card-generation/output-mapper.ts`: `validateGenerationInput` / `expectedConceptCount` /
  `mapConceptsToImportRequest`（`OPENAI_OUTPUT_SCHEMA_MISMATCH` を投げる検証）。
- `frontend/src/lib/ai-card-generation/generation-service.ts`: `generateCardDraft` が moderation(input) →
  reserveUsage → requestConcepts → mapConceptsToImportRequest → moderation(output) → createPreview の順に実行。
- `frontend/src/lib/ai-card-generation/moderation.ts`: `moderate`（text/image、input/output stage、flaggedCode）。
- 正本データ形: `frontend/src/lib/illustration/prompt.ts` の `MnemonicSlots` /
  `MnemonicShapeHint`、`supabase/seed.sql` の `card_mnemonics` seed（`explanation.mappings` は 3 件例）。
- テスト配置: `specs/stories/S-12-ai-card-openai-generation-ui/tests/*.{test,int,e2e}.ts`（相対 import で
  `frontend/src/...` を参照）。generate route 専用テストは未作成。

## 受入条件（測定可能）

- AC-1: `buildResponsesPayload` が返す strict JSON Schema の各 concept に `mnemonic` オブジェクト（`slots` +
  `explanation`）が **required** で含まれ、`explanation.mappings` は `minItems: 2` / `maxItems: 4`。`slots` は
  `MnemonicSlots` 正本形（`kanji`, `isSingleKanji`, `shapeHint{part,picture}`, `meaningHint`, `story`）に一致。
- AC-2: `parseOpenAiResponse`（または新設の mnemonic 検証）が `mnemonic` の欠損・型不一致・`mappings` 件数境界
  （2 未満 / 4 超）・過長を検出し `OPENAI_OUTPUT_SCHEMA_MISMATCH` を投げる。正常系は `mnemonicDraft` を含む結果を返す。
- AC-3: moderation は既存の input/output 両段のみを使う（mnemonic テキストは output 段の対象文字列に含める）。
  新規 moderation 段・新規 flaggedCode を追加しない。フラグ時は既存 `OPENAI_*_MODERATION` コードで返る。
- AC-4: `reserve_provider_usage` は既存同様 `p_kind: "card_generation"` の枠内で記録する。新 kind・新 units 種別を追加しない。
- AC-5: `PreviewEnvelope.mnemonicDraft` は optional。未設定でも既存 UI・既存 route レスポンス契約を壊さない（後方互換）。
- AC-6: `npm --prefix frontend run check`（lint + typecheck + vitest）通過。

## 非機能・制約

- server-only secret（`OPENAI` / service role）をブラウザ用モジュールへ露出しない。
- Browser/Server Supabase client を混在させない。
- 既存の未関連ファイルを変更しない。最小差分。
- Feature flag は既存 `isAiCardImportEnabled` を流用（新フラグを増やさない）。

## スコープ外

- 承認 UI・`card_mnemonics` への保存（S-16D）。
- 画像生成への `slots` 配線（S-16E）。
- 新規 migration / RLS / DB 型変更（S-16A で完了済み。本 Story は SQL に触れない）。
