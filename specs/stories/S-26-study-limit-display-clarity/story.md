---
id: S-26
feature: study-limit-display-clarity
type: story
version: 1.0.0
created: 2026-07-29
updated: 2026-07-29
github_issue: 86
related_epic: E-02
---

# S-26: 学習設定の表示を実出題枚数と新規上限が分かる表現に改善する

## 背景

学習設定を「一日最大20枚」にしていても、今日の対象が新規カード中心の場合、学習開始後に10枚で終了することがある。現行ロジックでは `daily_study_limit` は一日の総出題上限、`new_limit_per_day` は一日の新規カード上限であり、両者は分離されている。

この挙動自体は仕様どおりだが、画面上は「一日最大20枚」「今日やること20枚」のように見えるため、新規カードだけでも20枚出題されると誤解しやすい。学習開始キューの生成仕様は変えず、表示だけを実出題予定と上限の意味が分かる形にする。

## ユーザーストーリー

学習者または保護者として、デッキ詳細で今日実際に出題される予定枚数と、新規カードの別上限を確認したい。なぜなら、学習開始後に想定より少ない枚数で終わった理由を画面上で理解できるようにしたいから。

## スコープ

### 対象

- デッキ詳細の「今日の学習」表示を、学習開始時の予定枚数と一致する値へ変更する。
- 新規カード上限と一日総上限の違いが分かる文言を表示する。
- 新規カードが `new_limit_per_day` で抑えられている場合は補足文言を表示する。
- デッキ一覧の同等表示も、実出題予定の内訳に合わせる。
- 表示計算は `buildSessionQueue` と同じ制限順序（Due -> Learn -> New、New は `min(newLimit, remaining)`）に合わせる。
- 既存の学習開始キュー生成ロジックは変更しない。
- 関連 unit / component test を追加または更新する。

### 対象外

- `daily_study_limit`、`new_limit_per_day` の DB schema / default / validation 変更。
- `buildSessionQueue`、`startStudySession`、SRS 分類、retry queue の仕様変更。
- 学習設定フォームで `new_limit_per_day` を編集できるようにすること。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. デッキ詳細の「今日やること」または同等表示が、実際に開始される予定枚数と一致する。
2. 新規カード上限と一日総上限の違いが画面上で分かる。
3. 新規カードだけが20枚ある場合、表示上も「今日の出題予定10枚」と理解できる。
4. 新規20枚・復習5枚の場合、表示上も「今日の出題予定15枚」と理解できる。
5. 既存の学習開始ロジック（新規最大10枚、総上限20枚）は変更しない。
6. PC/スマートフォン双方で表示が崩れない。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/86
- Related Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Related Stories: S-17, S-19
