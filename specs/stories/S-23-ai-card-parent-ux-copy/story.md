---
id: S-23
feature: ai-card-parent-ux-copy
type: story
version: 1.0.0
created: 2026-07-27
updated: 2026-07-27
github_issue: 75
parent_story: S-12
---

# S-23: 親向け AI カード作成 UX から内部用語をなくす

## ユーザーストーリー

保護者または先生として、教材や学年をもとに子ども用の漢字カードを作るとき、内部コードを理解しなくても読み練習、書き練習、両方の違いを選び、生成後のカード案を確認したい。なぜなら、カード作成は教材準備の作業であり、実装上の `R1` / `W1` / `conceptId` を読む時間をかけたくないから。

## スコープ

- AIカード作成フォームのカード形式表示を親向け日本語に変更する。
- 教材画像入力の `source` 表現を親向け日本語に変更する。
- 作成枚数と画像アップロードの説明を、作成結果を予測しやすい文言にする。
- カード案一覧で確認順序を明示し、主要見出しに内部 `conceptId` を出さない。
- 既存の payload、import request schema、DB、RPC、MCP tool 契約は変更しない。
- 関連する既存コンポーネントテストを更新し、内部用語の再露出を検出する。

## 対象外

- カード生成モデル、prompt、出力 mapping の変更。
- DB schema、migration、RLS、Storage policy の変更。
- Remote MCP の tool 名または schema の変更。
- 画像生成ライフサイクルの変更。
- production deploy、issue close、PR merge。

## 受入条件

- **AC-01**: AIカード作成画面に `R1`、`W1`、`both` がユーザー向けラベルとして表示されない。
- **AC-02**: カード案一覧に `conceptId` が主要見出しとして表示されない。
- **AC-03**: 親が「読み」「書き」「両方」の違いを画面上で理解できる。
- **AC-04**: 画像アップロードが必要な場合、なぜ必要かが自然な日本語で分かる。
- **AC-05**: 既存の AIカード作成 API、import request schema、MCP tool 契約を変更しない。
- **AC-06**: 既存の `DraftCardList` / `AiCardForm` 系テストを更新し、主要文言の回帰を検出できる。
- **AC-07**: `npm --prefix frontend run lint` と `npm --prefix frontend run typecheck` が成功する。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/75
- Related Stories: S-10, S-11, S-12, S-16D
