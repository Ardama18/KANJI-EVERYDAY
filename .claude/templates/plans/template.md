---
id: [STORY_ID]
feature: [機能名]
type: plan
version: 1.0.0
created: [YYYY-MM-DD]
based_on: specs/stories/[STORY_ID]-[title]/design.md
ui_design: [specs/stories/[STORY_ID]-[title]/ui-design/]（UI実装を含む場合のみ。不在の場合は "none"）
---

# 作業計画書: [タイトル]

作成日: YYYY-MM-DD
種別: feature|fix|refactor
想定影響範囲: Xファイル
関連Issue/PR: #XXX（あれば）

## 関連ドキュメント
- ADR: [specs/adr/[num]-[title].md]（あれば）
- 要件定義書: [specs/stories/[STORY_ID]-[title]/requirements.md]（あれば）
- Figma UI仕様: [specs/stories/[STORY_ID]-[title]/ui-design/]（UI実装を含む場合のみ）
  - outline.json: 画面構造
  - screenshots/: 視覚確認用
  - components/: 詳細仕様（TSX）

## 目的
[なぜこの変更が必要か、解決する問題は何か]

## 影響範囲
### 対象ファイル
- [ ] {backend,frontend}/src/domain/xxx
- [ ] {backend,frontend}/src/application/xxx
- [ ] {backend,frontend}/src/infrastructure/xxx
- [ ] {backend,frontend}/src/presentation/xxx

### テストファイル
※ 配置・命名は @.claude/steering/typescript-testing.md「命名規則」「ディレクトリ構造」に準拠
- [ ] 単体テスト: ソースと同フォルダに `{ファイル名}.unit.test.ts`
- [ ] 統合テスト: `tests/integration/{機能名}.int.test.ts`
- [ ] E2Eテスト: `e2e/tests/{機能名}.e2e.test.ts`

### ドキュメント
- [ ] ADR作成が必要（アーキテクチャ変更の場合）
- [ ] Design Doc更新が必要
- [ ] READMEの更新が必要

## 実装計画

（注: フェーズ構成はDesign Docの技術的依存関係と実装アプローチに基づいて決定）

### Phase 1: [フェーズ名]（想定コミット数: X）
**目的**: [このフェーズで達成すること]

#### タスク
※ テストパスは @.claude/steering/typescript-testing.md 参照
- [ ] タスク1: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] タスク2: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] 単体テスト: 関連するテストがすべてパス

**タスク記載例**:
- [ ] UserService実装と単体テスト作成
  - 実装: backend/src/services/UserService.ts
  - テスト: backend/src/services/UserService.unit.test.ts
- [ ] 統合テスト作成
  - テスト: backend/tests/integration/userAuth.int.test.ts

**（UI実装タスクの場合の完了条件例）**:
- [ ] Button コンポーネント実装
  - Props定義完了（variant, size, disabled）
  - 基本スタイル実装完了
  - 単体テスト作成・実行完了
  - **検証方法**: サブエージェント呼び出し（ui-fixer）
  - cache: specs/stories/[STORY_ID]-[title]/ui-design/
  - component: Button
  - implementation: frontend/src/components/Button.tsx

#### フェーズ完了条件
- [ ] [機能的な完了条件]
- [ ] [品質的な完了条件]

#### 動作確認手順
1. [動作確認手順]
2. [期待結果の確認]
3. [パフォーマンス確認（該当する場合）]

### Phase 2: [フェーズ名]（想定コミット数: X）
**目的**: [このフェーズで達成すること]

#### タスク
※ テストパスは @.claude/steering/typescript-testing.md 参照
- [ ] タスク1: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] タスク2: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] 統合テスト: 機能全体の動作確認
  - テスト: `{backend,frontend}/tests/integration/{機能名}.int.test.ts`

#### フェーズ完了条件
- [ ] [機能的な完了条件]
- [ ] [品質的な完了条件]

#### 動作確認手順
1. [動作確認手順]
2. [期待結果の確認]
3. [パフォーマンス確認（該当する場合）]

### Phase 3: [フェーズ名]（想定コミット数: X）
**目的**: [このフェーズで達成すること]

#### タスク
※ テストパスは @.claude/steering/typescript-testing.md 参照
- [ ] タスク1: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] タスク2: 具体的な作業内容
  - 実装: {backend,frontend}/src/{ディレクトリ}/{ファイル名}.ts
  - テスト: 同フォルダに `{ファイル名}.unit.test.ts`
- [ ] 統合テスト: コンポーネント間の連携確認
  - テスト: `{backend,frontend}/tests/integration/{機能名}.int.test.ts`

#### フェーズ完了条件
- [ ] [機能的な完了条件]
- [ ] [品質的な完了条件]

#### 動作確認手順
[Design Docの該当統合ポイントのE2E確認を転記]

---


### 最終Phase: 品質保証（必須）（想定コミット数: 1-2）
## 目的: 全体品質の保証とDesign Doc整合性確認

#### タスク
- [ ] Design Doc全受入条件の達成確認
- [ ] 全テスト実行
- [ ] カバレッジ70%以上
- [ ] **（UI実装を含む場合）ビジュアル検証実行**: サブエージェント呼び出し（visual-checker）
- [ ] ドキュメント更新

#### 動作確認手順
[Design DocのE2E確認手順を転記]

## 備考
[特記事項、参考情報、注意点など]