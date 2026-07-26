# S-19 Design

対象 issue: #63。frontend 完結・表示のみ。ADR は不要（長期の技術方針を変えず、既存 SRS 契約を維持するため）。

## 1. 現行調査（コードで確認済み）

| 対象 | 事実 |
|---|---|
| `frontend/app/(auth)/decks/page.tsx` | Server Component。`getDecksWithCounts()` → `DeckCard` を map。 |
| `frontend/src/components/deck/DeckCard.tsx` | `"use client"` なし = Server Component。props は `DeckWithCounts` のみ。`New/Learn/Due` バッジ＋「カード/学習済み/予定」行。 |
| `frontend/app/(auth)/decks/[deckId]/page.tsx` | Server Component。`New/Learn/Due` の `StatCard` 3枚、「全体状態」3枚、`studiedToday` は「学習設定」内に1行だけ。完了文言は4分岐をページ内に inline 実装。 |
| `frontend/src/actions/deck-actions.ts` | `fetchDeckCardRows` が `review_states` の `level, due_date, last_rating, retry_today_count, last_reviewed_at` を **既に取得**。`getDecksWithCounts` と `getDeckOverview` が同じ関数を使う。 |
| `countCardsReviewedOnJstDate`（同ファイル private） | `getJstDateForInstant(lastReviewedAt) === today` のユニークカード数。現在 `getDeckOverview` からのみ呼ばれる。 |
| `frontend/src/lib/srs/classify.ts` | `classifyCard` / `countByCategory` / `summarizeDeckStudyState`。`scheduledCards` = `reviewState !== null && dueDate > today` の枚数。 |
| `frontend/src/lib/date.ts` | `getTodayJST` / `getJstDateForInstant` / `addDaysJST` / `getTomorrowJST` / `isBeforeOrEqualJST`。`M月D日` 整形関数は未実装。 |
| `frontend/src/actions/session-actions.ts:604` | 同等の JST 判定を `countDeckCardsReviewedOnJstDate` として別実装で保持（出題側）。 |

### 重要な確認結果

1. **`studiedToday` と `nextDueDate` は追加クエリなしで算出できる。** `getDecksWithCounts` は既に全カードの `last_reviewed_at` と `due_date` をメモリに持つ（NFR-01 を満たす）。
2. **`scheduledCards > 0` ⇔ `nextDueDate !== null`。** どちらも「`reviewState` があり `dueDate > today`」のカードの存在を意味する。したがって詳細ページの既存分岐「`scheduledCards > 0` なら次の予定カードがある」を `nextDueDate !== null` に置き換えても**判定は等価**で、日付という情報が増えるだけ。
3. 出題側の JST 判定（`session-actions.ts`）と一覧・詳細側（`deck-actions.ts`）は現状すでに実装が二重化している。本ストーリーでは **出題側に触れない**（AC-4 ロジック不変）。一覧・詳細は `deck-actions.ts` の既存 private helper を再利用し、新たな三重化を作らない。

## 2. 決定事項

### D-1 ラベル文言（最終）

Anki 由来の英語ラベルのみを置換対象とし、既存の日本語（`今日の学習`、`学習設定`、`一日最大`）は温存する。ruby（ふりがな）基盤は無いため、置換する3語は**ひらがな**にして低学年でも確実に読めるようにする。

| 用途 | 旧 | 新 |
|---|---|---|
| 今日やる新規カード | `New` | `あたらしい` |
| 今日やる復習カード（`learn + due`） | `Learn` / `Due` | `ふくしゅう` |
| 本日学習済み | （一覧なし / 詳細は「今日の学習済み」） | `きょうやった` |
| 完了（今日やること 0） | `今日の学習は完了しています` | `きょうのぶんは おわり！` |
| 上限到達 | `今日の学習上限に達しています。` | `きょうはここまで！またあした` |
| 次回予定あり | （なし） | `つぎは 3月1日` / 翌日は `つぎは あした` |
| 次回予定なし | （なし） | `つぎの よていは まだないよ` |
| カード未登録 | `カードがまだありません` | 同じ（変更しない） |
| 一覧の全体行 | `カード N枚 / 学習済み N枚 / 予定 N枚` | `カード N枚 ・ 学習した N枚` |
| 詳細の全体セクション | `全体状態` / `カード総数` / `学習済み` / `将来予定` | `これまでの記録` / `カード総数` / `学習した数` / `つぎの予定` |

**代替案と却下理由**
- issue 提案の `新規 / 復習 / 今日やった`: 「新規」は業務用語的で小学生の語彙から遠い。「復習」は `復`（5年）を含み低学年が読めない。→ 3語のみひらがな化を採用。
- 全面ひらがな化: 既存の `今日の学習`、`学習設定` などまで書き換えると差分が大きく、漢字学習アプリとして漢字を避ける方向のメッセージにもなる。→ 却下。

