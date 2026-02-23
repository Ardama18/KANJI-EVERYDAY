---
name: pr-fix
description: PRレビューで指摘されたコメントに対話的に対応し、コード修正・返信を実行
argument-hint: '[PR-URL]'
disable-model-invocation: true
---
**コマンドコンテキスト**: PRレビュー指摘への対話的対応

## 初回必須タスク

作業開始前に以下のルールファイルを必ず読み込み、厳守してください：
- @.claude/steering/typescript.md - TypeScript固有のルール
- @.claude/steering/architecture/ - アーキテクチャルール
- @.agents/shared/delegation-protocol.md - 委任プロトコル共通定義

## 入力形式

```
/pr-fix [PR-URL]
```

**引数**：
- `[PR-URL]` (任意): GitHubのPull Request URL
  - 省略時: カレントブランチに関連付けられたPRを自動検出

## 対応アクション定義

| アクション | 意味 | 実行内容 |
|-----------|-----|---------|
| 🔧 修正する | コード修正 | 指摘に基づいてコードを修正 |
| 💬 返信する | コメント返信 | 説明・質問への回答をGitHubに投稿 |
| 🤝 同意して修正 | 同意+修正 | 同意の返信後、コードを修正 |
| ❌ 対応しない | 理由付きスキップ | 対応しない理由を返信 |
| ⏭️ スキップ | 無言スキップ | このコメントは後で対応 |
| 🔍 詳細を確認 | コンテキスト確認 | 周辺コードを読んで詳細把握 |

---

## 実行フロー（重要：必ずこの順序で実行）

### Phase 1: PR情報の取得

#### Step 1.1: PR URLの解析または自動検出

**PR URLが指定された場合**:
PR URLから以下を抽出：
- `owner`: リポジトリオーナー
- `repo`: リポジトリ名
- `pull_number`: PR番号

**PR URLが省略された場合**:
```bash
# カレントブランチ名を取得
git branch --show-current

# そのブランチに関連するPRを検索
gh pr list --head <branch-name> --json number,url --limit 1
```

#### Step 1.2: GitHub MCPでレビューコメントを取得

```
mcp__github__get_pull_request(owner, repo, pull_number)
mcp__github__get_pull_request_reviews(owner, repo, pull_number)
mcp__github__get_pull_request_comments(owner, repo, pull_number)
```

#### Step 1.3: 未解決コメントのフィルタリング

以下の条件でフィルタリング：
- 解決済み（resolved）でないコメント
- 自分自身のコメントは除外
- outdated でないコメント（最新コミットに対するもの）

#### Step 1.4: コメントサマリーの提示

以下の形式でサマリーを表示し、**ユーザーに確認を求める**：

```
📋 PR #{番号}: {タイトル}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 未解決コメント: {件数}件
👤 レビュアー: @{レビュアー1}, @{レビュアー2}...

📊 コメント内訳:
  - must: {数}件
  - imo: {数}件
  - ask: {数}件
  - nits: {数}件
  - suggestion: {数}件
  - その他: {数}件

対応を開始しますか？
```

**AskUserQuestionツールで確認**：
- 「はい、開始」→ Phase 2へ
- 「いいえ」→ 終了

---

### Phase 2: 対話的コメント対応（最重要）

**このフェーズが対話的対応の核心。必ず1コメントずつユーザーに確認する。**

⚠️ **絶対ルール**:
- **返信内容は投稿前に必ずユーザー確認を取る** - 勝手に返信しない
- **修正案は適用前に必ずユーザー確認を取る** - 勝手に修正しない
- **`comment_id`を正しく使用してスレッド返信する** - 全体コメントにしない

#### Step 2.1: コメントを優先度順にソート

1. **must** (必須修正) - 最優先
2. **imo** (意見)
3. **ask** (質問) - 回答が必要
4. **nits** (細かい指摘)
5. **suggestion** (提案)
6. **その他**

#### Step 2.2: 各コメントの表示と対応選択

各コメントについて：

**⚠️ 重要: `comment_id`を必ず記録する**（スレッド返信に必須）

```
[{現在の番号}/{総数}] {ファイルパス}:{行番号}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆔 Comment ID: {comment_id}  ← 返信時に必須！
👤 @{レビュアー名} ({バッジ種別})

{コメント本文}

📄 該当コード:
```{言語}
{該当行のコード（前後3行含む）}
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**内部で保持すべき情報**:
- `comment_id`: レビューコメントのID（`mcp__github__get_pull_request_comments`の結果から取得）
- `path`: ファイルパス
- `line`: 行番号

