# UIデザイン統合ルール

Figmaデザインデータとコード実装の統合に関する共通ルールを定義します。

## Figmaキャッシュ構造（標準仕様）

### ディレクトリ構造

```
specs/stories/{STORY_ID}-{title}/ui-design/
├── metadata.json                 # メタデータ（必須: id, feature, figma_file_key, tools_used）
├── variables.json                # デザイントークン（色、spacing、typography）
├── code-connect.json             # コード連携情報（optional）
├── outline.json                  # 全体構造（大規模時のみ）
├── rules.json                    # デザインルール（初回のみ）
└── components/                   # コンポーネント詳細仕様
    ├── Button.json
    ├── Input.json
    └── Card.json
```

### metadata.json 必須フィールド

| フィールド | 型 | 例 |
|-----------|---|---|
| id | string | "DEBT-S-001" |
| feature | string | "user-profile" |
| figma_file_key | string | "abc123" |
| tools_used | array | [{"tool": "get_variable_defs", "output_file": "variables.json"}] |
```

### 取得パターン

#### パターンA: 小〜中規模プロジェクト
1. `get_variable_defs` → variables.json
2. `get_design_context`（コンポーネントごと） → components/*.json
3. `get_code_connect` → code-connect.json

#### パターンB: 大規模プロジェクト
1. `get_design_context_outline` → outline.json（全体構造把握）
2. 必要なノードを特定
3. `get_design_context`（特定ノードのみ） → components/*.json
4. `get_variable_defs` → variables.json
5. `get_code_connect` → code-connect.json

#### パターンC: 初回プロジェクト設定
1. `get_rules_prompt` → rules.json
2. パターンAまたはBを実行

## MCPレスポンス構造の扱い

### 基本原則

**重要**: Figma MCP Serverのレスポンススキーマは非公開。以下の原則で対応：

1. **生データ保存**: レスポンスを変換せずそのまま保存
2. **柔軟な探索**: `_mcp_response`内を再帰的に探索
3. **命名バリエーション対応**: camelCase/snake_case/kebab-caseの全パターンを考慮
4. **フォールバック検索**: 標準パスで見つからない場合はJSON全体を検索

## データ抽出ルール

### 値の変換原則

| データ型 | Figma表現 | 変換ルール | 例 |
|---------|----------|-----------|---|
| 色 | RGB (0-1浮動小数点) | Math.round(value * 255) → HEX | {r:0, g:0.478, b:1} → #007AFF |
| サイズ | 数値（ピクセル） | そのまま使用、単位付加 | 44 → "44px" |
| スペーシング | 数値（ピクセル） | そのまま使用、単位付加 | 16 → "16px" |

**注意**: 色変換時は`Math.round`で丸め、大文字HEX表記を使用

## ui-fixer統合ルール

### 実行タイミング

#### 1. 個別タスク完了時
- **対象**: そのタスクで実装したUIコンポーネント
- **目的**: 早期のデザイン乖離検出
- **タイミング**: 実装完了 → テスト完了 → ui-fixer実行

#### 2. 最終検証時
- **対象**: 全UIコンポーネント
- **目的**: 最終的なデザイン準拠確認
- **タイミング**: 全実装完了 → 全テスト完了 → ui-fixer実行

### パラメータ仕様

ui-fixerを実行する際は、以下のパラメータを必ず指定：

```yaml
cache_directory: specs/stories/{STORY_ID}-{title}/ui-design/
  # 例: specs/stories/S-34-user-profile/ui-design/

target_component: [ComponentName]
  # 例: Button, Input, Card
  # components/[ComponentName].json に対応

implementation_path: [実装ファイルパス]
  # 例: src/components/Button.tsx
