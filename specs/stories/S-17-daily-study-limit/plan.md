# 実行計画: 一日最大学習枚数と将来予定カードの可視化

## Phase 1: DB migrationと型契約

- 対象要件: REQ-DB-01〜03, REQ-TYPE-01, NFR-DATA-01, AC-01, AC-02, AC-11
- 対象ファイル:
  - `supabase/migrations/20260721000000_s17_daily_study_limit.sql`
  - `frontend/src/types/database.ts`
  - `frontend/src/lib/srs/daily-study-limit-migration-contract.test.ts`
- 実装内容:
  - `public.decks` に `daily_study_limit integer NOT NULL DEFAULT 20` を追加する。
  - `decks_daily_study_limit_check CHECK (daily_study_limit BETWEEN 1 AND 100)` を追加する。
  - `database.ts` の `decks.Row/Insert/Update` を更新する。
  - migration契約テストで `decks.daily_study_limit` 追加、default 20、CHECK制約、`review_states` / `study_sessions` DMLなしを固定する。
- 完了条件:
  - 既存デッキはmigration後に20枚のdefaultを持つ。
  - `review_states` と `study_sessions` への `UPDATE` / `DELETE` / `TRUNCATE` がmigrationに含まれない。
  - TypeScript上で `deck.daily_study_limit` を参照できる。
- 検証:
  - `npm --prefix frontend test -- src/lib/srs/daily-study-limit-migration-contract.test.ts`

## Phase 2: SRSキューと全体状態集計

- 対象要件: REQ-SRS-01〜06, REQ-OVERVIEW-03〜04, REQ-TEST-01〜03, AC-03〜07, AC-09
- 対象ファイル:
  - `frontend/src/lib/srs/types.ts`
  - `frontend/src/lib/srs/classify.ts`
  - `frontend/src/lib/srs/queue.ts`
  - `frontend/src/lib/srs/classify.test.ts`
  - `frontend/src/lib/srs/queue.test.ts`
  - `frontend/src/lib/srs/index.ts`（export追加が必要な場合）
- 実装内容:
  - `SessionQueueLimits` と `DeckStudySummary` 型を追加する。
  - `summarizeDeckStudyState(cards, today)` を追加する。
  - `buildSessionQueue(cards, today, { newLimit, dailyStudyLimit })` に移行する。
  - `due -> learn -> new` の順に総上限までsliceし、`new` は `newLimit` と残枠の小さい方にする。
  - 既存 `getNextCardId()` の `due -> learn -> new -> retry` 優先順位は変更しない。
- 完了条件:
  - `dailyStudyLimit=3` でdueが4枚ある場合、due先頭3枚のみが入る。
  - due2枚、learn2枚、new2枚、daily3の場合、due2 + learn1 + new0になる。
  - due0、learn0、new10、newLimit4、daily3の場合、new3になる。
  - due0、learn0、new10、newLimit2、daily5の場合、new2になる。
  - 将来予定カードだけの配列で `counts` は0、`summary.totalCards/learnedCards/scheduledCards` は存在数を返す。
- 検証:
  - `npm --prefix frontend test -- src/lib/srs/queue.test.ts src/lib/srs/classify.test.ts`

## Phase 3: Server Actionsの集計・上限更新・セッション作成

- 対象要件: REQ-ACTION-01〜07, REQ-OVERVIEW-01〜04, REQ-TEST-01, REQ-TEST-04, NFR-SEC-01〜02, AC-01, AC-03, AC-08〜10
- 対象ファイル:
  - `frontend/src/actions/deck-actions.ts`
  - `frontend/src/actions/deck-actions.test.ts`
  - `frontend/src/actions/session-actions.ts`
  - `frontend/src/actions/session-actions.test.ts`
  - 必要に応じて `frontend/src/lib/date.ts`
  - 必要に応じて `frontend/src/lib/date.test.ts`
- 実装内容:
  - `DeckRow` selectに `daily_study_limit` を追加する。
  - `getDecksWithCounts()` は今日の `counts` と `summarizeDeckStudyState()` の結果を返す。
  - `getDeckOverview()` は `dailyStudyLimit/newLimitPerDay/studiedToday/remainingToday/counts/summary` を返す。
  - `updateDeckStudyLimit()` と状態型を追加し、本人所有デッキだけを1〜100の範囲で更新する。
  - `startStudySession()` は `daily_study_limit` とJST当日レビュー済みユニーク数から残り枠を計算し、`buildSessionQueue()` に渡す。
  - JST当日判定に必要な純粋ヘルパーが不足する場合は `date.ts` に追加し、JST 00:00境界テストを追加する。
- 完了条件:
  - 将来予定12枚だけのデッキで一覧/詳細Actionは `New/Learn/Due=0` かつ `totalCards=12 learnedCards=12 scheduledCards=12` を返す。
  - `daily_study_limit=20`、JST当日レビュー済み18枚なら、新規セッションキューはユニーク2枚以下になる。
  - JSTで同じ日、UTCでは前日/翌日に見える `last_reviewed_at` が正しく `studiedToday` に含まれる/含まれない。
  - 上限更新Actionは未認証、所有外、範囲外入力でDB更新しない。
  - active sessionがある場合は既存セッションを再利用し、キューを再構築しない。
