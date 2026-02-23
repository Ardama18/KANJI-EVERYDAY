# AWS MCP 検証コマンドリファレンス

## 利用可能なAWS MCPツール

| ツール | 用途 | 優先度 |
|-------|------|--------|
| `call_aws` | 実環境リソース検証 | **最高** |
| `search_documentation` | セキュリティベストプラクティス検索 | **最高** |
| `retrieve_agent_sop` | コンプライアンス手順取得 | 高 |
| `read_documentation` | Well-Architected詳細取得 | 高 |
| `suggest_aws_commands` | 検証コマンド提案 | 中 |

## セキュリティ検証

```yaml
Security Group検証:
  call_aws: aws ec2 describe-security-groups --query 'SecurityGroups[?IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]]]' --region ap-northeast-1
  call_aws: aws ec2 describe-security-groups --query 'SecurityGroups[?IpPermissions[?FromPort==`22` && IpRanges[?CidrIp==`0.0.0.0/0`]]]' --region ap-northeast-1

IAM検証:
  call_aws: aws iam get-policy-version --policy-arn {arn} --version-id v1
  call_aws: aws accessanalyzer list-findings --analyzer-arn {arn}
  call_aws: aws iam get-account-summary

暗号化検証:
  call_aws: aws s3api get-bucket-encryption --bucket {bucket-name}
  call_aws: aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,StorageEncrypted]'
  call_aws: aws kms describe-key --key-id {key-id}

監査ログ検証:
  call_aws: aws cloudtrail describe-trails
  call_aws: aws ec2 describe-flow-logs
  call_aws: aws s3api get-bucket-logging --bucket {bucket-name}
```

## コンプライアンス検証

```yaml
タグ検証:
  call_aws: aws resourcegroupstaggingapi get-resources --tag-filters Key=Environment
  call_aws: aws resourcegroupstaggingapi get-resources --resource-type-filters ec2:instance --query 'ResourceTagMappingList[?Tags==`[]`]'

コンプライアンスSOP:
  retrieve_agent_sop: secure-s3-buckets
  retrieve_agent_sop: create-secrets-using-best-practices
  retrieve_agent_sop: cloudtral-mutli-region-setup
```

## コスト検証

```yaml
未使用リソース検出:
  call_aws: aws ec2 describe-addresses --query 'Addresses[?AssociationId==null]'
  call_aws: aws ec2 describe-volumes --query 'Volumes[?State==`available`]'
  call_aws: aws ec2 describe-snapshots --owner-ids self

コスト最適化:
  call_aws: aws ce get-savings-plans-purchase-recommendation --savings-plans-type COMPUTE_SP --term-in-years ONE_YEAR --payment-option NO_UPFRONT --lookback-period-in-days SIXTY_DAYS
  call_aws: aws cost-optimization-hub list-recommendations
```

## 信頼性検証

```yaml
Multi-AZ検証:
  call_aws: aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,MultiAZ]'
  call_aws: aws ecs describe-services --cluster {cluster} --services {service} --query 'services[*].deployments[*].networkConfiguration'

バックアップ検証:
  call_aws: aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,BackupRetentionPeriod]'
  call_aws: aws s3api get-bucket-versioning --bucket {bucket-name}
  call_aws: aws backup list-backup-plans

Auto Scaling検証:
  call_aws: aws application-autoscaling describe-scalable-targets --service-namespace ecs
  call_aws: aws lambda get-function-configuration --function-name {function-name} --query 'ReservedConcurrentExecutions'
```

## ベストプラクティスSOP

```yaml
セキュリティSOP:
  retrieve_agent_sop: secure-s3-buckets
  retrieve_agent_sop: create-secrets-using-best-practices
  retrieve_agent_sop: ec2-instance-profile-setup

監視SOP:
  retrieve_agent_sop: setup_cloudwatch_alarm_notifications
  retrieve_agent_sop: application-failure-troubleshooting

ドキュメント検索:
  search_documentation:
    topics: ["general"]
    query: "AWS Well-Architected security pillar"
```

## cfn-nag 重要ルール

| ルール | 内容 | 対応 |
|-------|------|------|
| W2 | Security Group allows 0.0.0.0/0 ingress | ポート80/443以外は禁止 |
| W9 | SSH from 0.0.0.0/0 | 即修正 |
| W12 | RDS without Multi-AZ | 本番環境では必須 |
| W28 | Resource without explicit name | 命名規約準拠 |
| W35 | S3 without access logging | 本番環境では推奨 |
| W51 | S3 without encryption | 即修正 |
| W58 | Lambda without CloudWatch Logs permission | 即修正 |

## cdk-nag 重要ルール

| ルール | 内容 | 対応 |
|-------|------|------|
| AwsSolutions-IAM4 | AWS管理ポリシーの使用 | カスタムポリシー推奨 |
| AwsSolutions-IAM5 | IAMワイルドカード使用 | 最小権限化 |
| AwsSolutions-S1 | S3アクセスログ未設定 | 本番環境では必須 |
| AwsSolutions-RDS2 | RDS暗号化未設定 | 即修正 |
| AwsSolutions-EC23 | Security Group 0.0.0.0/0許可 | 最小化 |
