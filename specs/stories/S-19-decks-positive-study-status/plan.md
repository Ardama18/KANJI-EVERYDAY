# S-19 実装計画

- 対象 issue: #63 / branch: `issue/63-decks-study-progress`
- 規模: 中規模（表示のみ・frontend 完結。migration / RLS / 認証 / 外部 API / 環境変数の変更なし）
- 前提: `requirements.md` と `design.md` を正本とする。SRS の分類・スケジュール・出題キュー・日次上限のロジックは変更しない。
- 原則: 各 Phase でテストを同時に追加し、Phase 完了時にそのファイル範囲の Vitest を通す。既存の未関連変更を巻き戻さない。

## Phase 1: 純関数の土台（date / srs / study-status）

| # | 対象ファイル | 作業 |
|---|---|---|
| 1-1 | `frontend/src/lib/date.ts` | `formatJstMonthDay(date: string): string` を追加。既存 `parseJstDate` を再利用し `M月D日`（先頭0なし）を返す。不正形式は既存と同じ `Invalid JST date format` で throw。既存 export は変更しない |
| 1-2 | `frontend/src/lib/date.test.ts` | `formatJstMonthDay`: `2026-03-01` → `3月1日`、`2026-12-25` → `12月25日`、不正形式で throw |
| 1-3 | `frontend/src/lib/srs/classify.ts` | `findNextDueDate(cards: readonly CardWithState[], today: string): string \| null` を追加。`reviewState !== null && reviewState.dueDate > today` の最小 `dueDate`。既存 3 関数は無変更 |
| 1-4 | `frontend/src/lib/srs/index.ts` | `findNextDueDate` を `classify` から re-export（既存 export の並び順・命名規則に合わせる） |
| 1-5 | `frontend/src/lib/srs/classify.test.ts` | `findNextDueDate`: 複数未来 due で最小値 / 今日以前のみ → `null` / `reviewState=null` のみ → `null` / 空配列 → `null` |
| 1-6 | `frontend/src/lib/deck/study-status.ts`（新規ディレクトリ・新規ファイル） | 文言定数と純関数を実装。`next/headers`・Supabase・`server-only` を import しない。<br>定数: `DECK_STUDY_NO_CARDS_MESSAGE = "カードがまだありません"`、`DECK_STUDY_DONE_MESSAGE = "きょうのぶんは おわり！"`、`DECK_STUDY_LIMIT_REACHED_MESSAGE = "きょうはここまで！またあした"`、`DECK_STUDY_NO_NEXT_DUE_MESSAGE = "つぎの よていは まだないよ"`、ラベル定数 `DECK_LABEL_NEW = "あたらしい"` / `DECK_LABEL_REVIEW = "ふくしゅう"` / `DECK_LABEL_STUDIED_TODAY = "きょうやった"`。<br>`formatNextDueLabel(nextDueDate, today)`: `getTomorrowJST(today)` と一致なら `"あした"`、それ以外は `formatJstMonthDay`。<br>`resolveDeckStudyStatus(input)`: `design.md` D-5 の判定順序・戻り値（`kind` / `remainingToday` / `message` / `nextDueMessage`）を実装。`nextDueMessage` は `done` と `limit-reached` のときのみ非 `null`（`nextDueDate` があれば `つぎは {label}`、なければ `DECK_STUDY_NO_NEXT_DUE_MESSAGE`） |
| 1-7 | `frontend/src/lib/deck/study-status.test.ts`（新規） | 4 kind すべて / 優先順位（`todayCount>0 && remaining=0` → `limit-reached`、`totalCards=0` は最優先）/ `remainingToday = max(0, limit - studiedToday)` / `nextDueMessage` 3 パターン（翌日 → `あした`、先の日付 → `M月D日`、なし → 予定なし文言）/ `todo` では `nextDueMessage` が `null` |

**完了条件**

```bash
npm --prefix frontend run test -- src/lib/date.test.ts src/lib/srs/classify.test.ts src/lib/deck/study-status.test.ts
```