**AskUserQuestionで対応方法を確認**：

```typescript
AskUserQuestion({
  questions: [{
    question: "このコメントにどう対応しますか？",
    header: "アクション",
    options: [
      { label: "🔧 修正する", description: "指摘に基づいてコードを修正" },
      { label: "💬 返信する", description: "説明や質問への回答を投稿" },
      { label: "🤝 同意して修正", description: "同意の返信後、コードを修正" },
      { label: "❌ 対応しない", description: "理由を付けてスキップ" }
    ],
    multiSelect: false
  }]
})
```

#### Step 2.3: 各アクションの実行

**⚠️ 絶対ルール: 返信は投稿前に必ずユーザー確認を取る**

スキップ以外のすべてのアクションで：
1. 返信内容を生成
2. **AskUserQuestionで返信内容をユーザーに確認**
3. 承認後に投稿

**🔧 修正する**:
1. 指摘内容を分析
2. 修正案を提示 → **AskUserQuestionで確認**
3. 承認後、コードを修正（Edit/MultiEdit ツール使用）
4. 返信内容を生成して提示 → **AskUserQuestionで確認**
5. 承認後、**該当コメントに返信を投稿**（Step 2.3.2参照）
6. 修正完了を記録

**🤝 同意して修正**:
1. 指摘内容を分析
2. 修正案を提示 → **AskUserQuestionで確認**
3. 承認後、コードを修正（Edit/MultiEdit ツール使用）
4. 返信内容を生成して提示 → **AskUserQuestionで確認**
5. 承認後、**該当コメントに返信を投稿**（Step 2.3.2参照）
6. 修正完了を記録

**💬 返信する**:
1. 返信内容を生成して提示 → **AskUserQuestionで確認**
2. 承認後、**該当コメントに返信を投稿**（Step 2.3.2参照）

**❌ 対応しない**:
1. 対応しない理由の返信内容を生成して提示 → **AskUserQuestionで確認**
2. 承認後、**該当コメントに返信を投稿**（Step 2.3.2参照）

**⏭️ スキップ**:
1. スキップリストに追加
2. 次のコメントへ（返信なし）

#### Step 2.3.1: 返信内容のユーザー確認（必須）

**返信投稿前に必ず以下の形式で確認を取る**：

```
📤 返信プレビュー
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
投稿先: @{レビュアー名} のコメント（ID: {comment_id}）

{返信内容}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

この返信を投稿しますか？
```

**AskUserQuestionで確認**：
```typescript
AskUserQuestion({
  questions: [{
    question: "この返信を投稿しますか？",
    header: "返信確認",
    options: [
      { label: "✅ 投稿する", description: "この内容でGitHubに投稿" },
      { label: "✏️ 編集する", description: "返信内容を修正" },
      { label: "❌ キャンセル", description: "返信しない" }
    ],
    multiSelect: false
  }]
})
```

- **投稿する** → Step 2.3.2へ
- **編集する** → 新しい返信内容を入力してもらい、再度確認
- **キャンセル** → 返信せずに次のコメントへ

#### Step 2.3.2: レビューコメントへの返信投稿（必須）

**⚠️ 重要: 全体コメントではなくスレッド返信として投稿する**

各コメントへの返信は、`gh api` を使用してスレッド形式で投稿する:

```bash
gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies -f body="{返信内容}"
```

**パラメータ**:
- `{owner}`: リポジトリオーナー
- `{repo}`: リポジトリ名
- `{pull_number}`: PR番号
- `{comment_id}`: 返信先のレビューコメントID（`mcp__github__get_pull_request_comments` で取得）

**注意点**:
- この方法により `in_reply_to_id` が設定され、元のコメントへのスレッド返信として正しく表示される
- `mcp__github__create_pull_request_review` は新規コメント作成用であり、スレッド返信には使用しない
- 複数のコメントに返信する場合は、各コメントに対して個別に `gh api` を実行する

#### Step 2.4: 修正案の提示（修正系アクション時）

修正を行う場合、必ず事前に提示：

```
📝 修正案
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ファイル: {ファイルパス}

変更前:
```{言語}
{現在のコード}
```

変更後:
```{言語}
{修正後のコード}
```

この修正を適用しますか？
```

**AskUserQuestionで確認**：
- 「適用する」→ コード修正実行
- 「修正案を変更」→ 新しい修正案を聞く
- 「キャンセル」→ このコメントをスキップ

#### Step 2.5: 全コメント完了まで繰り返し

すべてのコメントの対応が完了するまで Step 2.2-2.4 を繰り返す。

