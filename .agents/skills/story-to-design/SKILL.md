---
name: story-to-design
description: ストーリーから設計・計画まで実施（タスク分解・実装は含まない）
argument-hint: '<ストーリーディレクトリ or 機能説明> [追加指示]'
disable-model-invocation: true
---
**コマンドコンテキスト**: 設計・計画完了まで管理（要件分析→設計→計画→STOP）

## 初回必須タスク

作業開始前に以下のルールファイルを必ず読み込み、厳守してください：
- @.claude/steering/sub-agents.md - サブエージェント管理フロー
- @.agents/shared/delegation-protocol.md - 委任プロトコル共通定義

## 入力形式

```
/story-to-design <ストーリーディレクトリパス> [追加指示]
```
または
```
/story-to-design [機能説明と追加指示]
```

**引数**：
- `<ストーリーディレクトリパス>` (任意): ストーリーディレクトリパス（例: `specs/stories/TC-S-34-user-management`）
- `[追加指示]` (任意): ユーザーからの追加要望・制約・方針

## コマンドの目的

このコマンドは**設計と作業計画のみ**を実施し、タスク分解・実装は行いません：

### 実施範囲
✅ 要件分析（requirement-analyzer）
✅ PRD作成（prd-creator、必要時）
✅ 技術設計（technical-designer）- ADR、Design Doc作成
✅ 作業計画（work-planner）- plan.md作成
✅ meta.json更新（設計レビューステータスに更新）

### 実施範囲外
❌ タスク分解（task-decomposer）- 詳細タスクファイル生成は行わない
❌ 実装（task-executor）- タスクの実行は行わない
❌ 品質保証（quality-fixer）- 実装がないため不要
❌ テスト生成（acceptance-test-generator）- 実装前に生成済み
❌ コードレビュー（code-reviewer）- 実装がないため不要

### 使用シーン
- 実装前に設計レビューを受けたい
- 作業規模と大まかな工数を把握したい（詳細なタスク分解は不要）
- 設計ドキュメントと作業計画を作成し、他の開発者に引き継ぎたい
- 設計承認を得てから詳細なタスク分解を行いたい

## 実行判断フロー

### 1. 現在状況の判定
指示内容: $ARGUMENTS

現在の状況を判定：

| 状況パターン | 判定基準 | 次のアクション |
|------------|---------|-------------|
| 新規ストーリー（ストーリーディレクトリ付き） | ストーリーディレクトリパスが指定されている | ローカルの story.md / requirements.md / meta.json をRead→ストーリー情報取得→requirement-analyzerから開始（ストーリー情報+追加指示を含む） |
| 新規要件（ディレクトリパスなし） | 既存作業なし、新しい機能/修正依頼 | requirement-analyzerから開始（機能説明+追加指示を含む） |
| フロー継続 | 既存ドキュメント/タスクあり、継続指示 | sub-agents.mdのフローで次のステップを特定（work-plannerまで） |
| 不明瞭 | 意図が曖昧、複数の解釈が可能 | ユーザーに確認 |

### 2. 継続時の進捗確認
フロー継続の場合、以下を確認：
- 最新の成果物（要件定義書/ADR/Design Doc/作業計画書）
- 現在のフェーズ位置（要件/設計/計画）
- sub-agents.mdの該当フローで次のステップを特定（work-plannerまで）

### 3. 次のアクション実行

**sub-agents.mdを必ず参照**：
- **Figma統合判定**: ユーザー指示またはストーリー情報にFigma URL（https://www.figma.com/...）、デザイン仕様書言及、「Figmaデザインに従う」等が含まれる場合 → Figma統合フロー適用
- 規模別フロー（大規模/中規模/小規模）を確認
- 自律実行モードの条件を確認
- **停止ポイント**: work-planner完了時点で停止（task-decomposer以降は実行しない）
- フローに定義された次のサブエージェントを呼び出す

## 📋 sub-agents.md準拠の実行

**実行前チェック（必須）**：
- [ ] sub-agents.mdの該当フローを確認した
- [ ] 現在の進捗位置を特定した
- [ ] 次のステップを明確にした
- [ ] **停止ポイント（work-planner完了）を認識した**

**フロー逸脱禁止**: sub-agents.mdに定義されたフローから外れることは禁止。ただし、task-decomposer以降は実行しない。

## 🎯 オーケストレーターとしての必須責務

### 設計・計画フェーズの完了条件
以下がすべて揃った時点で完了：
1. ✅ requirements.md（要件定義書）が作成されている
2. ✅ ADR（アーキテクチャ決定記録）が作成されている
3. ✅ design.md（技術設計書）が作成されている
4. ✅ plan.md（作業計画書）が作成されている
5. ✅ meta.jsonのstatusが"design_review"に更新されている

### テスト情報の伝達
acceptance-test-generator実行後、work-planner呼び出し時には以下を伝達：
- 生成された統合テストファイルパス
- 生成されたE2Eテストファイルパス
- 統合テストは実装と同時、E2Eは全実装後に実行する旨の明示

## 責務境界

**本コマンドの責務**: オーケストレーターとしてサブエージェントを適切に振り分け、設計・計画フェーズまでを管理
**責務外**:
- タスク分解（task-decomposer）- このコマンドでは実行しない
- 実装作業（task-executor）- このコマンドでは実行しない
- 品質保証（quality-fixer）- 実装後のため不要
- 自身での調査作業（Grep/Glob/Read等）- サブエージェントに委譲

---

## 同期ポイント（CHECKPOINT）

