---
name: pr-review
description: GitHub MCP経由でPRの差分を取得し、インタラクティブにコードレビューを実行
argument-hint: '<PR-URL>'
disable-model-invocation: true
---
**コマンドコンテキスト**: GitHub PRのインタラクティブレビュー

## 初回必須タスク

作業開始前に以下のルールファイルを必ず読み込み、厳守してください：
- @.claude/steering/typescript.md - TypeScript固有のルール
- @.claude/steering/architecture/ - アーキテクチャルール
- @.agents/shared/delegation-protocol.md - 委任プロトコル共通定義

## 入力形式

```
/pr-review <PR-URL>
```

**引数**：
- `<PR-URL>` (必須): GitHubのPull Request URL

## レビューバッジ定義

shields.io バッジを使用してコメントの優先度を視覚化：

| バッジ | 意味 | 用途 |
|-------|-----|------|
| ![must](https://img.shields.io/badge/review-must-red.svg) | 必須修正 | バグ、セキュリティ問題、重大な設計問題 |
| ![imo](https://img.shields.io/badge/review-imo-orange.svg) | 個人的意見 | より良い実装案の提案 |
| ![ask](https://img.shields.io/badge/review-ask-blue.svg) | 質問 | 意図の確認、設計判断の理由 |
| ![nits](https://img.shields.io/badge/review-nits-green.svg) | 細かい指摘 | フォーマット、命名、軽微な改善 |
| ![suggestion](https://img.shields.io/badge/review-suggestion-blueviolet.svg) | 提案 | 将来的な改善、リファクタリング案 |

---

## 実行フロー（重要：必ずこの順序で実行）

### Phase 1: PR情報の取得

#### Step 1.1: PR URLの解析
PR URLから以下を抽出：
- `owner`: リポジトリオーナー
- `repo`: リポジトリ名
- `pull_number`: PR番号

例: `https://github.com/cloudpayment/debt-collection-robo/pull/24`
→ owner=cloudpayment, repo=debt-collection-robo, pull_number=24

#### Step 1.2: GitHub MCPでPR情報を取得

```
mcp__github__get_pull_request(owner, repo, pull_number)
mcp__github__get_pull_request_files(owner, repo, pull_number)
```

#### Step 1.2.1: 実際のコード差分を取得（必須）

**重要**: `get_pull_request_files`はファイル一覧のみ。実際のコード差分を見るには以下を実行：

```bash
gh pr diff {pull_number} --repo {owner}/{repo}
```

または、各変更ファイルの内容を直接読み込む：
```
Read: 変更されたファイルパス
```

**コード差分なしでのレビューは禁止** - 必ず実際のコードを確認してからレビューを開始すること。

#### Step 1.3: 設計書の確認
PRタイトル/ブランチ名から `{STORY_ID}` を抽出し、設計書を参照：
```
specs/stories/{STORY_ID}-*/design.md
```

#### Step 1.4: PRサマリーの提示

以下の形式でサマリーを表示し、**ユーザーに確認を求める**：

```
📋 PR #{番号}: {タイトル}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 変更: {ファイル数} files (+{追加行}, -{削除行})
👤 作成者: @{作成者}
🎯 ベース: {ベースブランチ} ← {ヘッドブランチ}
📄 設計書: {設計書パス or "なし"}

📖 概要:
{PRの目的を1-3文で要約}

📁 変更ファイル:
  - {ファイル1}
  - {ファイル2}
  ...

この理解で正しいですか？レビューを開始してよろしいですか？
```

**AskUserQuestionツールで確認**：
- 「はい、開始」→ Phase 2へ
- 「いいえ、修正」→ 修正点を聞いて再度確認

---

### Phase 2: インタラクティブレビュー（最重要）

**このフェーズが対話的レビューの核心。必ず1コメントずつユーザーに確認する。**

⚠️ **絶対ルール**:
- コード差分を読まずにレビューを完了してはならない
- コメント0件でレビューを完了してはならない
- 各プロダクションコードファイルに最低1つのコメントを生成する

#### Step 2.1: 変更ファイルを優先度順にソート

1. **プロダクションコード** (src/, lib/)
2. **テストコード** (*.test.ts, *.spec.ts)
3. **設定ファイル** (package.json, tsconfig.json)
4. **その他** (README, docker-compose)

#### Step 2.2: 各ファイルのレビュー（必須コメント生成）

**重要ルール**: 各プロダクションコードファイルに対して、最低1つのコメントを生成すること。

各ファイルについて：

1. **差分を論理的なチャンクに分割**
   - 関数単位、クラス単位、または意味のあるまとまり

2. **レビュー観点チェックリストで網羅的に確認**
   - [ ] バグ・論理エラー
   - [ ] セキュリティ問題
   - [ ] 型安全性
   - [ ] パフォーマンス
   - [ ] エラーハンドリング
   - [ ] 命名規則・コーディング規約
   - [ ] テストの妥当性

3. **各チャンクを分析し、レビューコメントを生成**
   - 問題点、改善提案、質問を特定
   - 適切なバッジを選択
   - **問題がない場合も「良い点」としてコメント可能**（suggestion バッジ）

4. **生成したコメントを1つずつユーザーに提示**

**コメント0件は許容しない**: 変更があるファイルには必ず何らかのフィードバックを提供する。問題がなければ「良い実装」としてポジティブなコメントを生成する。

#### Step 2.3: 各コメントの対話的確認（必須）

**AskUserQuestionツールを使用して、各コメントについてユーザーに確認**：

**⚠️ 行番号は必須**: 各コメントには必ず対象行番号を記録する。行番号がないとインラインコメントとして投稿できない。

```
[{現在のコメント番号}/{総コメント数}] {ファイルパス}:{行番号}  ← 行番号必須！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
![{バッジ}](https://img.shields.io/badge/review-{バッジ}-{色}.svg)

{コメントタイトル}

📍 対象コード（L{行番号}）:
```{言語}
{該当行のコード}
```

{詳細説明}

{改善案やコード例があれば提示}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**内部で保持すべき情報**（投稿時に使用）:
- `path`: ファイルパス（例: `src/services/auth.ts`）
- `line`: 行番号（例: `42`）← **必須**
- `body`: コメント本文

**AskUserQuestionのオプション**：

```typescript
AskUserQuestion({
  questions: [{
    question: "このコメントをどうしますか？",
    header: "アクション",
    options: [
      { label: "✅ 投稿する", description: "このままGitHubに投稿" },
      { label: "✏️ 編集して投稿", description: "内容を修正してから投稿" },
      { label: "⏭️ スキップ", description: "このコメントは投稿しない" },
      { label: "🏷️ バッジ変更", description: "優先度を変更" }
    ],
    multiSelect: false
  }]
})
```

**ユーザーの回答に応じて**：
- **投稿する** → 承認リストに追加、次のコメントへ
- **編集して投稿** → 編集内容を聞き、修正後に承認リストへ追加
- **スキップ** → 次のコメントへ
- **バッジ変更** → 新しいバッジを選択後、再度確認

#### Step 2.4: 全ファイル完了まで繰り返し

すべてのファイルのレビューが完了するまで Step 2.2-2.3 を繰り返す。

---

### Phase 3: レビュー投稿

#### Step 3.1: 投稿前の最終確認

承認されたコメント一覧を表示：

```
📊 投稿予定のコメント
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
must: {数}件
imo: {数}件
ask: {数}件
nits: {数}件
suggestion: {数}件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
スキップ: {数}件

これらのコメントをGitHubに投稿しますか？
```

**AskUserQuestionで最終確認**：
- 「投稿する」→ Step 3.2へ
- 「キャンセル」→ 終了
- 「コメントを確認」→ 個別に再確認

#### Step 3.2: GitHub MCPでレビュー投稿

**⚠️ 重要: インラインコメント vs 全体コメントの違い**

| 種類 | 用途 | 指定方法 |
|------|------|----------|
| **インラインコメント** | 特定のコード行への指摘 | `comments`配列に`path`と`line`を**必ず**指定 |
| **全体コメント** | PRサマリーのみ | `body`のみ指定、`comments`は空配列 |

**インラインコメントを投稿するには`comments`配列が必須**。`comments`が空や未指定だと全体コメントになる。

```typescript
mcp__github__create_pull_request_review({
  owner: "{owner}",
  repo: "{repo}",
  pull_number: {pull_number},
  event: "COMMENT",
  body: "## 🤖 AI Code Review\n\n{サマリー}",  // 全体サマリー（任意）
  comments: [  // ⚠️ 必須: 特定行へのコメントはここに指定
    {
      path: "src/example.ts",           // リポジトリルートからの相対パス
      line: 42,                          // ⚠️ 必須: 変更後ファイルの行番号（差分の「+」側）
      body: "![must](...)\n\n{コメント}"
    },
    // ... 他のコメント
  ]
})
```

**`line`パラメータの注意点**:
- `line`は**変更後のファイル**における行番号（差分の`+`側の行番号）
- `gh pr diff`の出力で`+`の行を確認し、その行番号を指定
- 削除行（`-`側）にはコメントできない。削除に対するコメントは追加行または近くの行に投稿

**チェックリスト（投稿前に確認）**:
- [ ] `comments`配列に各コメントが含まれている
- [ ] 各コメントに`path`と`line`が指定されている
- [ ] `line`は変更後ファイルの行番号になっている

#### Step 3.3: 完了サマリー

```
✅ レビュー完了
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
投稿: {数}件 (must: {数}, imo: {数}, ask: {数}, nits: {数}, suggestion: {数})
スキップ: {数}件

📝 全体所見:
{PRの良い点と改善点のサマリー}
```

---

## レビュー観点

### デフォルト観点
- **バグ・論理エラー**: 明らかなバグ、エッジケース漏れ、null/undefined
- **セキュリティ**: インジェクション、認証/認可、機密情報露出
- **型安全性**: any型使用、型ガード不足、型アサーション乱用
- **パフォーマンス**: N+1クエリ、不要な計算、メモリリーク
- **エラーハンドリング**: 握りつぶし、不適切なフォールバック
- **テスト**: カバレッジ、テストの質、モックの適切性

### プロジェクト固有観点（ルールファイルから）
- @.claude/steering/typescript.md の規約違反
- naming-convention.md の命名規則違反
- アーキテクチャパターンからの逸脱

### 設計書がある場合の追加観点
- 受入条件（AC）の充足
- インターフェース定義との一致
- データフローの正確性

---

## コメントフォーマット

```markdown
![{バッジ}](https://img.shields.io/badge/review-{バッジ}-{色}.svg)

**{問題の要約}**

{詳細説明}

{改善案やコード例があれば}
```

バッジURLマッピング：
- must: `https://img.shields.io/badge/review-must-red.svg`
- imo: `https://img.shields.io/badge/review-imo-orange.svg`
- ask: `https://img.shields.io/badge/review-ask-blue.svg`
- nits: `https://img.shields.io/badge/review-nits-green.svg`
- suggestion: `https://img.shields.io/badge/review-suggestion-blueviolet.svg`

---

## エラーハンドリング

| エラー | 対処 |
|-------|-----|
| GitHub MCP認証エラー | @.claude/docs/mcp-setup.md を案内し、GITHUB_TOKEN設定を確認 |
| PR URLが無効 | URLフォーマットを確認し再入力を促す |
| アクセス権限なし | トークンのスコープ（repo権限）を確認 |
| 差分取得失敗 | PRが存在するか、マージ済みでないか確認 |

---

## 前提条件

- GitHub MCP Server が設定済み（GITHUB_TOKEN環境変数）
- 対象リポジトリへのアクセス権限（repo スコープ）
- 設定方法: @.claude/docs/mcp-setup.md

---

## 重要な注意事項

1. **必ずコメントを生成する**: コード差分を確認し、各ファイルに最低1つのコメントを生成する
2. **対話的であること**: 各コメントについて必ずユーザーに確認を取る
3. **押し付けない**: ユーザーがスキップを選んだら尊重する
4. **編集を受け入れる**: ユーザーの修正提案を反映する
5. **バッジの適切な使用**: 重要度を正確に反映する
6. **コンテキストを考慮**: 設計書やプロジェクトルールを踏まえてレビュー
7. **ポジティブフィードバックも含める**: 問題がなくても良い実装には`suggestion`バッジで称賛コメントを追加