### D-2 Learn と Due は統合する（一覧・詳細ともに）

- 表示は `ふくしゅう = learn + due` の1つにまとめ、**内訳は一覧・詳細のどちらにも出さない**。
- 理由: 子どもの行動は learn / due で変わらない（どちらも「今日やる」）。粒度を画面ごとに変えると文言・テスト・保守が二重化する。
- ただし `DeckCounts` / `DeckOverview.counts` の `learn` / `due` フィールドは**削除しない**（`buildSessionQueue` など出題側の契約と最小差分の維持。NFR-04）。表示側で合算するだけにする。

### D-3 次回予定日: 算出と表示

- 算出は純関数 `findNextDueDate(cards, today): string | null` を `frontend/src/lib/srs/classify.ts` に追加（read-only の集計であり、既存 export のシグネチャは変えない）。`reviewState !== null && dueDate > today` の最小 `dueDate` を返す。文字列比較で足りる（既存 `classifyCard` / `summarizeDeckStudyState` と同じ `YYYY-MM-DD` 前提を踏襲）。
- 整形は `formatJstMonthDay(date): string`（`M月D日`）を `frontend/src/lib/date.ts` に追加。`nextDueDate === getTomorrowJST(today)` のときだけ `あした` を返す（`formatNextDueLabel`）。
- **絶対日付を基本**にする。「あと N日」は起点が曖昧で、日をまたいだキャッシュ表示で誤りに見えやすい。翌日だけは「あした」の方が期待感につながるので例外扱いする。
- 該当なしは `null` → 「つぎの よていは まだないよ」。

### D-4 `studiedToday` の一覧供給

- `getDecksWithCounts` の map 内で **既存 private helper `countCardsReviewedOnJstDate(cards, today)` をそのまま呼ぶ**。`getDeckOverview` と同一関数を使うため、集計の定義は両者で一致する（AC-5 / NFR-02）。
- `getTodayJST()` の評価点は **Server Action 内（`deck-actions.ts`）と page（Server Component）の2箇所**である。Action 内では `today` を1回だけ評価し、`countByCategory` / `countCardsReviewedOnJstDate` / `findNextDueDate` がすべて同じ `today` を参照するため、返り値内部の整合は保証される。page 側は表示（`formatNextDueLabel` の「あした」判定）のために改めて `getTodayJST()` を評価する。
- **既知の許容リスク**: JST 日境界をまたぐ瞬間に Action 側と page 側の評価がずれると、`nextDueDate`（Action 側の `today` 基準）と「あした」判定（page 側の `today` 基準）が1日分食い違い得る。窓はマイクロ秒オーダーで、影響は表示ラベルのみ（SRS の出題・スケジュールには波及しない）。1リクエスト1回評価に統一するには Action の返り値へ `today` を載せる契約変更が要るため、本ストーリーでは許容する。
- 追加クエリ・追加 Supabase 呼び出しはなし（NFR-01）。
- 型の拡張:
  - `DeckWithCounts` に `studiedToday: number` と `nextDueDate: string | null` を追加。
  - `DeckOverview` に `nextDueDate: string | null` を追加（`studiedToday` は既存）。
  - `remainingToday` は一覧では `DeckWithCounts` に**追加せず**、`dailyStudyLimit - studiedToday` を共有ヘルパー内で導出する（既存フィールドで足りるため）。

### D-5 完了 / 上限到達 / 次回予定の判定を共有する

新規モジュール `frontend/src/lib/deck/study-status.ts`（純関数・server/client 両用可、副作用なし）。

```text
resolveDeckStudyStatus({ totalCards, todayCount, studiedToday, dailyStudyLimit, nextDueDate, today })
  -> { kind: "no-cards" | "todo" | "limit-reached" | "done",
       remainingToday: number,
       message: string,          // kind に対応する主文言
       nextDueMessage: string | null }  // done は常に非 null / limit-reached は nextDueDate があるときだけ非 null / todo・no-cards は常に null
```

`limit-reached` は `todayCount > 0`（明日やることが残っている）状態なので、`nextDueDate === null` でも「つぎの よていは まだないよ」を出さない（「またあした」と矛盾するため）。予定なし文言は FR-04 / FR-05 の根拠がある `done` に限定する。

判定順序は既存詳細ページの分岐と等価に保つ。

1. `totalCards === 0` → `no-cards`
2. `todayCount > 0 && remainingToday === 0` → `limit-reached`
3. `todayCount > 0` → `todo`
4. それ以外 → `done`

`canStartStudy`（既存 `counts.total > 0 && remainingToday > 0`）は `kind === "todo"` と等価。文言定数もこのモジュールに置き、一覧と詳細から import する（FR-11）。