- 検証:
  - `npm --prefix frontend test -- src/actions/deck-actions.test.ts src/actions/session-actions.test.ts src/lib/date.test.ts`

## Phase 4: デッキ一覧UI

- 対象要件: REQ-UI-01, REQ-OVERVIEW-01, AC-07, AC-09
- 対象ファイル:
  - `frontend/src/components/deck/DeckCard.tsx`
  - `frontend/src/components/deck/DeckCard.test.tsx`
  - `frontend/app/(auth)/decks/page.tsx`（型影響が出た場合）
  - `frontend/src/app/decks/page.test.tsx`
- 実装内容:
  - `DeckCard` にカード総数、学習済み、将来予定の行を追加する。
  - `New/Learn/Due` バッジは「今日の学習対象」として残す。
  - 0件バッジのグレー表示を維持する。
  - 一覧page testのmockデータを新しい `DeckWithCounts` 型に合わせる。
- 完了条件:
  - `New 0 / Learn 0 / Due 0` でも `カード 12枚 / 学習済み 12枚 / 予定 12枚` がHTMLに含まれる。
  - 既存のデッキリンク、デッキ名、バッジ表示が維持される。
  - 320px相当でも横スクロール前提の固定幅UIにならない。
- 検証:
  - `npm --prefix frontend test -- src/components/deck/DeckCard.test.tsx src/app/decks/page.test.tsx`

## Phase 5: デッキ詳細UIと上限設定フォーム

- 対象要件: REQ-UI-02〜04, REQ-ACTION-06〜07, REQ-OVERVIEW-02, AC-01, AC-08〜09
- 対象ファイル:
  - `frontend/app/(auth)/decks/[deckId]/page.tsx`
  - `frontend/src/app/decks/[deckId]/page.test.tsx`
  - `frontend/src/components/deck/DeckStudyLimitForm.tsx`
  - `frontend/src/components/deck/DeckStudyLimitForm.test.tsx`
- 実装内容:
  - 詳細画面を「今日の学習」「全体状態」「学習設定」に分ける。
  - 今日の `New/Learn/Due` と `今日のカード` は既存表示を維持する。
  - 全体状態としてカード総数、学習済み、将来予定を表示する。
  - `dailyStudyLimit` 更新フォームを追加し、現在値を初期値にする。
  - `newLimitPerDay` は新規カード上限として補助表示する。
  - `counts.total === 0 && scheduledCards > 0` の場合は、カードなしではなく次の予定があることを示す文言にする。
- 完了条件:
  - total > 0なら既存どおり「はじめる」リンクが有効。
  - total = 0かつscheduled > 0ならボタンは無効だが将来予定が表示される。
  - totalCards = 0なら空デッキとして読める表示になる。
  - 上限フォームは1〜100の数値入力と保存buttonを持つ。
- 検証:
  - `npm --prefix frontend test -- src/app/decks/[deckId]/page.test.tsx src/components/deck/DeckStudyLimitForm.test.tsx`

## Phase 6: 全体品質確認

- 対象:
  - 変更全体
- コマンド:
  - `npm --prefix frontend run check`
  - `npm --prefix frontend run build`
  - `git diff --check`
- UI L3確認:
  - `cd frontend && npm exec -- next dev`
  - `/decks`: desktopとmobileで、将来予定だけのデッキが総数/学習済み/予定を表示する。
  - `/decks/{deckId}`: 今日の学習、全体状態、学習設定が分かれて見える。
  - 上限設定フォーム: valid保存、範囲外入力、keyboard操作、200% zoom、console/network errorなしを確認する。
- 追加確認:
  - `git status --short supabase/migrations frontend/src/types/database.ts frontend/src/lib/srs frontend/src/actions frontend/src/components/deck frontend/app/(auth)/decks`
  - `review_states` と `study_sessions` の既存データを変更するmigrationがないことを再確認する。

## AC / 検証対応

| AC | 主な検証 |
|---|---|
| AC-01 | Phase 1 migration/type + Phase 3 update action + Phase 5 form |
| AC-02 | Phase 1 migration contract |
| AC-03 | Phase 2 queue test + Phase 3 startStudySession test |
| AC-04 | Phase 2 queue priority test |
| AC-05 | 既存calculate retry tests + Phase 3 progress regression |
| AC-06 | requirements/design記載 + Phase 2 newLimit残枠test |
| AC-07 | Phase 3 action再現test + Phase 4 DeckCard test |
| AC-08 | Phase 3 overview test + Phase 5 page test |
| AC-09 | Phase 3/4/5 将来予定だけ再現test |
| AC-10 | Phase 3 JST境界test |
| AC-11 | Phase 1 migration contract + full check/build |

## 実装時の注意

- `tasks/` や個別task fileは作成しない。
- `plan.md` 全体を task-executor に渡し、記載順に一括実装する。
- `new_limit_per_day` を総上限に統合しない。
- active sessionの既存キューを設定変更で破棄・再構築しない。
- migrationでは `review_states` と `study_sessions` にDMLを書かない。
- UI文言では `New/Learn/Due` を今日の対象として扱い、全体状態と混同させない。