### CHECKPOINT: 設計・計画完了時（唯一の同期ポイント）

**タイミング**: work-planner完了後

**実行内容**:
1. meta.jsonのstatusを"design_review"に更新（Editツール使用）

2. 完了報告をユーザーに提示:
   - 作成されたドキュメント一覧
   - 大まかな作業フェーズと推定工数
   - 次のステップ（設計レビュー待ち、または `/implement` で実装開始）

**目的**: 設計・計画フェーズ完了をmeta.jsonに記録する

## 実行フロー（詳細）

### Phase 1: 要件分析
1. **ストーリー情報取得**（ストーリーディレクトリパス指定時）
   - ローカルの story.md / requirements.md / meta.json をReadツールで読み込み
   - **要求情報（requirements）も含めて取得**
   - meta.jsonが存在しない場合は新規作成

2. **requirement-analyzer実行**
   - 入力: ストーリー情報（**要求情報を含む**） + ユーザー追加指示
   - 出力: 作業規模判定（大規模/中規模/小規模）、推奨アプローチ
   - **要求情報の活用**: story.md / requirements.md内の詳細な要件を反映

3. **sub-agents.md参照**
   - 規模に応じたフローを確認
   - Figma統合の要否を判定

### Phase 2: PRD作成（必要時）
- prd-creator実行（requirement-analyzerの判定による）
- 出力: PRD.md（要件定義書のベース）

### Phase 3: 技術設計
1. **technical-designer実行**
   - 入力: 要件情報（**story.md / requirements.md 情報を含む**）、プロジェクトコンテキスト、追加指示
   - 出力: ADR（アーキテクチャ決定記録）、design.md（技術設計書）
   - **要求情報の活用**: story.md / requirements.mdの詳細をdesign.mdの機能要件・受入条件に反映

2. **Figma統合（該当時）**
   - figma-design-importer実行
   - Figmaデザインデータをキャッシュ
   - design.mdにFigma参照を追加

### Phase 4: 作業計画
1. **acceptance-test-generator実行**
   - 入力: design.mdの受入条件
   - 出力: 統合テストスケルトン、E2Eテストスケルトン

2. **work-planner実行**
   - 入力: design.md、テストファイルパス
   - 出力: plan.md（作業計画書、フェーズ別の作業内容と推定工数）

### Phase 5: meta.json更新と完了報告
1. **meta.jsonのstatusを"design_review"に更新**（Editツール使用）

2. **完了報告**
   ```
   ✅ 設計・計画フェーズ完了

   ## 作成されたドキュメント
   - requirements.md（要件定義書）
   - specs/adr/XXX.md（アーキテクチャ決定記録）
   - design.md（技術設計書）
   - plan.md（作業計画書）

   ## 作業概要（plan.mdより）
   - Phase数: N個
   - 推定工数: X時間

   ## 次のステップ
   1. 設計レビューを受ける
   2. レビュー承認後、以下のいずれかを選択:
      - `/implement` で実装を開始（タスク分解から実装まで自動実行）
      - 手動でタスク分解を実施してから実装
   ```

## 品質基準

### 必須条件
- [ ] requirements.mdが存在し、要件が明確に定義されている
- [ ] ADRが作成され、技術的決定が記録されている
- [ ] design.mdが作成され、実装アプローチが明確
- [ ] plan.mdが作成され、フェーズ別の作業計画が立案されている
- [ ] meta.jsonのstatusが"design_review"に更新されている

### 推奨条件
- [ ] ADRに代替案と選択理由が記載されている
- [ ] design.mdに受入条件（Acceptance Criteria）が明確
- [ ] plan.mdに各フェーズの推定工数が記載されている
- [ ] plan.mdに想定リスクと対策が記載されている

## エラーハンドリング

### ストーリー情報取得失敗
- ローカルファイルの読み込みがエラー
- 対処: ストーリーディレクトリパスの確認を促す、手動で要件を入力してもらう

### 設計フェーズでの判断不能
- technical-designerが複数の選択肢を提示
- 対処: ユーザーに選択を促す、AskUserQuestionで確認

### Figma情報取得失敗
- figma-design-importerがエラー
- 対処: Figma URLの確認、権限確認、手動でデザイン情報を入力

### meta.json更新失敗
- meta.jsonの読み込みまたは書き込みがエラー
- 対処: エラーメッセージを提示、手動でmeta.jsonを更新するよう促す

## 制約事項

### このコマンドで実施しないこと
1. **タスク分解**（task-decomposer）- `/implement` コマンドで実施
2. **実装作業**（task-executor）- `/implement` コマンドで実施
3. **品質保証**（quality-fixer）- 実装後に実施
4. **コードレビュー**（code-reviewer）- 実装後に実施
5. **PRレビュー**（ui-fixer、visual-checker）- 実装後に実施

### 実装開始の方法
設計・計画フェーズ完了後、実装を開始する場合：

```bash
# /design-to-implementation コマンドで実装を開始（タスク分解から実装まで自動実行）
/design-to-implementation <ストーリーディレクトリパス>
```

## まとめ

`/story-to-design`コマンドは、ストーリーから設計・作業計画までを自動化し、実装前の準備（要件定義、技術設計、作業計画）を完全に整えます。

**利点**：
- 設計レビューを受けてから実装開始できる
- 大まかな作業規模と工数を事前に把握できる
- タスク分解前に設計承認を得られる
- 他の開発者への引き継ぎが容易

**次のステップ**：
- 設計レビューを受ける
- `/design-to-implementation <ストーリー識別子>` で実装を開始
