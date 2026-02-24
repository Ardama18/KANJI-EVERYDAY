---
id: S-07
feature: study-session-flow
type: plan
version: 1.0.0
created: 2026-02-24
based_on: specs/stories/S-07-study-session-flow/design.md
ui_design: none
---

# Plan: study-session-flow

## Phase 1: Server Actions
- [x] `frontend/src/actions/session-actions.ts` を追加
- [x] `startStudySession/getNextCard/revealCard/rateCard` を実装
- [x] `getStudySessionState` で再開状態を復元

## Phase 2: Study UI
- [x] `frontend/app/(auth)/decks/[deckId]/study/page.tsx` を実装
- [x] `frontend/src/components/study/StudyClient.tsx` を実装
- [x] `CardFront/CardBack/RatingButtons/SessionComplete` を追加

## Phase 3: Tests
- [x] `frontend/src/actions/session-actions.test.ts`
- [x] `frontend/src/app/decks/[deckId]/study/page.test.tsx`
- [x] `frontend/src/components/study/*.test.tsx`
- [x] `specs/stories/S-07-study-session-flow/tests/study-session-flow.int.test.ts`（骨子）
- [x] `specs/stories/S-07-study-session-flow/tests/study-session-flow.e2e.test.ts`（骨子）

## Quality Gate
- [x] `npm --prefix frontend run lint`
- [x] `npm --prefix frontend run typecheck`
- [x] 対象テスト実行（S-07追加分）
- [x] `npm --prefix frontend run check` 実行（既存S-04 DB依存テストは環境制約で失敗）