---

### Phase 3: 変更のコミットとプッシュ

#### Step 3.1: 変更サマリーの表示

```
📊 対応サマリー
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 修正完了: {数}件
💬 返信済み: {数}件
❌ 対応しない: {数}件
⏭️ スキップ: {数}件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

変更されたファイル:
  - {ファイル1}
  - {ファイル2}
  ...
```

#### Step 3.2: コミットとプッシュの確認

**AskUserQuestionで確認**：

```typescript
AskUserQuestion({
  questions: [{
    question: "変更をコミット・プッシュしますか？",
    header: "コミット",
    options: [
      { label: "コミット&プッシュ", description: "変更をコミットしてリモートにプッシュ" },
      { label: "コミットのみ", description: "コミットするがプッシュしない" },
      { label: "後で手動で", description: "コミットせずに終了" }
    ],
    multiSelect: false
  }]
})
```

#### Step 3.3: コミット実行

コミットメッセージは自動生成：

```
fix: address PR review comments

- {修正内容1}
- {修正内容2}
...

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

#### Step 3.4: 完了レポート

```
✅ 対応完了
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
修正: {数}件
返信: {数}件
スキップ: {数}件

{コミットした場合}
📦 コミット: {コミットハッシュ}
🚀 プッシュ: {ブランチ名}

残りの未対応コメント: {数}件
```

---

## バッジ検出ロジック

レビューコメントからバッジを検出：

```typescript
function detectBadge(comment: string): BadgeType {
  if (comment.includes('review-must') || comment.includes('badge/review-must')) return 'must'
  if (comment.includes('review-imo') || comment.includes('badge/review-imo')) return 'imo'
  if (comment.includes('review-ask') || comment.includes('badge/review-ask')) return 'ask'
  if (comment.includes('review-nits') || comment.includes('badge/review-nits')) return 'nits'
  if (comment.includes('review-suggestion') || comment.includes('badge/review-suggestion')) return 'suggestion'
  return 'other'
}
```

---

## コメント返信フォーマット

### 修正完了時
```markdown
✅ 修正しました

{修正内容の簡潔な説明}
```

### 同意して修正時
```markdown
👍 ご指摘ありがとうございます。修正しました。

{修正内容の簡潔な説明}
```

### 質問への回答時
```markdown
{回答内容}
```

### 対応しない時
```markdown
🤔 検討しましたが、以下の理由で現状維持とさせてください：

{理由}

ご意見があればお聞かせください。
```

---

## エラーハンドリング

| エラー | 対処 |
|-------|-----|
| GitHub MCP認証エラー | @.claude/docs/mcp-setup.md を案内 |
| PR URLが無効 | URLフォーマットを確認し再入力を促す |
| PRが見つからない | カレントブランチ名を確認、手動でURL入力を促す |
| レビューコメントなし | 「未解決のコメントはありません」と表示して終了 |
| ファイル編集失敗 | エラー内容を表示、手動修正を促す |

---

## 前提条件

- GitHub MCP Server が設定済み（GITHUB_MCP_TOKEN環境変数）
- 対象リポジトリへのアクセス権限（repo スコープ）
- ローカルリポジトリがクリーンな状態（uncommitted changes なし推奨）
- 設定方法: @.claude/docs/mcp-setup.md

---

## 重要な注意事項

1. **対話的であること**: 各コメントについて必ずユーザーに確認を取る
2. **返信前に必ず確認**: 返信内容は投稿前にユーザー承認を得る（勝手に返信しない）
3. **修正前に確認**: コード修正は必ず事前に修正案を提示
4. **スレッド返信**: 返信は`gh api`で`comment_id`を指定してスレッド返信する（全体コメントにしない）
5. **返信必須**: スキップ以外のすべての対応で、該当コメントに返信を投稿する
6. **ルール遵守**: プロジェクトのコーディング規約に従った修正
7. **コミット粒度**: レビュー対応は1コミットにまとめる（推奨）
8. **返信の丁寧さ**: レビュアーへの敬意を持った返信

### 禁止事項

- ❌ ユーザー確認なしでの返信投稿
- ❌ ユーザー確認なしでのコード修正
- ❌ `mcp__github__create_pull_request_review`でのスレッド返信（全体コメントになる）
- ❌ `comment_id`なしでの返信投稿

---

## 使用例

### 基本的な使用
```
/pr-fix https://github.com/cloudpayment/debt-collection-robo/pull/49
```

### カレントブランチのPRを対応
```
/pr-fix
```

ARGUMENTS: $ARGUMENTS
