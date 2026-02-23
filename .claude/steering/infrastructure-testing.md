# AWS CDK テストガイド

AWS公式ドキュメントに基づくCDKインフラコードのテスト戦略。

> **参照元**: [Test AWS CDK applications](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)

## 関連ドキュメント

**関連ファイル**: `cdk-best-practices.md`

**スキル**: `/infrastructure-validator` が本ファイルを参照してテスト・検証を実行

---

## テスト分類

AWS CDKでは2種類のテストを推奨:

| テスト | 目的 | 頻度 |
|--------|------|------|
| **Fine-grained assertions** | リソースプロパティの検証、リグレッション検出、TDD | コミット毎 |
| **Snapshot tests** | リファクタリング検証、意図しない変更検出 | コミット毎 |

追加で以下も実施:

| テスト | 目的 | ツール |
|--------|------|--------|
| **Security** | セキュリティ・コンプライアンス検証 | cdk-nag |
| **Integration** | 実環境動作確認 | AWS SDK + Jest |

---

## 1. Fine-grained Assertions

### 基本パターン

```typescript
// test/network-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';

describe('NetworkStack', () => {
  let template: Template;

  beforeEach(() => {
    const app = new App();
    const stack = new NetworkStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    template = Template.fromStack(stack);
  });

  test('VPC is created with correct CIDR', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });

  test('creates 6 subnets for Multi-AZ', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });
});
```

### Matchers

```typescript
import { Match } from 'aws-cdk-lib/assertions';

// 部分一致（デフォルト）
template.hasResourceProperties('AWS::Lambda::Function', {
  Runtime: 'nodejs20.x',
  Handler: 'index.handler',
});

// 完全一致
template.hasResourceProperties('AWS::IAM::Role',
  Match.objectEquals({
    AssumeRolePolicyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        },
      ],
    },
  })
);

// 任意の値
template.hasResourceProperties('AWS::Lambda::Function', {
  FunctionName: Match.anyValue(),
});

// 配列内に特定要素を含む
template.hasResourceProperties('AWS::IAM::Policy', {
  PolicyDocument: {
    Statement: Match.arrayWith([
      Match.objectLike({
        Effect: 'Allow',
        Action: 's3:GetObject',
      }),
    ]),
  },
});

// 存在しないことを確認
template.hasResourceProperties('AWS::EC2::SecurityGroup', {
  SecurityGroupIngress: Match.absent(), // インバウンドルールなし
});

// シリアライズされたJSON
template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
  DefinitionString: Match.serializedJson(
    Match.objectLike({
      StartAt: 'StartState',
    })
  ),
});
```

### Capture

```typescript
import { Capture } from 'aws-cdk-lib/assertions';

test('Lambda environment has TABLE_NAME', () => {
  const envCapture = new Capture();

  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: envCapture,
    },
  });

  // キャプチャした値を検証
  expect(envCapture.asObject()).toHaveProperty('TABLE_NAME');
});

test('State machine starts with correct state', () => {
  const startAtCapture = new Capture();
  const statesCapture = new Capture();

  template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
    DefinitionString: Match.serializedJson(
      Match.objectLike({
        StartAt: startAtCapture,
        States: statesCapture,
      })
    ),
  });

  // 開始状態が"Start"で始まる
  expect(startAtCapture.asString()).toMatch(/^Start/);
  // 開始状態がStatesに存在する
  expect(statesCapture.asObject()).toHaveProperty(startAtCapture.asString());
});
```

### findResources

```typescript
test('All Lambda functions have timeout set', () => {
  const lambdas = template.findResources('AWS::Lambda::Function');

  Object.values(lambdas).forEach((lambda: any) => {
    expect(lambda.Properties).toHaveProperty('Timeout');
    expect(lambda.Properties.Timeout).toBeLessThanOrEqual(30);
  });
});

test('All S3 buckets have encryption', () => {
  const buckets = template.findResources('AWS::S3::Bucket');

  Object.values(buckets).forEach((bucket: any) => {
    expect(bucket.Properties).toHaveProperty('BucketEncryption');
  });
});
```

---

## 2. Snapshot Tests

### 基本パターン

```typescript
// test/stacks.snapshot.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/network-stack';

test('NetworkStack matches snapshot', () => {
  const app = new App();
  const stack = new NetworkStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  expect(template.toJSON()).toMatchSnapshot();
});
```

### 運用フロー

```bash
# 初回: スナップショット作成
npm test

# コード変更後: 差分検出
npm test
# → FAIL: スナップショットと一致しない

# 意図的な変更: スナップショット更新
npm test -- -u

# 変更内容確認
git diff test/__snapshots__/
```

### 注意点

- CDKバージョンアップでテンプレートが変わることがある
- スナップショットだけでは正確性を保証できない
- Fine-grained assertionsと併用する

---

## 3. Security Tests（cdk-nag）

### セットアップ

```bash
npm install --save-dev cdk-nag
```

### 基本実装

```typescript
// bin/app.ts
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new App();

// AWS Solutions チェック適用
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

new MyStack(app, 'MyStack');
```

### ルールパック

| パック | 用途 |
|--------|------|
| `AwsSolutionsChecks` | AWS Solutions セキュリティ |
| `HIPAASecurityChecks` | HIPAA準拠 |
| `NIST80053R4Checks` | NIST 800-53 rev 4 |
| `NIST80053R5Checks` | NIST 800-53 rev 5 |
| `PCIDSS321Checks` | PCI DSS 3.2.1 |

### 抑制（正当な理由必須）