```

### 実行フロー

**UIタスクの品質保証フロー概要**:

```
task-executor → ui-fixer → quality-fixer → commit
```

**詳細なオーケストレーション手順は @steering/sub-agents.md を参照**。

本セクションでは各エージェントの技術的責務を定義します。

### 結果判定基準

**エージェントのステータス判定とオーケストレーション手順は @steering/sub-agents.md の「ステータス判定表」を参照**。

本セクションでは各エージェント内部での判定基準を定義します（エージェント実装者向け）。

### エスカレーション基準

以下の場合は即座にエスカレーション：

1. **3回連続失敗**: 根本的なDesign Doc乖離の可能性
2. **エラーメッセージ不明瞭**: 構造不明、データ未取得等で判断不可
3. **Design Docとの根本的不一致**: 指定された仕様と実装の基本的な矛盾

## エージェント別責務定義

各エージェントがこのルールファイルをどう活用するかを明確化します。

### figma-design-importer
**役割**: Figma MCPから生データを取得し、情報劣化ゼロでキャッシュ
**活用**: Figmaキャッシュ構造に従いディレクトリ作成、取得パターン選択、metadata.json記録
**禁止**: データの変換・解釈・要約

### ui-fixer
**役割**: デザイン仕様と実装の差異を検証し、不一致を自動修正
**活用**: キャッシュ読込→MCPレスポンス柔軟探索→データ抽出ルール適用→差異修正→サマリー生成
**検証対象**: 画面構造（コンポーネント存在・数・配置）、個別要素（色・サイズ・レイアウト・タイポグラフィ・効果）

### task-executor
**役割**: UIタスク実装時にデザインデータを活用し、ui-fixerで検証
**活用**: キャッシュ読込→データ抽出ルール適用→実装→ui-fixer実行
**例**: Design Doc記載「背景色: variables.json:colors.primary → #007AFF」→ variables.json読込→柔軟探索→RGB→HEX変換→実装

### technical-designer
**役割**: Design Docにデザイン仕様とデータソースを明記
**活用**: Design Docに以下を記載
- デザイントークン定義セクション: `variables.json`パス、トークン表
- UIコンポーネント設計セクション: `components/[Component].json`パス、仕様
- 受入条件（AC）: UI要件とデータソース併記
**参照**: @.claude/templates/design/template.md

### work-planner
**役割**: 作業計画書にui-fixer実行を組み込み、パラメータを明記
**活用**: 各UIタスクの完了条件に「ui-fixerで全チェックパス（cache, component, implementation指定）」を含める
**参照**: @.claude/templates/plans/template.md

### acceptance-test-generator
**役割**: ビジュアル検証チェックリストを生成
**活用**: Design Docに`ui_design`パスが記載されている場合、`specs/stories/{STORY_ID}-{title}/ui-design/visual-checklist.md`を生成
**生成内容**: 検証ページリスト、URL、タイミング、Figmaキャッシュパス、実行方法、完了条件

### visual-checker
**役割**: Figmaデザインと実装スクリーンショットの視覚的差異を分析・報告（自動修正なし）
**活用**: キャッシュ読込→MCPレスポンス柔軟探索→データ抽出ルール適用→差異検出→優先度判定→レポート生成
**検証対象**: レイアウト構造、色（HEX値）、タイポグラフィ、スペーシング、サイズ
**出力**: 構造化レポート（passed/needs_attention/failed）、修正提案、エスカレーション判断

## 補足: Figma MCP Serverツール仕様

参考情報として、Figma MCP Serverの5つのツールの概要：

| ツール名 | 用途 | 出力ファイル |
|---------|------|-------------|
| `get_variable_defs` | デザイントークン取得（色、spacing、typography） | variables.json |
| `get_design_context` | コンポーネント詳細仕様取得 | components/*.json |
| `get_code_connect` | コード連携情報取得 | code-connect.json |
| `get_design_context_outline` | 全体構造のアウトライン取得（大規模時） | outline.json |
| `get_rules_prompt` | Figmaデザインルール取得（初回のみ） | rules.json |

詳細は調査レポート `tmp/figma-mcp-investigation-results.md` を参照。

## バージョン情報

- **作成日**: 2025-01-20
- **バージョン**: 1.0.0
- **適用開始**: 本ファイル作成時点から全UIタスクに適用
