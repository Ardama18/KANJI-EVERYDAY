---
id: S-07
feature: study-session-flow
type: design
version: 1.0.0
created: 2026-02-24
based_on: specs/stories/S-07-study-session-flow/requirements.md
---

# Design Doc: study-session-flow

## 1. Goal
- `startStudySession/getNextCard/revealCard/rateCard` を実装し、S-06 から学習セッションを開始できるようにする。
- 学習UIを `front -> back -> rating -> next|complete` で統一する。
- 中断再開時に `current_card_id` + `revealed` から表示状態を復元する。

## 2. Scope
- In scope:
  - `frontend/src/actions/session-actions.ts`
  - `frontend/app/(auth)/decks/[deckId]/study/page.tsx`
  - `frontend/src/components/study/*`
  - `frontend/src/actions/session-actions.test.ts`
  - `frontend/src/app/decks/[deckId]/study/page.test.tsx`
  - `frontend/src/components/study/*.test.tsx`
- Out of scope:
  - イラスト実表示（E-03）
  - R2/W2 パターン

## 3. Architecture
- Server Actions layer (`session-actions.ts`):
  - `startStudySession(deckId)`
    - owner check
    - active session reuse
    - queue 作成（S-05 buildSessionQueue）
  - `getNextCard(sessionId)`
    - queue先頭カード解決
    - `current_card_id` 更新 + front data返却
  - `revealCard(sessionId)`
    - `revealed` 切替
    - `intervalPreview` 付与
  - `rateCard(sessionId, rating)`
    - `calculateRating`
    - review_states upsert
    - queue更新
    - 次カード or 完了返却
  - `getStudySessionState(sessionId)`
    - page 初期化用の状態復元（front/back/complete）
- Page shell (`study/page.tsx`):
  - `session` クエリが無ければ `startStudySession` 実行
  - `getStudySessionState` 結果を `StudyClient` へ引き渡し
- Client UI (`StudyClient.tsx`):
  - local phase state 管理（front/back/loading/complete）
  - `revealCard/rateCard` 呼び出し

## 4. Data Contract
- `CardFrontData`: sessionId, cardId, skill/pattern, frontText, progress
- `CardBackData`: frontText/backText, intervalPreview, illustrationUrl(null)
- `RateResult`: `nextCard | null` + optional summary
- `StudySummary`: message + studiedUniqueCards

## 5. Security / Ownership
- 全 Action で `auth.getUser()` を必須化、未認証は `/login` リダイレクト。
- deck/session は `owner_user_id` / `user_id` 一致で検証。
- deckId 不一致セッションは page で `notFound()`。

## 6. Progress Rules
- `total`/`remaining` はユニークカード基準。
- retry queue は `remaining` に含めない。
- `studiedUniqueCards` は session.created_at 以降の review_states 更新済みユニークカードで算出。

## 7. UI Contract
- `CardFront`: prompt + frontText + `答えを見る`
- `CardBack`: front/back + イラスト準備中 + 評価ボタン
- `RatingButtons`: Again/Hard/Good 固定順、次回目安表示
- `SessionComplete`: 完了メッセージ + 学習カード数 + `/decks` 導線

## 8. Test Strategy
- Unit/Integration:
  - `session-actions.test.ts`: 認証、空セッション、完了更新、reveal data
  - `study/page.test.tsx`: 開始フロー、sessionクエリ、deck不一致
  - `study component tests`: front/back/button/complete 表示契約
- 既存全体チェック:
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run test`（DB依存の既知失敗除く）

## 9. AC Traceability
- AC#1-5: `startStudySession`, `session-actions.test.ts`
- AC#6-9: `getNextCard`, `session-actions.test.ts`
- AC#10-13: `revealCard/getStudySessionState`, `study/page.test.tsx`
- AC#14-19: `rateCard`, `session-actions.ts`
- AC#20-23: `SessionComplete` + `RatingButtons` + component tests