```typescript
import { NagSuppressions } from 'cdk-nag';

// スタック全体
NagSuppressions.addStackSuppressions(stack, [
  {
    id: 'AwsSolutions-IAM4',
    reason: 'AWSLambdaBasicExecutionRoleは標準的な管理ポリシー',
  },
]);

// リソース単位
NagSuppressions.addResourceSuppressions(myLambda, [
  {
    id: 'AwsSolutions-L1',
    reason: 'Node.js 20.xは最新のLTS',
  },
]);

// パターンマッチ
NagSuppressions.addResourceSuppressionsByPath(stack, '/MyStack/MyBucket/Resource', [
  {
    id: 'AwsSolutions-S1',
    reason: '内部ログバケットのためアクセスログ不要',
  },
]);
```

### テスト統合

```typescript
// test/security.test.ts
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { MyStack } from '../lib/my-stack';

test('No cdk-nag errors', () => {
  const app = new App();
  Aspects.of(app).add(new AwsSolutionsChecks());

  const stack = new MyStack(app, 'TestStack');

  const errors = Annotations.fromStack(stack).findError(
    '*',
    Match.stringLikeRegexp('AwsSolutions-.*')
  );

  expect(errors).toHaveLength(0);
});

test('No cdk-nag warnings', () => {
  const app = new App();
  Aspects.of(app).add(new AwsSolutionsChecks());

  const stack = new MyStack(app, 'TestStack');

  const warnings = Annotations.fromStack(stack).findWarning(
    '*',
    Match.stringLikeRegexp('AwsSolutions-.*')
  );

  expect(warnings).toHaveLength(0);
});
```

---

## 4. カスタムセキュリティルール

### プロジェクト固有のルール

```typescript
// test/custom-security.test.ts
import { Template } from 'aws-cdk-lib/assertions';

describe('Custom Security Rules', () => {
  test('All Lambda use ARM64 (Graviton)', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');

    Object.values(lambdas).forEach((lambda: any) => {
      const architectures = lambda.Properties.Architectures;
      expect(architectures).toContain('arm64');
    });
  });

  test('All RDS instances are Multi-AZ', () => {
    const rds = template.findResources('AWS::RDS::DBInstance');

    Object.values(rds).forEach((instance: any) => {
      expect(instance.Properties.MultiAZ).toBe(true);
    });
  });

  test('No 0.0.0.0/0 except 80/443', () => {
    const sgs = template.findResources('AWS::EC2::SecurityGroup');

    Object.values(sgs).forEach((sg: any) => {
      const ingress = sg.Properties.SecurityGroupIngress || [];
      ingress.forEach((rule: any) => {
        if (rule.CidrIp === '0.0.0.0/0') {
          expect([80, 443]).toContain(rule.FromPort);
        }
      });
    });
  });

  test('All S3 buckets enforce SSL', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: {
              Bool: { 'aws:SecureTransport': 'false' },
            },
          }),
        ]),
      },
    });
  });
});
```

---

## 5. Integration Tests

### 実環境検証

```typescript
// test/integration/api.integration.test.ts
import { DynamoDB } from '@aws-sdk/client-dynamodb';

describe('API Integration', () => {
  const apiUrl = process.env.API_URL!;
  const tableName = process.env.TABLE_NAME!;

  test('Health check returns 200', async () => {
    const response = await fetch(`${apiUrl}/health`);
    expect(response.status).toBe(200);
  }, 30000);

  test('DynamoDB table is active', async () => {
    const dynamodb = new DynamoDB({ region: 'ap-northeast-1' });
    const result = await dynamodb.describeTable({ TableName: tableName });

    expect(result.Table?.TableStatus).toBe('ACTIVE');
  });
});
```

### CI/CD統合

```yaml
# .github/workflows/integration-test.yml
name: Integration Tests

on:
  pull_request:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Deploy test stack
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx cdk deploy TestStack --require-approval never --outputs-file outputs.json

      - name: Run integration tests
        run: npm run test:integration

      - name: Destroy test stack
        if: always()
        run: npx cdk destroy TestStack --force
```

---

## 6. テスト設定

### package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest test/unit",
    "test:snapshot": "jest test/snapshot",
    "test:security": "jest test/security",
    "test:integration": "jest test/integration --runInBand",
    "test:all": "npm run test:unit && npm run test:snapshot && npm run test:security"
  },
  "jest": {
    "testEnvironment": "node",
    "roots": ["<rootDir>/test"],
    "testMatch": ["**/*.test.ts"],
    "transform": {
      "^.+\\.tsx?$": "ts-jest"
    }
  }
}
```

### ベストプラクティス

```typescript
// 共通セットアップをヘルパー関数に
function createTestStack(): { app: App; stack: Stack; template: Template } {
  const app = new App();
  const stack = new MyStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  return { app, stack, template };
}

// 複数テストで再利用
describe('MyStack', () => {
  let template: Template;

  beforeEach(() => {
    const { template: t } = createTestStack();
    template = t;
  });

  test('...', () => { /* ... */ });
});
```

---

## テスト実行タイミング

| フェーズ | テスト | 目的 |
|---------|--------|------|
| ローカル | Unit, Snapshot | 迅速なフィードバック |
| Commit | Unit, Snapshot, Security | リグレッション防止 |
| PR | + Integration | 実環境動作保証 |

---

## チェックリスト

### Unit Test
- [ ] 全スタックに`Template.fromStack()`テスト
- [ ] 重要リソースに`hasResourceProperties`
- [ ] リソース数に`resourceCountIs`

### Snapshot Test
- [ ] 全スタックにスナップショット
- [ ] 意図的変更時に`npm test -- -u`

### Security Test
- [ ] cdk-nag適用（`AwsSolutionsChecks`）
- [ ] 抑制には必ず理由を記載
- [ ] CI/CDで自動実行

### Integration Test
- [ ] Critical Pathをカバー
- [ ] テスト後のクリーンアップ
