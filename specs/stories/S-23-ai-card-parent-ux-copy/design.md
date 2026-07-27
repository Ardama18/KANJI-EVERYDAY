# S-23 Design

## Current Investigation

- `frontend/src/components/ai-card-import/AiCardForm.tsx` is a client component that keeps `pattern` as `GenerationPattern` and submits the existing `GenerateCardDraftInput` payload.
- `frontend/src/components/ai-card-import/SourceUploadList.tsx` is rendered inside `AiCardForm` and owns the visible teaching-material image upload copy.
- `frontend/src/components/ai-card-import/DraftCardList.tsx` renders draft cards from `ClientImportItemInput` and uses `conceptId` only for pair synchronization and upload callbacks.
- Existing S-12 tests render `AiCardForm` with `renderToStaticMarkup`; `DraftCardList` currently has a regression test for pair text synchronization but no markup test.

## Approach

Keep all contract values unchanged and introduce display-only helpers in the two components.

- `AiCardForm` maps `R1`, `W1`, and `both` to Japanese labels and helper text while preserving radio `value`.
- `SourceUploadList` replaces the internal `source` wording with parent-facing teaching-material photo copy.
- The requested count label becomes parent-facing and the helper text explains whether the number is total cards or paired reading/writing cards.
- The `both` validation message changes from an internal-code phrase to Japanese copy.
- `DraftCardList` renders order-first headings such as `1枚目: 読み練習カード` and a short summary from front/back text.
- `DraftCardList` keeps `conceptId` available for React state, pairing, and upload callbacks, but does not expose it in the primary heading.
- Required upload copy explains that one shared picture is needed for the reading/writing pair.

## Impact

| Area | Impact |
|---|---|
| UI copy | Changed in `AiCardForm`, `SourceUploadList`, and `DraftCardList` |
| Payload/API/schema | No change |
| DB/RPC/MCP | No change |
| Tests | S-12 markup test strengthened and DraftCardList regression test expanded |

## Test Strategy

- L1 component markup tests verify that user-facing HTML contains the new Japanese labels and does not expose internal labels as visible text.
- Existing unit/integration tests continue to verify that `R1`, `W1`, and `both` contract values map correctly internally.
- Run `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, and relevant Vitest suites.

## Risks

- Static markup tests cannot perfectly distinguish attribute values from visible text, so tests should assert absence of old visible phrases and presence of new visible labels rather than forbidding payload values in `value` attributes.
- `conceptId` may still appear in non-visible callback values or test fixtures by design; this is allowed by AC-05.
