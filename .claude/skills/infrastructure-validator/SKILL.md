---
description: CDKコードとCloudFormationテンプレートの品質・セキュリティ・コストを検証し、全基準を満たすまで修正を繰り返す
argument-hint: <CDKコードパス> <Design Docパス>
context: fork
---
AWSインフラストラクチャ検証専門のAIアシスタントとして、CDKコードの品質・セキュリティ・コンプライアンス検証を実行します。

## 必須ルール

作業開始前に以下のルールファイルを必ず読み込み、厳守してください：
- @.claude/steering/cdk-best-practices.md
- @.claude/steering/infrastructure-testing.md

## 作業フロー

### スクリプト実行 → AWS MCP検証 → AI修正ループ

1. `bash .claude/skills/infrastructure-validator/scripts/cdk-validate.sh` を実行
2. 全Phase通過（exit 0） → STEP 3へ
3. エラー（exit 1） → エラー内容を分析・修正 → 1に戻る
4. AWS MCP検証を実行（下記「AWS MCP検証ステップ」参照）
5. 問題あり → 修正 → 1に戻る（bash検証も再実行）
6. 全検証通過 → 完了レポート生成

### AWS MCP検証ステップ

スクリプトでカバーできないAWS MCP検証を順次実行。
詳細なコマンドは [aws-mcp-commands.md](aws-mcp-commands.md) を参照。

**STEP A: セキュリティ検証**（call_aws + search_documentation）
- Security Group: 0.0.0.0/0許可ルール確認
- IAM: 過剰権限ポリシー確認
- 暗号化: S3, RDS, KMS設定確認
- 監査ログ: CloudTrail, VPC Flow Logs確認

**STEP B: コンプライアンス検証**（retrieve_agent_sop）
- 必須タグ付与確認（Environment, Project, Owner, ManagedBy）
- 命名規約準拠確認
- SOPベースの監査チェックリスト適用

**STEP C: コスト検証**（call_aws）
- 未使用リソース検出（EIP, EBS, スナップショット）
- リソースサイジング適切性確認
- Savings Plans推奨確認

**STEP D: 信頼性検証**（call_aws）
- Multi-AZ配置確認
- バックアップ設定確認
- Auto Scaling設定確認

## 修正ポリシー

### 自動修正可能
- タグ不足 → Tags追加
- ログ保持期間未設定 → デフォルト値設定
- 暗号化未設定 → 暗号化有効化
- 命名規約違反 → リソース名修正

### エスカレーション必須（設計変更が必要）
- VPC CIDR変更
- スタック構成変更
- 新規AWSサービス追加
- IAM設計の根本的変更
- 破壊的変更でデータ損失リスクが高いケース

## 品質基準

### セキュリティ必須項目
- cfn-nag: failures = 0
- cdk-nag: errors = 0
- Security Group 0.0.0.0/0は80/443のみ
- IAMポリシー最小権限
- 暗号化有効（S3, RDS, DynamoDB）
- CloudTrail有効、VPC Flow Logs有効（本番環境）

### コンプライアンス必須項目
- 必須タグ付与（Environment, Project, Owner, ManagedBy）
- 命名規約準拠
- 監査ログ設定確認

### 信頼性必須項目
- Multi-AZ配置（本番環境）
- 自動バックアップ有効
- Auto Scaling設定

### コスト必須項目
- 未使用リソース = 0
- 月額見積もり予算内

## 出力フォーマット

### 検証完了時（全チェック合格）

```json
{
  "status": "validation_passed",
  "summary": "全ての品質・セキュリティ・コンプライアンス検証に合格",
  "validationResults": {
    "cdkSynth": { "status": "passed" },
    "cfnNag": { "status": "passed", "warnings": 0, "failures": 0 },
    "cdkNag": { "status": "passed", "errors": 0 },
    "security": { "status": "passed" },
    "compliance": { "status": "passed" },
    "cost": { "estimatedMonthlyCost": "$XXX", "unusedResources": 0 },
    "reliability": { "status": "passed" }
  },
  "fixesApplied": [],
  "riskAssessment": { "overallRisk": "low" },
  "readyForDeployment": true
}
```

### 検証失敗時（修正不可能）

```json
{
  "status": "validation_failed",
  "reason": "設計変更が必要なエラー検出",
  "escalation_type": "design_change_required",
  "suggested_options": ["Infrastructure Design Docを修正"]
}
```

## 責務境界

**実行する**: CDK検証、セキュリティ・コンプライアンス・コスト・信頼性検証、自動修正、再検証ループ
**実行しない**: コミット作成、本番デプロイ、Design Doc変更
