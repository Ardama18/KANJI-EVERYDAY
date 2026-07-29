# 設計: 学習設定表示の実出題枚数化

## 現行調査

- `startStudySession` は `remainingToday = daily_study_limit - studiedToday` を計算し、`buildSessionQueue(cards, today, { newLimit: deck.new_limit_per_day, dailyStudyLimit: remainingToday })` を呼ぶ。
- `buildSessionQueue` は Due、Learn、New の順に残枠へ詰め、New は `min(newLimit, remaining)` で制限する。
- `DeckOverviewPage` は `overview.counts.total` を「今日やること」として表示しているため、新規20枚/復習0枚で20枚のように見える。
- `DeckCard` は一覧で `counts.new` と `counts.learn + counts.due` をそのまま表示しているため、詳細と同じ誤解を生む。

## 方針

`frontend/src/lib/deck/study-status.ts` に表示用の純粋関数 `summarizePlannedStudy` を追加する。入力はカテゴリ件数、学習済み枚数、総上限、新規上限のみとし、出力は開始予定の `new/review/total` と、新規上限で抑制されたかどうかを返す。

この関数はキュー ID を作らず件数だけを計算するが、順序と制限は `buildSessionQueue` と同じにする。

```text
remaining = max(0, dailyStudyLimit - studiedToday)
plannedDue = min(due, remaining)
plannedLearn = min(learn, remaining - plannedDue)
plannedNew = min(new, newLimitPerDay, remaining - plannedDue - plannedLearn)
```

`resolveDeckStudyStatus` は、上限到達判定のため既存どおり「今日対象が残っているか」を raw count で受け取る。表示枚数だけ `summarizePlannedStudy` の予定枚数へ置き換える。

## UI

- 詳細ページ:
  - `今日の出題予定 X枚`
  - `内訳: あたらしいN枚 / ふくしゅうM枚`
  - `新規カードは1日M枚までです`（抑制時のみ）
  - 学習設定: `一日最大N枚 / 新規は最大M枚`
- 一覧:
  - バッジは予定内訳を表示する。
  - 新規上限で抑制された場合だけ短い補足文言を表示する。

## テスト戦略

- `study-status.test.ts` で新規20/復習0 -> 10、新規20/復習5 -> 15、Due/Learn 優先、残枠0、入力正規化を検証する。
- `DeckOverviewPage` test で詳細ページの文言と内訳を検証する。
- `DeckCard` test で一覧バッジが予定内訳を表示することを検証する。
- `queue.ts` と `session-actions.ts` は変更しないことで AC-5 を満たす。
