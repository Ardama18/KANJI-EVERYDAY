---
id: S-25
issue_story_label: S-25
feature: study-rating-buttons-above-fold
type: story
version: 1.0.0
created: 2026-07-28
updated: 2026-07-28
github_issue: 80
related_epic: E-02
---

# S-25: 学習評価ボタンをスクロールなしで押せる位置にする

## 背景

漢字学習画面 `/decks/[deckId]/study` では、答え表示後に `むり` / `あやしい` / `できた` の3段階で評価して次のカードへ進む。現在は裏面の本文、イラスト、ニーモニック説明が縦に伸びると評価ボタンが画面下に沈み、スマホでもPCでも毎カードでスクロールが必要になる。

## ユーザーストーリー

学習者として、答えを見たあとに評価ボタンをすぐ押したい。なぜなら、毎カードでスクロールせず、短時間の復習テンポを保ちたいから。

## スコープ

### 対象

- `/decks/[deckId]/study` の答え表示後 UI を調整し、評価ボタンを viewport 内で押しやすい位置に保つ。
- `むり` / `あやしい` / `できた` の表示順、ラベル、rating 値の対応を維持する。
- イラストやニーモニック説明があるカードでは、本文側をスクロール可能にして評価操作を維持する。
- 既存 component test で layout contract と rating order を固定する。

### 対象外

- SRS アルゴリズム、`again` / `hard` / `good` の意味、保存処理、review state 更新契約の変更。
- DB schema、migration、RLS、auth、Server Action の変更。
- Playwright 等の新規依存追加。
- 学習画面以外の UI リデザイン。

## 受入条件

1. スマホ表示で、答え表示後の評価ボタンがスクロールなしで見える、または固定フッター等で常に押せる。
2. PC表示でも、評価ボタンが画面下に沈みすぎず、スクロールなしで押せる。
3. `むり` / `あやしい` / `できた` のラベルと意味は変えない。
4. キーボード操作、フォーカス順序、タップ領域が既存より悪化しない。
5. イラストやニーモニック表示があるカードでも評価ボタンが押しにくくならない。
6. 既存の SRS 評価ロジック、保存処理、review state 更新契約は変更しない。
7. スマホ相当幅と PC 幅の UI 確認結果を PR に記載できる状態にする。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/80
- Related Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Related components: `frontend/src/components/study/CardBack.tsx`, `frontend/src/components/study/RatingButtons.tsx`
