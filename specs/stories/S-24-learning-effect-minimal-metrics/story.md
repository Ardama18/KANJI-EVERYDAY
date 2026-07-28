---
id: S-24
issue_story_label: S-23
feature: learning-effect-minimal-metrics
type: story
version: 1.0.0
created: 2026-07-27
updated: 2026-07-27
github_issue: 76
related_epic: E-02
---

# S-24: 学習効果の最小メトリクスを見える化する

## 背景

GitHub issue #76 のタイトルは `S-23` だが、repository には既に `S-23-ai-card-parent-ux-copy` が存在する。そのため、story artifact は重複を避けて `S-24-learning-effect-minimal-metrics` として作成し、issue 表記上の label を `issue_story_label: S-23` として保持する。

KANJI-EVERYDAY の現在の芯は、毎日短時間で漢字を復習する学習ループにある。S-19 で「今日やること」「きょうやった」などの状態表示が入り、S-20 で登録後のニーモニック編集も入った。一方で、親が「続いているか」「覚えられているか」「覚え方の編集が効いていそうか」を判断するための最小メトリクスはまだ不足している。

## ユーザーストーリー

保護者として、デッキ詳細で最近の学習実績と評価の内訳を確認したい。なぜなら、子どもが学習を続けられているか、`むり` / `あやしい` が多すぎないか、ニーモニックがあるカードの傾向に違いがあるかを、家庭内で判断したいから。

## スコープ

### 対象

- デッキ詳細画面 `/decks/[deckId]` に、親向けの最小メトリクスパネルを追加する。
- 今日の完了状態は既存 `resolveDeckStudyStatus` / `getDeckOverview` の判定を再利用する。
- 直近7日分の学習実績を `study_sessions.finished_at` から JST 日付単位で集計する。
- 記憶定着に近い指標として、直近7日に最後に評価された deck 内カードの `again` / `hard` / `good` 最新評価内訳を表示する。
- 可能な範囲で、承認済み `card_mnemonics` があるカードとないカードの最新評価傾向を表示する。
- 集計は Server Action / server-side library で完了させ、Client Component 側では集計しない。
- owner 境界、JST 日付境界、空データ、初日、カード0枚、学習済み0件の表示をテストで固定する。

### 対象外

- SRS アルゴリズム、評価間隔、retry 上限、queue 順序の変更。
- DB schema、migration、RLS policy、Storage policy、Database 型の変更。
- AI 生成 prompt、外部 analytics SaaS、ランキング、課金、学校管理者機能。
- 評価履歴テーブルの追加、過去評価との差分算出、厳密な「前回より改善したカード数」。
- 学習完了画面へのメトリクス追加。まずはデッキ詳細に集約する。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. 親がデッキ詳細で「最近ちゃんと学習できているか」を判断できる。
2. 少なくとも1つ、記憶定着に近い指標として `again` / `hard` / `good` の内訳が表示される。
3. 集計は owner 境界を守り、他ユーザーの deck、session、review state、mnemonic を読まない。
4. JST 日付境界は既存 `getTodayJST` / `getJstDateForInstant` と SRS 規律に合わせる。
5. 空データ、初日、カード0枚、学習済み0件の表示が壊れない。
6. 主要集計ロジックに unit または integration test がある。
7. `npm --prefix frontend run lint` と `npm --prefix frontend run typecheck` が成功する。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/76
- Related Epic: `specs/epics/E-02-core-study-flow/epic.md`
- Accepted ADRs: `specs/adr/ADR-004-srs-engine.md`, `specs/adr/ADR-005-study-session-flow.md`, `specs/adr/ADR-013-post-commit-mnemonic-edit-write-boundary.md`
- Related Stories: S-19, S-20, S-22
