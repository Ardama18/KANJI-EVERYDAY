---
description: AWS CDKインフラ構築のオーケストレーター（設計→実装→検証の完全サイクル管理）
argument-hint: <要件説明 or NotionURL> [追加指示]
disable-model-invocation: true
---
**コマンドコンテキスト**: AWSインフラ構築の完全サイクル管理（設計→CDK実装→検証）

## 入力形式

```
/infrastructure <要件説明> [追加指示]
```
または
```
/infrastructure <NotionストーリーURL> [追加指示]
```

**引数**：
- `<要件説明>` または `<NotionストーリーURL>`: インフラ要件の説明またはNotionページURL
- `[追加指示]` (任意): AWS Well-Architected柱の優先順位、コスト制約、セキュリティ要件等

## AWS MCP統合

**本コマンドの核心**: AWS MCPを最大限活用してインフラ構築を行う

各サブエージェント（infrastructure-designer, cdk-implementer）と `/infrastructure-validator` スキルがAWS MCPツールとSOPを適切に活用します。詳細なツール・SOP一覧は各エージェント/スキル定義を参照。

## 実行判断フロー

### 1. 現在状況の判定

指示内容: $ARGUMENTS

現在の状況を判定：

| 状況パターン | 判定基準 | 次のアクション |
|------------|---------|-------------|
| 新規インフラ要件 | 既存設計なし、新しいインフラ依頼 | infrastructure-designerから開始 |
| NotionストーリーURL付き | URLが指定されている | notion-client(fetch)→ストーリー情報取得→infrastructure-designerから開始 |
| 設計完了・実装待ち | ADR/Design Doc存在、CDKコードなし | cdk-implementerから開始 |
| 実装完了・検証待ち | CDKコード存在、検証未実施 | `/infrastructure-validator` スキルから開始 |
| フロー継続 | 既存ドキュメント/コードあり、継続指示 | 次のステップを特定 |
| 不明瞭 | 意図が曖昧、複数の解釈が可能 | ユーザーに確認 |

### 2. 規模判定

| 規模 | 判定基準 | フロー |
|------|---------|--------|
| 小規模 | 単一リソース変更、既存パターン適用 | 簡易設計 → cdk-implementer → `/infrastructure-validator` |
| 中規模 | 複数リソース、標準パターン | Design Doc → cdk-implementer → `/infrastructure-validator` |
| 大規模 | 新アーキテクチャ、複数サービス連携 | ADR → Design Doc → cdk-implementer → `/infrastructure-validator` |

## インフラ構築フロー

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AWS CDK インフラ構築パイプライン                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐                                               │
│  │ infrastructure-     │  AWS MCP活用:                                  │
│  │ designer            │  - retrieve_agent_sop (24 SOPs)               │
│  │                     │  - search_documentation                        │
│  │ 成果物:             │  - call_aws (既存リソース確認)                   │
│  │ - ADR              │  - get_regional_availability                   │
│  │ - Design Doc        │                                               │
│  └─────────┬───────────┘                                               │
│            │ [CHECKPOINT 1: 設計レビュー]                               │
│            ▼                                                           │
│  ┌─────────────────────┐                                               │
│  │ cdk-implementer     │  AWS MCP活用:                                  │
│  │                     │  - search_documentation (cdk_docs/constructs) │
│  │ 成果物:             │  - call_aws (既存設定参照)                      │
│  │ - CDK TypeScript    │  - recommend (関連パターン)                    │
│  │ - Unit Tests        │                                               │
│  │ - 合成テンプレート   │                                               │
│  └─────────┬───────────┘                                               │
│            │ [CHECKPOINT 2: 実装レビュー]                               │
│            ▼                                                           │
│  ┌─────────────────────┐                                               │
│  │ infrastructure-     │  AWS MCP活用:                                  │
│  │ validator           │  - call_aws (実環境検証)                       │
│  │                     │  - read_documentation (セキュリティガイド)      │
│  │ 成果物:             │  - retrieve_agent_sop (コンプライアンスSOP)    │
│  │ - 検証レポート       │                                               │
│  │ - 修正済みコード     │                                               │
│  │ - 品質証明書         │                                               │
│  └─────────────────────┘                                               │
│            │ [CHECKPOINT 3: 検証完了・デプロイ承認]                      │
│            ▼                                                           │
│  ┌─────────────────────┐                                               │
│  │ デプロイ準備完了     │                                               │
│  └─────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## オーケストレーターの責務

### 1. サブエージェント呼び出し

**infrastructure-designer呼び出し例**:
```yaml
subagent_type: "infrastructure-designer"
description: "インフラ設計"
prompt: |
  要件: VPCとLambda関数を含むサーバーレスAPIの構築

  追加指示:
  - 環境: ステージング
  - コスト優先
  - マルチAZ構成

  AWS MCP SOPを活用してADRとDesign Docを作成してください。
```

