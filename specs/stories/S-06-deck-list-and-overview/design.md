---
id: S-06
feature: deck-list-and-overview
type: design
version: 1.0.0
created: 2026-02-24
---

# Design Doc: deck-list-and-overview

## 1. Goal
- `/decks` と `/decks/[deckId]` を SSR で表示し、S-05 の `countByCategory` で New/Learn/Due を集計する。
- S-06 では `startStudySession` を実行せず、`/decks/[deckId]/study` への導線とプレースホルダ表示のみ提供する。

## 2. Scope
- In scope:
  - `frontend/src/actions/deck-actions.ts`
  - `frontend/app/(auth)/decks/page.tsx`
  - `frontend/app/(auth)/decks/[deckId]/page.tsx`
  - `frontend/app/(auth)/decks/[deckId]/study/page.tsx`
  - `frontend/src/components/deck/DeckCard.tsx`
- Out of scope:
  - 学習セッション生成（S-07）

## 3. Architecture
- Action layer:
  - `getDecksWithCounts`: 2段階取得
    - 1段階目: 所有デッキ一覧
    - 2段階目: `deck_cards + review_states` を deckId 群で取得
    - 集計: `countByCategory(cards, today)`
  - `getDeckOverview(deckId)`:
    - 対象デッキ取得（owner check）
    - デッキ内カード/復習状態取得
    - `countByCategory` と `total` 生成
- Page layer:
  - `/decks`: 一覧表示または空状態表示
  - `/decks/[deckId]`: 内訳 + total、`total=0` ならボタン無効
  - `/decks/[deckId]/study`: S-07待ちプレースホルダ

## 4. Security / Ownership
- 両 Action で `auth.getUser()` を必須化。
- 未認証は `redirect('/login')`。
- デッキ取得は `owner_user_id = auth.uid()` を条件化。
- 存在しない/所有外デッキは `getDeckOverview` で `null` を返し、ページ側で `notFound()`。

## 5. UI Contract
- `DeckCard`:
  - デッキ行全体が `/decks/{id}` へのリンク
  - バッジ色:
    - New: 青
    - Learn: 赤
    - Due: 緑
    - 0件: グレー（非表示にしない）
- 概要画面:
  - `total = new + learn + due`
  - `total > 0`: 「はじめる」リンク有効（`/decks/{id}/study`）
  - `total = 0`: ボタン disabled + 「今日の学習は完了しています」

## 6. Test Strategy
- Unit / Integration（frontend/src）:
  - `deck-actions.test.ts`: 認証、2段階取得、集計、overview null/total
  - `DeckCard.test.tsx`: リンクと0件グレー表示
  - `decks/page.test.tsx`: 空状態/一覧表示
  - `decks/[deckId]/page.test.tsx`: enabled/disabled/notFound
  - `decks/[deckId]/study/page.test.tsx`: プレースホルダ表示
- Regression:
  - S-01 互換のため `DECKS_STUB_MESSAGE` を互換エクスポート

## 7. AC Traceability
- AC#1, #4, #7: `app/(auth)/decks/page.tsx`, `src/app/decks/page.test.tsx`
- AC#2, #3: `src/actions/deck-actions.ts`, `src/actions/deck-actions.test.ts`
- AC#5, #6: `src/components/deck/DeckCard.tsx`, `src/components/deck/DeckCard.test.tsx`
- AC#8, #9, #10, #11, #12: `app/(auth)/decks/[deckId]/page.tsx`, `src/app/decks/[deckId]/page.test.tsx`
- AC#13: `app/(auth)/decks/[deckId]/page.tsx`（`startStudySession` 非依存）
- AC#14: `src/actions/deck-actions.ts`, `src/actions/deck-actions.test.ts`
- AC#15: `app/(auth)/decks/[deckId]/study/page.tsx`, `src/app/decks/[deckId]/study/page.test.tsx`
