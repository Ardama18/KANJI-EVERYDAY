---
id: {STORY_ID}
feature: {FEATURE}
type: tasks
task_number: task-{TASK_NUMBER}
version: 1.0.0
created: {CREATED_DATE}
based_on: specs/stories/{STORY_ID}-{title}/plan.md
---

# タスク: ビジュアル検証実行

**実行パターン**: 2フェーズ実行（UI検証タスク）

## メタ情報
- 依存: Figmaキャッシュ specs/stories/{STORY_ID}-{title}/ui-design/
- サイズ: 検証タスク

## 実装手順

### Phase 1: 検証準備
- [ ] Figmaキャッシュ存在確認: specs/stories/{STORY_ID}-{title}/ui-design/
- [ ] 実装コンポーネント確認: frontend/src/components/, frontend/src/app/
- [ ] 構造化レスポンスでvisual-checker呼び出しを要求: status: "visual_validation_pending"

### Phase 2: 検証結果確認
- [ ] visual-checkerの結果を確認
- [ ] 差異がある場合は修正を実施

## 完了条件
- [ ] **visual-checkerで全チェックパス**
  - matchRate: 95%以上
  - 優先度P0/P1の差異: ゼロ
- [ ] 動作確認完了（L1: 機能動作確認）