### D-6 Server / Client 境界

- 変更対象（`/decks` page、`DeckCard`、`/decks/[deckId]` page）は**すべて Server Component**。`"use client"` は追加しない。
- 「今日」の決定（`getTodayJST()`）は Server Component（`/decks` page）で行う。`DeckCard` は Server Component のまま `today: string` を props で受け取り、`resolveDeckStudyStatus` を自身で導出する（判定と文言を一覧・詳細で共有するため。FR-11）。クライアント側で `new Date()` を評価しないので TZ 差異・hydration mismatch は発生しない（NFR-03）。
- `study-status.ts` は `next/headers` や `supabase` を import しない純粋モジュールにする（Vitest から直接テスト可能・`server-only` 依存を作らない）。
- キャッシュ: `getDecksWithCounts` / `getDeckOverview` は現状どおり動的（`revalidatePath` 依存）。日付をまたぐ表示のずれは既存 `counts` と同じ性質であり、本ストーリーで新しい仕組みは導入しない。

### D-7 意味重複の緩和（issue 論点5）

- 一覧から `予定`（`scheduledCards`）を外し、「次に何かあるか」は次回予定日の文言に集約する（FR-10）。
- 詳細では `学習済み` → `学習した数`、`将来予定` → `つぎの予定` に改名し、「今日の学習」セクションの `きょうやった` との混同を避ける。

### D-8 表示は分類ベースのまま

`あたらしい` / `ふくしゅう` の枚数は `countByCategory` の結果をそのまま使い、日次上限による絞り込み（`buildSessionQueue`）を表示側で再計算しない（NFR-07）。上限に達している状況は D-5 の `limit-reached` 文言で伝える。

## 3. 画面仕様

### 一覧 `/decks`（`DeckCard`）

```text
[デッキ名]
カード 18枚 ・ 学習した 8枚
kind = "todo"          → [あたらしい 10][ふくしゅう 8]  [きょうやった 3枚]
kind = "limit-reached" → きょうはここまで！またあした / つぎは あした   [きょうやった 20枚]
kind = "done"          → きょうのぶんは おわり！ / つぎは 3月1日        [きょうやった 12枚]
kind = "no-cards"      → カードがまだありません                        [きょうやった 0枚]
```

- `きょうやった` は「やること」バッジ列とは視覚的に分離した1つの pill として常に表示する（0 枚のときはグレー）。達成表示と TODO 表示の混同を避ける。
- バッジは既存 `CountBadge` を流用し、`BadgeKind` を `new` / `review` に整理する（`learn` / `due` の2色は使わない）。

### 詳細 `/decks/[deckId]`

- 「今日の学習」: `StatCard` 3枚 = `あたらしい` / `ふくしゅう` / `きょうやった`（既存 `grid-cols-3` を維持）。
- **完了バナー（FR-03 / AC-2）**: `kind === "done"` または `kind === "limit-reached"` のとき、「今日の学習」セクションの見出し直下・`StatCard` グリッドより**上**に `message` を強調表示（中央寄せ・`text-base font-bold`）し、その下に `nextDueMessage`（非 `null` のとき）を副文として置く。これにより主表示が完了メッセージ、`0` の数値は副次情報という情報階層になり、「`0` の羅列を主表示にしない」を満たす。一覧（`DeckCard`）がバッジを `message` に差し替えるのと同じ情報設計を、詳細でも成立させる。
- 補助行: `今日やること {counts.total}枚 / 今日やれる残り {remainingToday}枚`。
- 開始導線: 既存どおり `kind === "todo"` のときリンク、それ以外は disabled ボタン。ボタン下の文言は `kind === "no-cards"` のときだけ `message`（`カードがまだありません`）を出す。`done` / `limit-reached` は上記バナーが主表示なので、同じ文言をボタン下に二重表示しない。
- 「これまでの記録」: `カード総数` / `学習した数` / `つぎの予定`。
- 「学習設定」: `一日最大 {dailyStudyLimit}枚 / きょうやった {studiedToday}枚`。

## 4. 変更ファイル

| # | ファイル | 変更 |
|---|---|---|
| 1 | `frontend/src/lib/date.ts` | `formatJstMonthDay` 追加 |
| 2 | `frontend/src/lib/srs/classify.ts` | `findNextDueDate` 追加（既存関数は無変更） |
| 3 | `frontend/src/lib/srs/index.ts` | `findNextDueDate` を export |
| 4 | `frontend/src/lib/deck/study-status.ts` | 新規（文言定数・`resolveDeckStudyStatus`・`formatNextDueLabel`） |
| 5 | `frontend/src/actions/deck-actions.ts` | `DeckWithCounts` に `studiedToday` / `nextDueDate`、`DeckOverview` に `nextDueDate` を追加し `getDecksWithCounts` で既存 helper を再利用 |
| 6 | `frontend/src/components/deck/DeckCard.tsx` | ラベル・バッジ・完了/次回予定表示 |
| 7 | `frontend/app/(auth)/decks/[deckId]/page.tsx` | ラベル・`きょうやった` StatCard・共有 status 利用・文言定数の集約・完了バナー（FR-03） |
| 8 | `frontend/app/(auth)/decks/page.tsx` | `getTodayJST()` を1回評価し `DeckCard` に `today` を渡す |

