---
id: S-13
feature: ai-card-management-undo
type: story
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 14
parent_epic: 9
parent_story: S-10
---

# S-13: AIカード管理・取り消し

## ユーザーストーリー

保護者・先生として、AIで登録した自分のカードを後から探して修正・削除し、誤って登録した未編集でactive session対象でないbatchを安全に取り消したい。なぜなら、子どもの学習状態や他のカード、共有イラストを壊さずに登録ミスを訂正したいから。

## 解決する課題

- S-10/S-11にはowner scopedな管理RPC、active-session guard、undo、共有イラストの参照管理があるが、利用者が操作できる管理画面がない。
- AIカードが増えると、安定したページングとdeck/tag/source/登録日による絞り込みがなければ対象を安全に特定できない。
- 本文変更だけをNewへ戻し、関連だけの変更では学習履歴を維持する必要がある。
- batch undoは個別削除、編集・active session、R1/W1共有画像、空の自動作成deckを考慮しなければならない。

## スコープ

### 対象

- `/ai/cards` のowner限定AIカード一覧、cursor pagination、複合filter
- front/back/skill/pattern、illustration、tag、所属deckの編集
- 個別削除、1ページ内の複数選択削除、batch undo
- content変更時だけの `review_states` reset
- 管理による実変更の `ai_import_items.user_edited_at` 記録と、個別削除で編集印を付けないtombstone例外
- active session guard、公開Seed・別ownerの存在秘匿
- S-11のR1/W1共有画像reference lifecycleを維持した削除・付け替え
- 管理専用feature flagによる安全な導線停止

### 対象外

- AIカードの公開・共有、公開Seedの直接編集または複製
- AI本文・イラストの新規provider生成、provider/Queue/cleanup基盤の置換
- SRSアルゴリズム、学習session queue、AIカード作成フローの変更
- Playwrightその他の新規E2E基盤の導入

## 受入条件

1. 本人が所有する、AI importで確定済みのprivate cardだけを一覧・編集・削除できる。
2. 一覧は既定20件、最大100件で、cardの `(created_at, id)` cursorにより同一時刻を含め重複・欠落なくページングできる。
3. front/back/skill/patternの実値変更だけで対象cardの `review_states` が削除されNewへ戻り、illustration/tag/deckだけの変更では学習状態が残る。
4. active sessionに含まれるcardへの全変更を副作用なしで拒否し、安全なsession IDとdeck IDを返す。
5. 未編集でactive session対象でないbatchのundoで現存cardと関連を削除し、最後の参照を失った共有画像をS-11 cleanupへ渡し、空になった自動作成deckだけを削除する。
6. batch内に `user_edited_at` 設定済みitemが1件でもあるか、現存cardがactive session対象ならbatch全体のundoを副作用なしで拒否する。
7. undo再送は同じ成功結果を返し、undo前に個別削除済みのcardは安全に無視する。
8. 公開Seed、別owner、存在しないcard/deck/tag/illustration/batch IDは同じ404相当とし、存在を漏らさない。

## ロールバック

管理専用feature flagを無効にして管理導線と管理routeを404相当にする。DB migration、既存カード、batch、学習状態、S-11 cleanup/statusは保持し、既存migrationを巻き戻したり編集したりしない。

## 関連情報

- GitHub Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/14
- Parent Epic: GH-9
- Parent Story: `specs/stories/S-10-ai-card-import-foundation`
- Related Story: `specs/stories/S-11-ai-card-async-processing`
- Related Story: `specs/stories/S-12-ai-card-openai-generation-ui`
- Accepted ADR: `specs/adr/ADR-007-ai-card-import-foundation.md`
- Accepted ADR: `specs/adr/ADR-008-ai-card-async-queue-image-processing.md`
