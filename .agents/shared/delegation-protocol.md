# Sub-agent Delegation Protocol（親Skill共通）

親Skill（オーケストレーター）が子Skill（専門ワーカー）を委任する際の共通プロトコル定義。
各親Skillはこのファイルを読み込み、定義に従って委任を実行する。

## Safety Rules

1. **再帰防止**: delegate_run 内部から delegate_* ツールを呼び出してはならない
2. **sandbox選択基準**:
   - `read-only`: 分析・レビュー系ステップ（requirement-analyzer, code-reviewer, document-reviewer）
   - `workspace-write`: 生成・実装系ステップ（それ以外すべて）
3. **cwd**: 常にリポジトリルートの絶対パスを指定
4. **skills_mode**: `explicit` を使用し、呼び出す子Skillを明示指定
5. **再帰呼び出し禁止**: 子Skillが他の子Skillを直接呼び出すことは禁止。複数Skillの連携はオーケストレーター（親Skill）が管理

## Delegation Template

### Claude Code Task ツール方式（現行）

```yaml
Tool: Task
subagent_type: "<child-skill-name>"
description: "<3-5語の要約>"
prompt: |
  <具体的な指示>
  入力:
  - 前ステップの成果物パスまたは内容
  - ユーザー追加指示
```

### Codex delegate_run MCP方式（将来）

```json
{
  "task": "<具体的な指示（前ステップの成果物を埋め込む）>",
  "cwd": "/absolute/path/to/repo",
  "sandbox": "workspace-write | read-only",
  "skills_mode": "explicit",
  "skills": ["<child-skill-name>"],
  "max_skills": 6,
  "include_repo_skills": true,
  "include_global_skills": false
}
```

## Result Handling Contract

各子Skill実行後、オーケストレーターは以下のフィールドを取得・利用する:

| フィールド | 型 | 説明 | 必須 |
|-----------|------|------|------|
| `status` | string | `completed` / `escalation_needed` / `blocked` | Yes |
| `summary` | string | 実行結果の要約（1-3行） | Yes |
| `deliverables` | string[] | 生成・変更したファイルパスのリスト | Yes |
| `open_questions` | string[] | 未解決の判断事項（ユーザー確認が必要なもの） | No |
| `next_actions` | string[] | 推奨される次のアクション | No |

### Codex追加フィールド（delegate_run方式のみ）

| フィールド | 型 | 説明 |
|-----------|------|------|
| `run_dir` | string | デバッグ用ディレクトリ |
| `subagent_thread_id` | string | resume用スレッドID |

## Status-driven Orchestration

オーケストレーターは子Skillの `status` フィールドのみで次のアクションを決定する:

```
status判定:
  ├─ "completed"           → 成果物を次ステップに伝達 → 次の子Skill呼び出し
  ├─ "escalation_needed"   → ユーザーにエスカレーション内容を提示 → 判断待ち
  └─ "blocked"             → ブロック原因を報告 → ユーザー指示待ち
```

## Resume Rule

フォローアップが必要な場合:
- **Claude Code**: 同じ `subagent_type` で追加コンテキストを含む prompt で再呼び出し
- **Codex**: `delegate_resume` を `subagent_thread_id` で呼び出し

## Information Relay Contract（情報伝達ルール）

オーケストレーターは前工程の成果物を次の子Skillに**必ず**伝達する:

1. **ファイルパス伝達**: `deliverables` のパスを次の子Skillの prompt に含める
2. **コンテキスト伝達**: `summary` から次のステップに必要な情報を抽出して含める
3. **ユーザー追加指示**: 元のユーザー指示を全ステップに伝播させる
4. **acceptance-test-generator → work-planner 特別ルール**:
   - 統合テストファイルパスとE2Eテストファイルパスを明示伝達
   - 「統合テストは実装と同時、E2Eは全実装後」の指示を含める

## Sandbox Reference（子Skill別）

| 子Skill | sandbox | 理由 |
|---------|---------|------|
| requirement-analyzer | read-only | 分析のみ、ファイル生成なし |
| prd-creator | workspace-write | requirements.md生成 |
| figma-design-importer | workspace-write | キャッシュファイル生成 |
| technical-designer | workspace-write | ADR/Design Doc生成 |
| acceptance-test-generator | workspace-write | テストスケルトン生成 |
| document-reviewer | read-only | レビューのみ |
| work-planner | workspace-write | plan.md生成 |
| task-decomposer | workspace-write | タスクファイル生成 |
| task-executor | workspace-write | 実装コード生成 |
| quality-fixer | workspace-write | コード修正 |
| code-reviewer | read-only | レビューのみ |
| infrastructure-designer | workspace-write | インフラ設計Doc生成 |
| cdk-implementer | workspace-write | CDKコード生成 |
