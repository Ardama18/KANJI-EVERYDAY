# AWS CDK ベストプラクティス

AWS公式ドキュメントに基づくCDK（TypeScript）実装のベストプラクティス。

> **参照元**: [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)

## 関連ドキュメント

**実装フロー**:
1. **infrastructure-designer** → Infrastructure Design Doc作成
2. **cdk-implementer** → 本ファイルに準拠したCDK実装（本ファイル参照）
3. `/infrastructure-validator`（スキル） → Well-Architected検証

**関連ファイル**: `infrastructure-testing.md`

---

## 1. 組織のベストプラクティス

### Cloud Center of Excellence (CCoE)
- CDK標準・ポリシーの策定
- 開発チームのトレーニング・メンタリング
- ランディングゾーンの定義（AWS Control Tower活用）

### マルチアカウント戦略
```
開発者アカウント → CI/CDアカウント → テスト/本番アカウント
                    (CDK Pipelines)
```

---

## 2. コーディングベストプラクティス

### シンプルさを保つ
```typescript
// ✅ 良い例: 必要になるまで複雑さを追加しない
const bucket = new s3.Bucket(this, 'DataBucket');

// ❌ 悪い例: 過度な抽象化
class SuperConfigurableBucket extends Construct { /* 不要な複雑さ */ }
```

### AWS Well-Architected Frameworkとの整合
- **CDKアプリ = Well-Architectedコンポーネント**
- 再利用可能なコンストラクトはCodeArtifactで共有

### リポジトリ構成

**基本原則**:
- 1アプリ = 1リポジトリ（ブラストラディウス最小化）
- **Constructで論理単位をモデル化、Stackでデプロイ**
- 共有コンストラクトは別リポジトリに分離（必要な場合のみ）

```
infrastructure/
├── bin/
│   └── hapico-infra.ts  # エントリーポイント
├── lib/
│   ├── constructs/               # 再利用可能コンストラクト（論理単位）
│   │   ├── index.ts              # エクスポート定義
│   │   ├── alb.ts                # ALB, Target Group, ALB Log Bucket
│   │   ├── cloudfront.ts         # CloudFront Distribution
│   │   ├── cognito.ts            # 認証関連
│   │   ├── database.ts           # Aurora Serverless v2
│   │   ├── ecr.ts                # ECRリポジトリ
│   │   ├── ecs-fargate.ts        # ECS Cluster, Fargate Service, Task Definition
│   │   ├── eventbridge.ts        # EventBridge Scheduler
│   │   ├── lambda.ts             # Lambda関数
│   │   ├── monitoring.ts         # CloudWatch Alarms
│   │   ├── network.ts            # VPC, Subnet, NAT等
│   │   ├── security-groups.ts    # セキュリティグループ
│   │   ├── sqs.ts                # SQS FIFOキュー
│   │   └── waf.ts                # WAF WebACL
│   ├── stacks/                   # スタック定義（デプロイ単位）
│   │   ├── base-stack.ts         # 共通基底スタック
│   │   ├── waf-stack.ts          # WAF (us-east-1)
│   │   ├── infra-stack.ts        # Stateful: VPC, SG, ECR, Aurora, SQS, Cognito
│   │   ├── platform-stack.ts     # Platform: ECS Cluster, ALB, CloudFront
│   │   ├── frontend-app-stack.ts # Frontend ECS Service
│   │   ├── backend-app-stack.ts  # Backend ECS Service
│   │   ├── worker-stack.ts       # Lambda Workers (IVR, SMS, Email, DLQ)
│   │   └── batch-stack.ts        # Batch Producer (ECS Task + EventBridge)
│   └── config/
│       └── environment.ts        # 環境別設定 (stg, stg2, demo, prod)
├── test/
│   └── unit/
│       └── hapico-stack.test.ts
└── cdk.json
```

> **ポイント**: 分離する明確な理由がない限り、1つのStackにまとめる方がシンプル

### インフラとランタイムコードの同居
```typescript
// ✅ 良い例: 同一Constructでインフラ+ランタイムを定義
export class ApiHandler extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda/api-handler'), // ランタイムコード同居
    });
  }
}
```

