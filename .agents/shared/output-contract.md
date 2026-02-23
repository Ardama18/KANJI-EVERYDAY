# Structured Output Contract（子Skill共通）

子Skill（専門ワーカー）が親Skill（オーケストレーター）に返す構造化レスポンスの共通契約。
各子Skillはこのファイルを読み込み、最終レスポンスを以下の形式で返す。

## 基本レスポンス形式

`delegate_run` 経由または `Task` ツール経由で呼び出された場合、最終レスポンスの末尾に以下のJSON構造を含める:

```json
{
  "status": "completed",
  "summary": "要件分析完了。中規模（4ファイル）と判定。Design Doc必須、ADR条件付き。",
  "deliverables": [
    "specs/stories/TC-S-0001-xxx/requirements.md"
  ],
  "open_questions": [
    "認証方式（JWT vs Session）の選択が必要"
  ],
  "next_actions": [
    "technical-designerでDesign Doc作成"
  ]
}
```

## フィールド定義

### 必須フィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| `status` | `"completed"` / `"escalation_needed"` / `"blocked"` | 実行結果ステータス |
| `summary` | string | 実行結果の要約（1-3行、オーケストレーターが次のアクションを判断できる内容） |
| `deliverables` | string[] | 生成・変更したファイルの絶対パスまたはリポジトリルート相対パス |

### 任意フィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| `open_questions` | string[] | ユーザー確認が必要な未解決事項 |
| `next_actions` | string[] | 推奨される次のアクション（オーケストレーターへの提案） |

## Status値の使い分け

| status | 使用条件 | オーケストレーターの想定アクション |
|--------|---------|-------------------------------|
| `completed` | タスクが正常完了し、成果物が生成された | 次のステップに進む |
| `escalation_needed` | 判断が必要な選択肢がある、または設計乖離を検出 | ユーザーに選択肢を提示して判断を仰ぐ |
| `blocked` | 前提条件未充足、ファイル不在、権限エラー等で実行不能 | ブロック原因を報告し、ユーザーに解決を依頼 |

## 子Skill別の追加フィールド

各子Skillは基本フィールドに加え、以下の専用フィールドを返す:

### task-executor

```json
{
  "status": "completed",
  "summary": "...",
  "deliverables": ["..."],
  "changeSummary": "feat: Add user registration API endpoint",
  "filesModified": ["backend/src/modules/auth/auth.controller.ts"],
  "testsAdded": ["backend/tests/unit/auth/auth.controller.test.ts"],
  "checkboxesUpdated": ["Step 1: API endpoint", "Step 2: Validation"]
}
```

### requirement-analyzer

```json
{
  "status": "completed",
  "summary": "...",
  "deliverables": ["..."],
  "scale": "medium",
  "estimatedFiles": 4,
  "requiredDocuments": {
    "requirements": "update",
    "adr": "conditional",
    "designDoc": "required",
    "workPlan": "required"
  }
}
```

### document-reviewer

```json
{
  "status": "completed",
  "summary": "...",
  "deliverables": ["..."],
  "reviewsPerformed": ["requirements.md", "design.md"],
  "issues": [],
  "recommendations": ["AC #3 の測定基準を具体化"],
  "approvalReady": true
}
```

### code-reviewer

```json
{
  "status": "completed",
  "summary": "...",
  "deliverables": ["..."],
  "acCoverage": {
    "total": 5,
    "covered": 5,
    "missing": []
  },
  "qualityScore": "pass"
}
```

## レスポンス埋め込み位置

構造化レスポンスは最終メッセージの **末尾** に以下の形式で埋め込む:

```markdown
（通常のテキスト出力）

---
## Structured Response
```json
{ ... }
```
```

オーケストレーターはこのJSON部分をパースして次のアクションを決定する。
