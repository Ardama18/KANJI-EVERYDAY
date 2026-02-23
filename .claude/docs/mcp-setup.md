# MCP Server セットアップガイド

このプロジェクトでは、Claude CodeのMCP (Model Context Protocol) Serverを使用して外部サービスと連携しています。

## マルチクライアント設定（Claude Code / Cursor）

### 設定ファイル構成

| ファイル | 対象クライアント | 形式 |
|----------|------------------|------|
| `.mcp.json` | Claude Code（正本） | `mcpServers` |
| `.cursor/mcp.json` | Cursor | `mcpServers` |

### 設定の同期

`.mcp.json`を編集後、以下を実行して他の設定ファイルを同期：

```bash
# jqが必要（未インストールの場合: brew install jq）
./scripts/sync-mcp.sh
```

### 動作確認

- **Claude Code**: `/mcp` コマンドでサーバー一覧表示
- **Cursor**: Settings → Features → MCP で確認

---

## 設定済みMCP Server一覧

| Server | 用途 | 認証方式 |
|--------|-----|---------|
| Figma | デザインデータ取得 | ブラウザOAuth + Personal Access Token |
| Notion | ドキュメント連携 | ブラウザOAuth |
| AWS MCP | AWSリソース操作 | aws-vault |
| GitHub | PRレビュー、Issue管理 | Personal Access Token |
| Google Sheets | スプレッドシート読み書き | GCP Service Account |

---

## Figma REST API Token セットアップ

Figma MCPサーバーはブラウザOAuthで認証しますが、スクリーンショット取得（Figma REST API）には別途Personal Access Tokenが必要です。

### Step 1: Figma Personal Access Token の作成

1. Figma にログイン
2. https://www.figma.com/developers/api#access-tokens にアクセス
3. 「Generate new token」をクリック
4. 以下を設定:
   - **Description**: `Claude Code` など識別しやすい名前
   - **Expiration**: 適切な期間
   - **Scopes**: `File content` (Read only)
5. 「Generate token」をクリック
6. 表示されたトークン（`figd_xxxx...`）をコピー

> **注意**: トークンは一度しか表示されません。必ずコピーしてください。

### Step 2: 環境変数の設定

```bash
# ~/.zshrc に追加
echo 'export FIGMA_API_KEY="figd_xxxxxxxxxxxxxxxxxx"' >> ~/.zshrc

# 設定を反映
source ~/.zshrc
```

### Step 3: 設定の確認

```bash
# 環境変数が設定されているか確認
echo $FIGMA_API_KEY
# → figd_xxxx... と表示されればOK

# Claude Code を再起動
```

### Step 4: 動作確認

Claude Code で figma-design-importer エージェントを使用し、スクリーンショット取得（Phase 6）が成功することを確認。

---

## GitHub MCP Server セットアップ

`/pr-review` コマンドを使用するために必要な設定です。

### Step 1: GitHub Personal Access Token の作成

1. GitHub にログイン
2. https://github.com/settings/tokens にアクセス
3. 「Generate new token」→「Generate new token (classic)」を選択
4. 以下を設定:
   - **Note**: `Claude Code MCP` など識別しやすい名前
   - **Expiration**: 適切な期間（推奨: 90 days）
   - **Select scopes**: 以下にチェック
     - `repo` (Full control of private repositories)
     - `read:org` (Read org membership) ※組織リポジトリの場合
5. 「Generate token」をクリック
6. 表示されたトークン（`ghp_xxxx...`）をコピー

> **注意**: トークンは一度しか表示されません。必ずコピーしてください。

### Step 2: 環境変数の設定

シェルの設定ファイルに環境変数を追加します。

#### macOS / Linux (zsh の場合)

```bash
# ~/.zshrc に追加
echo 'export GITHUB_MCP_TOKEN="ghp_xxxxxxxxxxxxxxxxxx"' >> ~/.zshrc

# 設定を反映
source ~/.zshrc
```

#### Windows (PowerShell)

```powershell
# ユーザー環境変数として設定
[Environment]::SetEnvironmentVariable("GITHUB_MCP_TOKEN", "ghp_xxxxxxxxxxxxxxxxxx", "User")

# 現在のセッションにも反映
$env:GITHUB_MCP_TOKEN = "ghp_xxxxxxxxxxxxxxxxxx"
```

### Step 3: 設定の確認

