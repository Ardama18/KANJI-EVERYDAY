---
id: S-06
feature: deck-list-and-overview
type: plan
version: 1.0.0
created: 2026-02-24
---

# Plan: deck-list-and-overview

## 実装フェーズ

### Phase 1: Action 実装
- [x] `frontend/src/actions/deck-actions.ts` を追加
- [x] `getDecksWithCounts` を2段階取得で実装（0件時1クエリ、通常最大2クエリ）
- [x] `getDeckOverview` を owner check + null返却で実装
- [x] 未認証時 `/login` リダイレクトを実装

### Phase 2: UI 実装
- [x] `frontend/src/components/deck/DeckCard.tsx` を追加
- [x] `/decks` 一覧ページをSSR実装
- [x] `/decks/[deckId]` 概要ページをSSR実装
- [x] `/decks/[deckId]/study` プレースホルダページを追加

### Phase 3: テスト実装
- [x] `frontend/src/actions/deck-actions.test.ts`
- [x] `frontend/src/components/deck/DeckCard.test.tsx`
- [x] `frontend/src/app/decks/page.test.tsx`
- [x] `frontend/src/app/decks/[deckId]/page.test.tsx`
- [x] `frontend/src/app/decks/[deckId]/study/page.test.tsx`

### Phase 4: 回帰対応
- [x] S-01回帰テスト互換（`DECKS_STUB_MESSAGE` 互換エクスポート）

## 品質ゲート
- [x] `npm run lint --prefix frontend`
- [x] `npm run typecheck --prefix frontend`
- [x] S-06/S-01対象テスト実行
- [ ] `npm run check --prefix frontend`（S-04 DBテスト環境障害で失敗: `pg_filenode.map` I/O error）

## 備考
- `npm run check --prefix frontend` の失敗は今回差分ではなく、既存 S-04 DB依存テストがローカルPostgres障害で失敗していることが原因。