`#8` は D-6 / NFR-03（「今日」を Server 側で決め Client で `new Date()` を評価しない）を満たすための最小変更であり、他の描画は変更しない。

**触らないファイル**: `frontend/src/lib/srs/{calculate,queue,constants,types}.ts`（`types.ts` は `CardCategory` 等を変えない）、`frontend/src/actions/session-actions.ts`、`supabase/**`、環境変数、middleware。

## 5. テスト戦略

| 種別 | 対象 | 内容 |
|---|---|---|
| Unit | `frontend/src/lib/srs/classify.test.ts` | `findNextDueDate`: 未来 due の最小値 / 今日以前のみ → `null` / `reviewState=null` のみ → `null` / 空配列 → `null` |
| Unit | `frontend/src/lib/date.test.ts` | `formatJstMonthDay`: 先頭0除去（`2026-03-01` → `3月1日`）・不正形式で throw |
| Unit | `frontend/src/lib/deck/study-status.test.ts`（新規） | 4 kind の分岐・優先順位（`todayCount>0 && remaining=0` は `limit-reached`）・`remainingToday` 導出・`nextDueMessage`（翌日=`あした` / 日付 / なし） |
| Unit | `frontend/src/actions/deck-actions.test.ts` | `getDecksWithCounts` が `studiedToday` / `nextDueDate` を返す。JST 境界: `last_reviewed_at` が UTC で前日 15:00 以降なら当日カウント。同一デッキで `getDeckOverview` と `studiedToday` が一致。未来 due なしなら `nextDueDate=null` |
| Unit | `frontend/src/components/deck/DeckCard.test.tsx` | キューあり（あたらしい/ふくしゅう＝learn+due 合算）・`きょうやった` 表示・完了＋次回予定・完了かつ予定なし・カード0枚・`New`/`Learn`/`Due` 文字列が出ないこと |
| Unit | `frontend/src/app/decks/[deckId]/page.test.tsx` | `きょうやった` StatCard・完了/上限/カード0の文言・次回予定日・開始導線の活性/非活性（既存 4 ケースの文言定数を新定数へ移行）。加えて、完了バナーが「これまでの記録」より前に出る描画順 assertion、各 `StatCard` のラベルと値の結線 assertion、disabled ボタンの `aria-describedby` が実在する理由文言要素を参照すること |
| Unit | `frontend/src/app/decks/page.test.tsx` | fixture に新フィールドを追加し、英語ラベル assertion を新ラベルへ更新 |
| 手動 | 実ブラウザ | mobile(320px)/desktop で一覧・詳細、キューあり/完了/上限/カード0、横スクロールなし・contrast |

JST 境界テストは `last_reviewed_at` を UTC 文字列で与え、`2026-02-23T15:00:00.000Z`（JST 2026-02-24 00:00）が「今日」に入ることを確認する。`getTodayJST()` は `vi.setSystemTime` で固定する。

Playwright は未導入のため E2E は計画しない（`.claude/steering/implementation-flow.md` 8章）。

## 6. リスクと対応

| リスク | 対応 |
|---|---|
| 既存テストが `New` / `Learn` / `Due` / 旧文言を assert しており失敗する | 同一変更内でテストを新ラベルへ更新する。対象は `DeckCard.test.tsx`、`decks/page.test.tsx`、`decks/[deckId]/page.test.tsx` の3ファイルのみ（`DECK_OVERVIEW_*` 定数の import 元は当該テストだけと確認済み） |
| `scheduledCards` を一覧から外すことで情報が減る | 詳細に `つぎの予定` として残し、一覧では次回予定日で代替する（D-7） |
| `studiedToday` 追加で一覧のクエリが重くなる | 追加クエリなし。既存取得済みデータの再集計のみ（NFR-01） |
| 「きょうやった」と「学習した数」の混同 | 前者は「今日の学習」セクション、後者は「これまでの記録」セクションに配置し、セクション見出しで区別する |
| 日付をまたいだ画面滞在で「あした」が古くなる | 既存 `counts` と同じ既知の性質。Server 側で毎リクエスト再計算され、本ストーリーで新たな悪化はない。自動リフレッシュは out of scope |
