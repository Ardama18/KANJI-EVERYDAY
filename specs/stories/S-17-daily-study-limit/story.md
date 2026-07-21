---
id: S-17
feature: daily-study-limit
type: story
version: 1.0.0
created: 2026-07-21
updated: 2026-07-21
github_issue: 38
parent_epic: E-02
---

# S-17: 一日最大学習枚数と将来予定カードの可視化

## ユーザーストーリー

ログイン済みの学習者として、デッキごとに一日に学習する最大枚数を設定し、今日の出題が0枚でもカード総数、学習済み、将来予定の状態を確認したい。なぜなら、学習済みカードが明日以降に予定されているだけなのに `New 0 / Learn 0 / Due 0` とだけ表示されると、カードや学習状態が消えたように見えるから。

## 解決する課題

- デッキ一覧とデッキ詳細は `New / Learn / Due` だけを表示し、これは「今日出題対象のカード」だけを表している。
- `review_states.due_date > today` の学習済みカードは `classifyCard()` で `null` になり、現行UIには表示されない。
- `buildSessionQueue()` は `due` と `learn` を全件入れ、`new` だけを `new_limit_per_day` で制限しているため、復習が多い日に一日の学習量が膨らむ。
- 既存 `new_limit_per_day` は新規カード上限であり、復習カードを含む総上限ではない。
- productionで確認された `テスt` デッキはカード12枚と `review_states` 12件が全て将来予定で、今日の `New / Learn / Due` は0だった。

## スコープ

### 対象

- `decks.daily_study_limit` を追加し、デッキ単位の一日最大学習枚数として保存する。
- デフォルト値を20枚にする。
- 既存 `new_limit_per_day` は新規カード上限として残す。
- セッション作成時は、当日の残り学習枠の中で `Due -> Learn -> New` の順にキューを構築する。
- `New` は `new_limit_per_day` と `daily_study_limit` 残枠の小さい方で制限する。
- `Again` の当日リトライは既存どおり最大2回まで維持し、進捗はユニークカード基準を維持する。
- デッキ一覧で今日の `New/Learn/Due` が0でも、カード総数、学習済み、将来予定が見える。
- デッキ詳細で今日の学習枚数、残り学習枠、全体状態、学習上限設定が区別して見える。
- 将来予定カードだけのデッキが0表示に隠れる状態を再現テストで固定する。
- JST日付境界のテストを追加する。

### 対象外

- FSRS / SM-2 の `ease`、`stability`、`difficulty`、`lapse_count` などの列追加。
- SRS固定間隔テーブル自体の変更。
- 既存 `review_states`、`study_sessions`、学習済みデータの更新・削除。
- ユーザー単位の学習上限設定。
- デッキ削除、共有、公開デッキ、並び替え。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. デッキ単位で一日最大学習枚数を保存できる。
2. `daily_study_limit` のデフォルトは20枚で、小学生向けに過剰出題にならない。
3. 学習セッション開始時、今日のユニーク出題枚数はデッキの一日最大学習枚数と当日の残り学習枠を超えない。
4. 出題優先順位は `Due -> Learn -> New` を維持する。
5. 上限到達後の後続カテゴリは当日のセッションキューに入れない。
6. `Again` の当日リトライは最大2回まで維持し、retryは進捗総数に重複加算しない。
7. `new_limit_per_day` は新規カード上限として残り、`New` は `new_limit_per_day` と総上限の残枠の小さい方になる。
8. デッキ一覧で `New/Learn/Due` が0でも、カード総数、学習済み、将来予定が見える。
9. デッキ詳細で、今日の学習対象枚数と全体状態が区別して見える。
10. 将来予定カードだけのデッキでも、カードが存在し、学習済みで、将来予定であることが分かる。
11. JST日付境界のテストがある。
12. 既存の学習済みデータ、`review_states`、`study_sessions` を破壊しない。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/38
- Parent Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Related Stories: S-05、S-06、S-07
- Related ADR: `specs/adr/ADR-004-srs-engine.md`、`specs/adr/ADR-005-study-session-flow.md`