---

## 3. コンストラクトベストプラクティス

### 環境変数ではなくプロパティで設定
```typescript
// ✅ 良い例: プロパティで設定
interface MyConstructProps {
  readonly bucketName: string;
  readonly enableEncryption: boolean;
}

export class MyConstruct extends Construct {
  constructor(scope: Construct, id: string, props: MyConstructProps) {
    // props経由で設定
  }
}

// ❌ 悪い例: 環境変数参照
const bucketName = process.env.BUCKET_NAME; // Construct内部での環境変数参照は避ける
```

### ステートフルリソースのLogical ID保護
```typescript
// ⚠️ 注意: Logical IDの変更はリソース再作成を引き起こす
// Unit Testで検証する

test('Database logical ID is stable', () => {
  const app = new App();
  const stack = new DatabaseStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  // Logical IDが変わっていないことを確認
  template.hasResource('AWS::RDS::DBInstance', {});
});
```

### コンプライアンスはConstructだけに頼らない
```typescript
// Constructラッパーは「ガイダンス」として有効
export class SecureBucket extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.KMS,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
  }
}

// ただし強制にはAWS側の機能を使用:
// - Service Control Policies (SCP)
// - Permission Boundaries
// - Aspects + CloudFormation Guard
```

---

## 4. アプリケーションベストプラクティス

### 合成時に決定を行う
```typescript
// ✅ 良い例: TypeScriptで条件分岐
if (props.environment === 'production') {
  new ProductionDatabase(this, 'DB');
} else {
  new DevelopmentDatabase(this, 'DB');
}

// ❌ 悪い例: CloudFormation Conditionsを使用
// CfnCondition, Fn.conditionIf は避ける
```

### 生成されたリソース名を使用
```typescript
// ✅ 良い例: CDKに名前を生成させる
const table = new dynamodb.Table(this, 'Table', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  // tableNameを指定しない → CDKが一意の名前を生成
});

// Lambda環境変数で参照
new lambda.Function(this, 'Function', {
  environment: {
    TABLE_NAME: table.tableName, // 生成された名前を参照
  },
});

// ❌ 悪い例: ハードコードされた名前
const table = new dynamodb.Table(this, 'Table', {
  tableName: 'my-table', // 同じアカウントに2つデプロイできない
});
```

### RemovalPolicyとログ保持の明示的設定
```typescript
// 開発環境
const devBucket = new s3.Bucket(this, 'DevBucket', {
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

// 本番環境
const prodBucket = new s3.Bucket(this, 'ProdBucket', {
  removalPolicy: RemovalPolicy.RETAIN,
});

// ログ保持期間の明示
new logs.LogGroup(this, 'LogGroup', {
  retention: logs.RetentionDays.ONE_MONTH, // デフォルトは無期限
});
```

### スタック分離戦略

> **AWS公式ガイダンス**: 分離する明確な理由がない限り、リソースは同じStackに保つ方がシンプル

#### 基本原則

| 原則 | 説明 |
|------|------|
| **同じStackにまとめる** | 分離する明確な理由がない限り、リソースは同じStackに保つ |
| **Stateful/Statelessの分離を検討** | DB等のステートフルリソースは別Stackに分離可能。Termination Protectionを有効にできる |
| **ステートフルリソースは名前変更に敏感** | 名前変更 → リソース置換。移動・名前変更されやすいConstructの中にネストしない |

#### 推奨構成: Constructでモデル化、Stackでデプロイ

> ディレクトリ構成は「2. コーディングベストプラクティス > リポジトリ構成」を参照

```typescript
// ✅ 良い例: Constructで論理単位をモデル化
// lib/constructs/network.ts
export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.IVpc;
  public readonly subnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    // VPC, Subnet, NAT等を定義
  }
}

// lib/constructs/application.ts
export class ApplicationConstruct extends Construct {
  constructor(scope: Construct, id: string, props: ApplicationProps) {
    super(scope, id);
    // EC2, ALB, Route53等を定義
  }
}

// lib/stacks/app-stack.ts
// ✅ 良い例: Stackは複数Constructを組み合わせてデプロイ
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const network = new NetworkConstruct(this, 'Network', { /* ... */ });
    new ApplicationConstruct(this, 'Application', {
      vpc: network.vpc,
      // ...
    });
  }
}
```