```bash
# 環境変数が設定されているか確認
echo $GITHUB_MCP_TOKEN
# → ghp_xxxx... と表示されればOK

# Claude Code を再起動
# (既存のセッションを終了し、新しいターミナルで起動)
```

### Step 4: 動作確認

Claude Code で以下を実行:

```
/pr-review https://github.com/your-org/your-repo/pull/123
```

---

## Google Sheets MCP Server セットアップ

`/generate-uat` コマンドを使用するために必要な設定です。UAT項目をGoogle Sheetsに書き出します。

### Step 1: GCP Service Account の作成

1. [Google Cloud Console](https://console.cloud.google.com/) にログイン
2. プロジェクトを選択（または新規作成）
3. 「API とサービス」→「有効な API とサービス」で以下を有効化:
   - **Google Sheets API**
   - **Google Drive API**
4. 「IAM と管理」→「サービスアカウント」に移動
5. 「サービスアカウントを作成」をクリック
6. 以下を設定:
   - **サービスアカウント名**: `claude-code-sheets` など識別しやすい名前
   - **ロール**: 不要（Drive共有で権限管理するため）
7. 作成完了後、サービスアカウントの詳細画面を開く
8. 「キー」タブ →「鍵を追加」→「新しい鍵を作成」→ JSON 形式
9. ダウンロードしたJSONファイルを安全な場所に保存:
   ```bash
   mkdir -p ~/.config/gcloud
   mv ~/Downloads/your-project-xxxxx.json ~/.config/gcloud/claude-code-sheets-sa.json
   ```

> **注意**: JSONキーファイルには秘密鍵が含まれます。Gitにコミットしないでください。

### Step 2: Google Drive フォルダの共有設定

1. Google Drive でスプレッドシート保存先のフォルダを作成（または既存フォルダを使用）
2. JSONファイル内の `client_email` を確認:
   ```bash
   cat ~/.config/gcloud/claude-code-sheets-sa.json | grep client_email
   # → "client_email": "claude-code-sheets@your-project.iam.gserviceaccount.com"
   ```
3. Google Drive で対象フォルダを右クリック →「共有」
4. Service Account のメールアドレスを追加し、**編集者**権限を付与
5. フォルダのURLからフォルダIDを取得:
   ```
   https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
                                          ↑ これがフォルダID
   ```

### Step 3: 環境変数の設定

```bash
# ~/.zshrc に追加
echo 'export GOOGLE_SHEETS_SA_PATH="$HOME/.config/gcloud/claude-code-sheets-sa.json"' >> ~/.zshrc
echo 'export GOOGLE_SHEETS_DRIVE_FOLDER_ID="your-folder-id"' >> ~/.zshrc

# 設定を反映
source ~/.zshrc
```

### Step 4: 設定の確認

```bash
# 環境変数が設定されているか確認
echo $GOOGLE_SHEETS_SA_PATH
# → /Users/xxx/.config/gcloud/claude-code-sheets-sa.json と表示されればOK

echo $GOOGLE_SHEETS_DRIVE_FOLDER_ID
# → フォルダID が表示されればOK

# JSONファイルが存在するか確認
ls -la $GOOGLE_SHEETS_SA_PATH

# MCP設定を同期
./scripts/sync-mcp.sh

# Claude Code を再起動
```

### Step 5: 動作確認

Claude Code で以下を実行:

```
/generate-uat specs/stories/DEBT-S-98-sms-template-list/design.md
```

---

## トラブルシューティング

### 「MCP接続エラー」が表示される

1. 環境変数が設定されているか確認
   ```bash
   echo $GITHUB_MCP_TOKEN
   ```

2. Claude Code を再起動（新しいターミナルセッションで）

3. npx がインストールされているか確認
   ```bash
   npx --version
   ```

### 「権限がありません」エラー

1. トークンのスコープを確認
   - `repo` スコープが必要
   - プライベートリポジトリの場合は特に注意

2. トークンが有効期限切れでないか確認
   - https://github.com/settings/tokens で確認

### 組織リポジトリにアクセスできない

1. `read:org` スコープを追加
2. 組織の設定で Personal Access Token の使用が許可されているか確認
   - 組織の Settings → Third-party access → Personal access tokens

---

## セキュリティに関する注意事項

- **トークンをGitにコミットしない**: `.zshrc`や`.bashrc`はGit管理外
- **定期的にトークンをローテーション**: 90日程度での更新を推奨
- **最小権限の原則**: 必要なスコープのみを付与
- **トークン漏洩時**: 即座に https://github.com/settings/tokens で無効化
