# 実行計画: 学習設定表示の実出題枚数化

## Phase 1: 表示予定サマリの純粋関数

- `frontend/src/lib/deck/study-status.ts`
- `frontend/src/lib/deck/study-status.test.ts`

実装:

- `summarizePlannedStudy` を追加する。
- Due -> Learn -> New の順に `dailyStudyLimit - studiedToday` の残枠へ割り当てる。
- New は `newLimitPerDay` と残枠の小さい方で制限する。
- 新規カードが `newLimitPerDay` により抑制されたかを返す。

検証:

```bash
npm --prefix frontend test -- src/lib/deck/study-status.test.ts
```

## Phase 2: 一覧/詳細表示の更新

- `frontend/src/actions/deck-actions.ts`
- `frontend/src/components/deck/DeckCard.tsx`
- `frontend/src/components/deck/DeckCard.test.tsx`
- `frontend/app/(auth)/decks/[deckId]/page.tsx`
- `frontend/src/app/decks/[deckId]/page.test.tsx`
- `frontend/src/app/decks/page.test.tsx`
- `frontend/src/actions/deck-actions.test.ts`

実装:

- `DeckWithCounts` に `newLimitPerDay` を含める。
- 一覧バッジを予定内訳に切り替える。
- 詳細ページを `今日の出題予定` と `内訳` 表示へ切り替える。
- 学習設定コピーを `一日最大N枚 / 新規は最大M枚` にする。
- 新規カードが上限で抑えられている場合のみ補足文言を表示する。

検証:

```bash
npm --prefix frontend test -- src/components/deck/DeckCard.test.tsx src/app/decks/page.test.tsx src/app/decks/[deckId]/page.test.tsx src/actions/deck-actions.test.ts
```

## Phase 3: 最終品質ゲート

```bash
npm --prefix frontend run check
git diff --check
git status --short
```

UI は component markup と responsive class review で確認する。Playwright は未導入のため実ブラウザ E2E は本作業の gate に含めない。

補足:

- `npm --prefix frontend run check` の初回 lint で、今回の対象外だった `frontend/src/lib/deck/deck-delete-migration-contract.test.ts` の既存 Biome formatting 違反が検出された。全体 gate を通すため、挙動不変の改行整形のみを同差分に含める。
- 全体 Vitest は `S10_TEST_DATABASE_URL` 未設定の real DB 系 suite で停止するため、S-26 変更範囲は focused test、lint/typecheck、dummy public Supabase env 付き build で検証する。