#### Stateful/Stateless分離が必要な場合

```typescript
// ステートフルリソース（DB等）を別Stackに分離する場合のみ
const dataStack = new DataStack(app, 'DataStack', {
  env,
  terminationProtection: true, // 終了保護を有効化
});

const computeStack = new ComputeStack(app, 'ComputeStack', {
  env,
  database: dataStack.database, // クロススタック参照
});
```

#### ⚠️ ステートフルリソースの注意点

```typescript
// ❌ 悪い例: ステートフルリソースを移動・名前変更されやすいConstructにネスト
class FeatureToggleableConstruct extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);
    // このConstructが削除されるとDBも削除される
    new rds.DatabaseInstance(this, 'Database', { /* ... */ });
  }
}

// ✅ 良い例: ステートフルリソースはStack直下または専用Constructに配置
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // DBはStack直下に配置（Logical IDが安定）
    const database = new rds.DatabaseInstance(this, 'Database', { /* ... */ });

    // ステートレスリソースはConstruct内でOK
    new ApplicationConstruct(this, 'Application', {
      database,
    });
  }
}
```

### cdk.context.jsonをコミット
```typescript
// ✅ VPCルックアップなどの結果はcdk.context.jsonにキャッシュ
const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
  vpcId: 'vpc-1234567890abcdef0',
});

// cdk.context.jsonをgitにコミットすることで:
// - 決定論的なシンセシス
// - AWSへのネットワーク呼び出しを回避
// - 再現可能なビルド
```

### CDKにIAMロール管理を任せる
```typescript
// ✅ 良い例: grant()メソッドで最小権限を付与
bucket.grantRead(lambdaFunction);
table.grantReadWriteData(lambdaFunction);

// ❌ 悪い例: 事前定義ロールを強制
// （開発者の柔軟性を損なう）
```

### 全環境をコードで定義
```typescript
// lib/config/environments.ts
export const environments = {
  dev: {
    account: '111111111111',
    region: 'ap-northeast-1',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
  },
  staging: {
    account: '222222222222',
    region: 'ap-northeast-1',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
  },
  production: {
    account: '333333333333',
    region: 'ap-northeast-1',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.M6G, ec2.InstanceSize.LARGE),
  },
};

// bin/app.ts
Object.entries(environments).forEach(([envName, config]) => {
  new MyStack(app, `${envName}-Stack`, { env: config });
});
```

### メトリクス・アラーム・ダッシュボードの実装
```typescript
// L2 Constructの便利メソッドを活用
const errorMetric = table.metricUserErrors({
  period: Duration.minutes(5),
});

new cloudwatch.Alarm(this, 'TableErrorAlarm', {
  metric: errorMetric,
  threshold: 10,
  evaluationPeriods: 1,
});
```

---

## 5. テスト戦略

### Fine-grained Assertions（細粒度アサーション）
```typescript
import { Template, Match } from 'aws-cdk-lib/assertions';

test('Lambda has correct configuration', () => {
  const app = new App();
  const stack = new MyStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  // リソースプロパティの検証
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs20.x',
    MemorySize: 256,
  });

  // リソース数の検証
  template.resourceCountIs('AWS::DynamoDB::Table', 1);
});
```

### Matchersの活用
```typescript
import { Match } from 'aws-cdk-lib/assertions';

// 部分一致（デフォルト）
template.hasResourceProperties('AWS::IAM::Role', {
  AssumeRolePolicyDocument: Match.objectLike({
    Statement: Match.arrayWith([
      Match.objectLike({
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
      }),
    ]),
  }),
});

// 完全一致
template.hasResourceProperties('AWS::S3::Bucket',
  Match.objectEquals({
    BucketEncryption: { /* ... */ },
  })
);

// 任意の値を許容
template.hasResourceProperties('AWS::Lambda::Function', {
  FunctionName: Match.anyValue(),
});
```