**cdk-implementer呼び出し例**:
```yaml
subagent_type: "cdk-implementer"
description: "CDK実装"
prompt: |
  Design Doc: specs/infrastructure/serverless-api/design.md

  Design Docに基づいてCDKコードを実装してください。
  TDDアプローチでUnit Testを先に作成してください。
```

**`/infrastructure-validator` スキル呼び出し例**:
```
/infrastructure-validator infrastructure/lib/serverless-api-stack.ts specs/infrastructure/serverless-api/design.md
```

### 2. CHECKPOINT管理

#### CHECKPOINT 1: 設計レビュー

**タイミング**: infrastructure-designer完了後、cdk-implementer実行前

**実行内容**:
1. ADR/Design Docの内容をユーザーに提示
2. Well-Architected 6本柱の考慮状況を報告
3. コスト見積もりを提示
4. 技術選択の根拠（AWS MCP検索結果）を説明

**停止**: ユーザー承認まで待機

#### CHECKPOINT 2: 実装レビュー

**タイミング**: cdk-implementer完了後、`/infrastructure-validator` 実行前

**実行内容**:
1. CDKコードの概要を提示
2. `cdk synth`で生成されたCloudFormationテンプレートの要点を報告
3. Unit Test結果を報告
4. 変更されるAWSリソースの一覧を提示

**停止**: ユーザー承認まで待機

#### CHECKPOINT 3: 検証完了・デプロイ承認

**タイミング**: `/infrastructure-validator` 完了後

**実行内容**:
1. 検証レポートの提示（セキュリティ、コスト、信頼性）
2. 修正箇所の報告（あれば）
3. デプロイコマンド（`cdk deploy`）の提示
4. ロールバック手順の確認

**停止**: デプロイ承認まで待機

### 3. エラー処理

| エラー種別 | 対応 |
|-----------|------|
| AWS MCP接続エラー | 接続設定確認を促す、代替手段を提案 |
| SOP未対応パターン | search_documentationで代替情報取得 |
| CDK synth失敗 | エラー内容分析、cdk-implementerで修正 |
| 検証失敗 | `/infrastructure-validator` で自動修正、修正不能ならエスカレーション |

## 自律実行モード

### 開始条件
CHECKPOINT 1（設計レビュー）承認後、以下を自律実行：
- cdk-implementer実行
- CHECKPOINT 2でユーザー報告（承認待ち）
- 承認後、`/infrastructure-validator` 実行
- CHECKPOINT 3で完了報告

### 停止条件
- **重大セキュリティ問題**: 公開Security Group、IAMワイルドカード等
- **コスト超過**: 見積もりの150%超
- **互換性問題**: 既存リソースとの競合
- **ユーザー割り込み**: 明示的な停止指示

## 禁止事項

### オーケストレーターの禁止行為
- ❌ 自分でCDKコードを書く（cdk-implementerに委譲）
- ❌ 自分でAWS CLIを実行する（サブエージェントがAWS MCPを使用）
- ❌ CHECKPOINTをスキップする
- ❌ ユーザー承認なしで`cdk deploy`を実行

### 品質保証の必須事項
- ✅ 各フェーズでAWS MCPを活用した検証
- ✅ Well-Architected 6本柱の考慮
- ✅ セキュリティ要件の確認（暗号化、IAM最小権限）
- ✅ コスト見積もりの提示

## 成果物ディレクトリ構造

```
specs/infrastructure/{feature-name}/
├── adr.md                    # Architecture Decision Record
├── design.md                 # Infrastructure Design Doc
├── cost-estimate.md          # コスト見積もり
└── validation-report.md      # 検証レポート

infrastructure/
├── lib/
│   └── {feature-name}-stack.ts  # CDK Stack
├── test/
│   └── {feature-name}.test.ts   # Unit Tests
└── cdk.out/                     # 合成テンプレート
```

## 使用例

### 例1: サーバーレスAPI構築
```
/infrastructure API Gateway + Lambda + DynamoDBのサーバーレスAPI構築。月間100万リクエスト想定、コスト重視。
```

### 例2: VPC構築
```
/infrastructure 本番環境用マルチAZ VPC構築。パブリック/プライベートサブネット、NAT Gateway含む。
```

### 例3: 監視基盤構築
```
/infrastructure CloudWatch + SNS + Lambda による監視・アラート基盤。Slack通知連携。
```

### 例4: NotionストーリーからのインフラTask
```
/infrastructure https://www.notion.so/DEBT-I-001 セキュリティ強化を優先
```

## 責務境界

**本コマンドの責務**:
- オーケストレーターとしてサブエージェントを適切に振り分け
- CHECKPOINTでユーザーとの同期を確保
- インフラ構築の完全サイクルを管理

**責務外**:
- 自身でのCDKコード実装
- 自身でのAWS CLI実行
- 調査作業（サブエージェントがAWS MCPを使用）