型エラー 0・lint エラー 0。既存 SRS テスト（`calculate` / `queue` / `classify` 既存ケース）が緑のまま。

## Phase 2: Server Action の返り値拡張

| # | 対象ファイル | 作業 |
|---|---|---|
| 2-1 | `frontend/src/actions/deck-actions.ts` | `DeckWithCounts` に `studiedToday: number` と `nextDueDate: string \| null` を追加。`DeckOverview` に `nextDueDate: string \| null` を追加 |
| 2-2 | 同上 | `getDecksWithCounts` の map で、デッキごとの `cards` を1度だけ取り出し（現状の二重 `cardsByDeck.get()` を1変数に整理）、既存 private `countCardsReviewedOnJstDate(cards, today)` と `findNextDueDate(cards, today)` を呼んで両フィールドを埋める。追加クエリは作らない |
| 2-3 | 同上 | `getDeckOverview` に `nextDueDate: findNextDueDate(cards, today)` を追加。`studiedToday` / `remainingToday` の既存算出は変更しない |
| 2-4 | `frontend/src/actions/deck-actions.test.ts` | 追加ケース:<br>・`getDecksWithCounts` が `studiedToday` / `nextDueDate` を返す<br>・JST 境界: `last_reviewed_at = 2026-02-23T15:00:00.000Z`（JST 2026-02-24 00:00）が `today=2026-02-24` の `studiedToday` に含まれ、`2026-02-23T14:59:59.000Z` は含まれない（`vi.setSystemTime` で固定）<br>・同一デッキ・同一 fixture で `getDecksWithCounts[0].studiedToday === (await getDeckOverview(id)).studiedToday`<br>・未来 due が無いとき `nextDueDate === null`、複数あるとき最小値<br>・同一カードを複数回 review しても 1 枚として数える（既存ユニーク性の回帰） |

**完了条件**

```bash
npm --prefix frontend run test -- src/actions/deck-actions.test.ts
```

Supabase 呼び出し回数が変わらないこと（`deck_cards` / `review_states` の `select` mock 呼び出し回数が既存ケースと同じ）を assertion か目視で確認。認証・所有権チェックの既存コードに差分がないこと。

## Phase 3: UI（一覧・詳細）

| # | 対象ファイル | 作業 |
|---|---|---|
| 3-1 | `frontend/src/components/deck/DeckCard.tsx` | `BadgeKind` を `"new" \| "review"` に整理（`learn` / `due` の2色は廃止、`review` は緑系1色）。`resolveDeckStudyStatus` を呼び、`kind` に応じて表示を切替（`design.md` 3章の一覧仕様）。サブ行を `カード {totalCards}枚 ・ 学習した {learnedCards}枚` に変更し `scheduledCards` の表示を削除。`きょうやった {studiedToday}枚` pill を常時表示（0 はグレー）。`"use client"` は追加しない。`new Date()` を使わない |
| 3-2 | `frontend/app/(auth)/decks/[deckId]/page.tsx` | 「今日の学習」の `StatCard` を `あたらしい` / `ふくしゅう`（`learn+due`）/ `きょうやった` に変更。補助行を `今日やること {counts.total}枚 / 今日やれる残り {remainingToday}枚` に変更。完了文言の inline 4 分岐を `resolveDeckStudyStatus` に置換し、`canStartStudy` を `kind === "todo"` に統一。`nextDueMessage` を完了/上限時に表示。「全体状態」→「これまでの記録」、`学習済み` → `学習した数`、`将来予定` → `つぎの予定`。学習設定行を `一日最大 {n}枚 / きょうやった {n}枚` に変更 |
| 3-3 | 同上 | 旧 export 定数 `DECK_OVERVIEW_EMPTY_MESSAGE` / `DECK_OVERVIEW_SCHEDULED_MESSAGE` / `DECK_OVERVIEW_LIMIT_REACHED_MESSAGE` / `DECK_OVERVIEW_NO_CARDS_MESSAGE` を廃止し、文言は `@/lib/deck/study-status` の定数に集約。`DECK_OVERVIEW_START_LABEL` は維持（他に import 元が無いことを確認済み） |
| 3-4 | `frontend/src/components/deck/DeckCard.test.tsx` | 既存2ケースを新ラベルへ更新し、追加: キューあり（`ふくしゅう` = learn+due 合算値）・`きょうやった` 表示・完了＋次回予定日・完了かつ予定なし・`totalCards=0`・`New`/`Learn`/`Due` が HTML に出ないこと |
| 3-5 | `frontend/src/app/decks/[deckId]/page.test.tsx` | 既存5ケースの fixture に `nextDueDate` を追加し、文言 assertion を新定数へ移行。追加: `きょうやった` の StatCard 表示、完了時の `つぎは {日付}`、翌日なら `つぎは あした` |
| 3-6 | `frontend/src/app/decks/page.test.tsx` | fixture に `studiedToday` / `nextDueDate` を追加し、`New`/`Learn`/`Due` の assertion を新ラベルへ更新 |

