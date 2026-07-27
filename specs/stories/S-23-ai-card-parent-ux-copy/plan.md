# S-23 Implementation Plan

## Phase 1: Form Copy

- Files:
  - `frontend/src/components/ai-card-import/AiCardForm.tsx`
  - `frontend/src/components/ai-card-import/SourceUploadList.tsx`
- Requirements: FR-01, FR-02, FR-03, FR-04, NFR-01
- Changes:
  - Add display metadata for `GenerationPattern`.
  - Replace visible `R1` / `W1` / `both` option labels with Japanese labels and helper text.
  - Replace `作成する枚数（展開後）` and the `both` count error with parent-facing Japanese.
  - Replace visible `教材source画像` copy with parent-facing teaching-material photo copy.
- Done when: submitted payload type and values are unchanged, visible form copy satisfies AC-01 and AC-03.

## Phase 2: Draft List Copy

- Files: `frontend/src/components/ai-card-import/DraftCardList.tsx`
- Requirements: FR-05, FR-06, FR-07, NFR-01, NFR-02
- Changes:
  - Add display helper for card pattern.
  - Replace `{pattern} / {conceptId}` heading with confirmation order and card purpose.
  - Add short front/back summary to aid parent review.
  - Replace `concept共有画像（必須）` with parent-facing required upload copy and reason.
- Done when: `conceptId` remains available for logic but is not the primary visible heading.

## Phase 3: Regression Tests

- Files:
  - `specs/stories/S-12-ai-card-openai-generation-ui/tests/ai-card-openai-generation-ui.e2e.test.ts`
  - `frontend/src/components/ai-card-import/DraftCardList.regression-1.test.ts`
- Requirements: NFR-03
- Changes:
  - Strengthen AiCardForm static markup test for new labels and old-copy absence.
  - Add DraftCardList static markup test for order, card purpose, image reason, and old heading absence.
- Done when: targeted Vitest tests fail on old copy and pass with new copy.

## Phase 4: Verification

- Commands:
  - `npm --prefix frontend run test:s12:unit`
  - `npm --prefix frontend run test:s12:e2e`
  - `npm --prefix frontend run test -- src/components/ai-card-import/DraftCardList.regression-1.test.ts`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run typecheck`
- Done when: all commands pass, diff confirms no API/schema/DB/RPC/MCP contract changes.