### Snapshot Tests（スナップショットテスト）
```typescript
test('Stack matches snapshot', () => {
  const app = new App();
  const stack = new MyStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  expect(template.toJSON()).toMatchSnapshot();
  // 初回: スナップショット作成
  // 以降: 差分検出（意図的な変更はスナップショット更新）
});
```

### Captureで動的値を取得
```typescript
import { Capture } from 'aws-cdk-lib/assertions';

test('Lambda has correct environment variables', () => {
  const template = Template.fromStack(stack);

  const envCapture = new Capture();
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: envCapture,
    },
  });

  // キャプチャした値を検証
  expect(envCapture.asObject()).toHaveProperty('TABLE_NAME');
});
```

---

## 6. セキュリティベストプラクティス

### 暗号化の徹底
```typescript
// S3
new s3.Bucket(this, 'Bucket', {
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: kmsKey,
  enforceSSL: true,
});

// RDS
new rds.DatabaseInstance(this, 'Database', {
  storageEncrypted: true,
  storageEncryptionKey: kmsKey,
});

// DynamoDB
new dynamodb.Table(this, 'Table', {
  encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
  encryptionKey: kmsKey,
});
```

### Secrets Manager活用
```typescript
// ✅ 良い例
const secret = new secretsmanager.Secret(this, 'DBSecret', {
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ username: 'admin' }),
    generateStringKey: 'password',
  },
});

new rds.DatabaseInstance(this, 'Database', {
  credentials: rds.Credentials.fromSecret(secret),
});

// Lambda環境変数にはARNのみ
new lambda.Function(this, 'Function', {
  environment: {
    DB_SECRET_ARN: secret.secretArn,
  },
});
secret.grantRead(lambdaFunction);
```

---

## 7. パフォーマンス最適化

### Graviton（ARM64）採用
```typescript
// Lambda
new lambda.Function(this, 'Function', {
  runtime: lambda.Runtime.NODEJS_20_X,
  architecture: lambda.Architecture.ARM_64, // x86比 20%高速、最大34%コスト削減
});

// ECS Fargate
new ecs.FargateTaskDefinition(this, 'Task', {
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.ARM64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

// RDS
new rds.DatabaseInstance(this, 'Database', {
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.R7G, ec2.InstanceSize.LARGE),
});
```

### VPC Endpoints
```typescript
// NAT Gatewayコスト削減 + レイテンシ改善
vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

vpc.addGatewayEndpoint('DynamoEndpoint', {
  service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
});
```

---

## 8. コスト最適化

### 開発環境の自動停止
```typescript
// EventBridgeで夜間停止
new events.Rule(this, 'StopDevResources', {
  schedule: events.Schedule.cron({ hour: '10', minute: '0' }), // JST 19:00
  targets: [new targets.LambdaFunction(stopFunction)],
});
```

---

## 9. デプロイ戦略

### 段階的デプロイ
```bash
# 1. 変更内容確認
npx cdk diff

# 2. 破壊的変更の確認
# Replacement: true → リソース再作成

# 3. 承認付きデプロイ
npx cdk deploy --require-approval always

# 4. ロールバック（必要時）
aws cloudformation cancel-update-stack --stack-name MyStack
```

---

## CDK実装チェックリスト

### コード品質
- [ ] TypeScript strict mode有効
- [ ] any型禁止
- [ ] プロパティはreadonly

### セキュリティ
- [ ] 暗号化設定（S3/RDS/DynamoDB）
- [ ] Secrets Manager使用
- [ ] 最小権限IAM（grant()使用）

### 信頼性
- [ ] マルチAZ配置
- [ ] RemovalPolicy明示
- [ ] ログ保持期間設定

### テスト
- [ ] Fine-grained assertions
- [ ] Snapshot tests
- [ ] Logical ID安定性テスト

### 運用
- [ ] CloudWatch Alarms
- [ ] タグ戦略
- [ ] cdk.context.jsonコミット