**完了条件**

```bash
npm --prefix frontend run test -- src/components/deck src/app/decks
```

`New` / `Learn` / `Due` の英語ラベルが一覧・詳細のレンダリング結果に残っていない（FR-09）。アクセシビリティ: 数値のみのバッジを作らず必ずテキストラベルを併記、`Link` / `button` の既存 semantics を維持。

## Phase 4: 全体品質ゲートと UI 確認

```bash
npm --prefix frontend run check
```

ルーティング・Server/Client 境界に新しい影響は無い（`"use client"` 追加なし・新規 route なし）が、Server Component の props 型を変えるため念のため以下も実行する。

```bash
npm --prefix frontend run build
```

手動 UI 確認（`frontend` で `npm run dev`、既定 `http://localhost:3000`）:

- `/decks`: キューあり / 今日完了（次回予定あり）/ 今日完了（予定なし）/ 上限到達 / カード0枚
- `/decks/[deckId]`: 同 5 状態と開始導線の活性・非活性
- mobile 320px と desktop、200% zoom で横スクロールが出ないこと、contrast、console error なし

**既知の環境依存**: 3 つの `*.int.test.ts` は `S10_TEST_DATABASE_URL` 未設定時に失敗する。本ストーリーと無関係な既存の env gate であり、未設定なら「未実行」として報告する。

## 受入条件トレーサビリティ

| AC | 要件 | Phase | 検証 |
|---|---|---|---|
| AC-1 一覧・詳細に本日学習済み | FR-01, FR-02 | 2, 3 | `deck-actions.test.ts`（供給）、`DeckCard.test.tsx` / `[deckId]/page.test.tsx`（表示） |
| AC-2 完了＋次回予定日 | FR-03〜06 | 1, 3 | `study-status.test.ts`、`DeckCard.test.tsx`、`[deckId]/page.test.tsx` |
| AC-3 やるべき枚数が分かる | FR-07, FR-08 | 3 | `DeckCard.test.tsx`（`ふくしゅう` 合算）、`[deckId]/page.test.tsx`（上限到達） |
| AC-4 SRS ロジック不変 | NFR-04, NFR-05, NFR-07 | 全 | `calculate` / `queue` / `classify` 既存テストが無変更で緑。`session-actions.ts`・`supabase/**` に差分なし（`git diff --stat` で確認） |
| AC-5 JST 日境界の整合 | NFR-01〜03 | 1, 2 | `deck-actions.test.ts` の JST 境界ケースと overview 一致ケース |
| AC-6 品質ゲート | — | 4 | `npm --prefix frontend run check` |

## 停止・エスカレーション条件

- ラベル文言（`design.md` D-1）に対しユーザーから別案の指示が出た場合は、定数（`study-status.ts`）のみの差分で対応できるためコード構造は変えない。
- `review_states.due_date` が `YYYY-MM-DD` 以外の形式を含むと判明した場合（既存 `classifyCard` の前提が崩れる）は、表示範囲を超える問題なので停止して報告する。
- 同一観点の code review 指摘が 3 回未解消の場合は停止して報告する。
