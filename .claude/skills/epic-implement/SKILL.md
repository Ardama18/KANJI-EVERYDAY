---
description: Agent Teamsで Epic 内の複数ストーリーを並列実装
argument-hint: <エピックディレクトリパス> [--model <モデル名>] [追加指示]
disable-model-invocation: true
---

**コマンドコンテキスト**: Agent Teams を活用し、Epic 内の複数ストーリーを並列実装

## 前提条件

**実験的機能**: このスキルは Claude Code の Agent Teams 機能（実験的）を使用します。

**トークンコスト注意**: 各 Teammate が独立した Claude Code インスタンスのため、トークン消費量が単一セッションの数倍になります。ストーリー数に応じてコストが増加する点をユーザーに事前告知してください。

**Permission 事前設定推奨**: 各 Teammate が npm test / npm run lint / git 等を個別に権限要求すると大量のプロンプトが発生します。スポーン前に `--dangerously-skip-permissions` の使用、または permission settings で共通操作を事前許可することを推奨してください。

**環境変数チェック（必須）**:
実行開始前に `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` が有効か確認してください。
設定されていない場合は以下を表示して処理を中断:

```
Agent Teams 機能が有効になっていません。
以下のいずれかの方法で有効化してから再実行してください:

方法1: 環境変数を設定
  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

方法2: settings.json に追加
  { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

## 初回必須タスク

作業開始前に以下のファイルを必ず読み込み、厳守してください：
- @.claude/steering/sub-agents.md - サブエージェント管理フロー
- @.claude/skills/implement/SKILL.md - 単一ストーリー実装フロー（各 Teammate が実行する内容）

## 責務

**Epic 全体の並列実装オーケストレーション（Team Lead として動作）**

- /implement は変更しない（単一ストーリー用として維持）
- 各 Teammate = 独立 Claude Code インスタンスが /implement 全フローを自律実行
- Team Lead（私）はストーリーの振り分けと競合調停のみ担当
- **delegate mode を有効化**（Shift+Tab）し、自身は実装作業を行わない

**責務境界**：
- ✅ エピック情報取得・ストーリー一覧把握
- ✅ ストーリー間の依存関係分析
- ✅ 並列実行グループの決定
- ✅ Agent Teams でのチーム作成・Teammate スポーン
- ✅ 共有リソースの競合調停（shared/ 型定義、DB マイグレーション順序）
- ✅ Teammate からのメッセージ監視（Mailbox 経由で自動配信）
- ✅ エスカレーション時のユーザーへの報告
- ✅ チームの cleanup（全 Teammate shutdown 後）
- ❌ 自身での実装作業（Teammate に委譲）

## 入力

```
/epic-implement <エピックディレクトリパス> [--model <モデル名>] [追加指示]
```

**引数**：
- `<エピックディレクトリパス>` (必須): Epic ディレクトリのパス（例: `specs/epics/E-02-task-management-system`）
- `--model <モデル名>` (任意): Teammate が使用するモデル（デフォルト: opus）
  - 指定可能: `opus`, `sonnet`, `haiku`
  - 全 Teammate に共通適用
- `[追加指示]` (任意): ユーザーからの追加要望・制約・方針

## Agent Teams アーキテクチャ

公式ドキュメント: https://code.claude.com/docs/en/agent-teams

### 構成要素

| コンポーネント | 役割 |
|:-------------|:-----|
| **Team Lead** | メインセッション。チーム作成、Teammate スポーン、作業調整 |
| **Teammates** | 独立 Claude Code インスタンス。各自がタスクを実行 |
| **Task list** | 共有タスクリスト。Teammate がクレーム・完了を管理 |
| **Mailbox** | エージェント間メッセージングシステム。メッセージは自動配信 |

### 重要な仕様
- Teammate は **CLAUDE.md、MCP サーバー、スキルを自動ロード**する
- Teammate は **Lead の会話履歴を引き継がない** → スポーン時のプロンプトに必要な情報を含める
- Teammate は **ネストチーム（自分のチーム）を作成できない**
- Teammate の権限は **Lead の権限設定を継承**する
- **セッション再開（/resume）では Teammate は復元されない** → 再スポーンが必要

### コミュニケーション方法
- **write**: 特定の Teammate にメッセージ送信
- **broadcast**: 全 Teammate に一斉送信（コスト注意）
- **自動配信**: Teammate からのメッセージは Lead に自動到着
- **idle 通知**: Teammate 完了時に自動で Lead に通知

## 実行フロー

### Phase 1: エピック情報取得

```
指示内容: $ARGUMENTS

1. 引数チェック: エピックディレクトリパスが指定されているか確認
2. --model オプションの解析（指定なければ opus）
3. epic.md を読み込み（エピック情報・技術方針）:
   - specs/epics/{EPIC_ID}-{title}/epic.md
   - エピックID、タイトル、概要、技術方針を抽出
4. Epic 配下のストーリー一覧を取得:
   - epic.md のストーリー一覧セクションからストーリーディレクトリを特定
   - specs/stories/{STORY_ID}-{title}/ の存在を確認
5. 各ストーリーの進捗を確認し、開始フェーズを判定:

   | 状態 | 判定基準 | 開始フェーズ |
   |------|---------|------------|
   | 実装済み | tasks/ 内の全タスクが完了（全チェックボックス [x]） | スキップ |
   | 実装フェーズ | design.md + tasks/ あり | task-executor から開始 |
   | 設計フェーズ | requirements.md のみ | technical-designer から開始 |
   | 未着手 | 何もなし（meta.json のみ） | requirement-analyzer から開始 |
```

### Phase 2: 並列化計画（ユーザー承認）

```
1. ストーリー間の依存関係を分析:
   - DB マイグレーション順序（テーブル間の外部キー依存）
   - shared/ の型依存（型定義の作成→利用の順序）
   - API 依存（BE 先行、FE 後続 等）
   - モジュール間の import 依存

2. 並列実行グループを決定:
   - Group 1: 独立ストーリー群（依存関係なし、同時実行可）
   - Group 2: Group 1 に依存するストーリー群
   - Group N: Group N-1 に依存するストーリー群
   ※ 同一グループ内のストーリーは互いに独立であること

3. ユーザーに計画を提示:
   - 各ストーリーの現在状態と開始フェーズ
   - 依存関係の分析結果
   - グループ分けと実行順序
   - 使用モデル
   - スキップするストーリー（実装済み）

4. [停止: ユーザー承認待ち]
   - 承認 → Phase 3 へ
   - 修正要求 → グループ分けを調整して再提示
   - キャンセル → 処理中断
```

### Phase 3: Agent Teams で並列実行

```
1. チーム作成:
   「Epic {EPIC_ID} の並列実装チームを作成します。
    {N} 名の Teammate をスポーンし、各自がストーリーを担当します。
    モデルは {MODEL} を使用します。」

2. delegate mode を有効化（Shift+Tab）:
   Lead は実装作業を行わず、調整に専念

3. グループ単位で順次実行:
   各グループについて:

   a. グループ内の各ストーリーを Teammate としてスポーン:
      - Teammate 名: story-{STORY_ID}（例: story-S-12）
      - 各 Teammate に以下のスポーンプロンプトを送信:

        ---
        あなたは Epic {EPIC_ID} のストーリー {STORY_ID} を担当する実装者です。

        ## Git ブランチ（最初に実行）
        作業開始前に必ず以下を実行:
        1. `git checkout -b feature/{STORY_ID}` でストーリー専用ブランチを作成
        2. 全てのコミットはこのブランチ上で行うこと
        3. 他のブランチへの checkout は禁止

        ## 担当ストーリー
        - ストーリーID: {STORY_ID}
        - ディレクトリ: specs/stories/{STORY_ID}-{title}/
        - 開始フェーズ: {START_PHASE}
        - Epic 技術方針: {EPIC_TECH_POLICY}（epic.md の内容要約）

        ## 実行内容
        .claude/skills/implement/SKILL.md と
        .claude/steering/sub-agents.md に従い、
        {START_PHASE} から完了まで全フローを自律実行してください。

        ## 競合回避ルール
        - shared/ の型定義を追加・変更する前に、Team Lead にメッセージで通知すること
        - DB マイグレーションファイルを作成する場合、Team Lead にメッセージで通知すること
        - 他のストーリーのディレクトリ（specs/stories/{OTHER_STORY_ID}-*/）は変更禁止

        ## DB マイグレーション順序（Team Lead 指定）
        {MIGRATION_ORDER}（Phase 2 で決定したタイムスタンプ順序）

        ## 停止ポイント
        sub-agents.md の停止ポイント（設計確認、計画承認等）では、
        Team Lead にメッセージを送信して承認を待ってください。

        ## 完了報告
        全タスク完了後、以下の情報を Team Lead にメッセージで送信:
        - 完了ステータス（completed / escalation_needed）
        - ブランチ名: feature/{STORY_ID}
        - 変更ファイル一覧
        - 追加テスト一覧
        - コミットハッシュ一覧

        ## 追加指示
        {USER_ADDITIONAL_INSTRUCTIONS}
        ---

   b. Teammate からのメッセージを監視（Mailbox 経由で自動配信）:
      - 停止ポイント到達通知 → Lead が内容確認し write で承認/修正指示を返信
      - shared/ 変更通知 → 他の Teammate と競合がないか確認、承認/待機指示
      - DB マイグレーション通知 → タイムスタンプ順序の確認、承認
      - エスカレーション → ユーザーに報告、判断待ち
      - idle 通知（完了） → 記録

   c. 共有リソース競合の調停:
      - shared/ 型追加: 先に到達した Teammate が担当、他は完了を待って利用
      - DB マイグレーション: Lead が事前指定したタイムスタンプ順序を適用
      - 同一ファイル編集: git status で検知 → 該当 Teammate に write で調整指示

   d. グループ内全 Teammate 完了を確認:
      - 各 Teammate に requestShutdown を送信
      - 全 Teammate shutdown 後、次グループへ
```

### Phase 4: 統合と完了

```
1. 全ストーリー完了確認:
   - 各ストーリーの完了ステータスを集計
   - 未完了ストーリーがあればユーザーに報告

2. チームの cleanup を実行（全 Teammate shutdown 済みを確認後）

3. 各完了ストーリーのブランチを push し、PR を作成:
   - 各 feature/{STORY_ID} ブランチについて:
     a. `git push -u origin feature/{STORY_ID}`
     b. `gh pr create` で PR 作成:
        - title: "{STORY_ID}: {ストーリータイトル}"
        - body: 変更サマリー、テスト結果、コミット一覧
        - base: main（またはユーザー指定のベースブランチ）
   - 依存関係がある場合（Group 2+ のストーリー）:
     base を前グループのブランチに設定するか、ユーザーに確認

4. 完了報告を表示:

   Epic 並列実装完了

   **Epic 情報**:
   - エピックID: {EPIC_ID}
   - タイトル: {TITLE}

   **実装結果**:
   | ストーリー | ステータス | ブランチ | PR | 変更ファイル数 |
   |-----------|-----------|---------|-----|-------------|
   | {STORY_ID_1} | completed | feature/{STORY_ID_1} | #N | N |
   | {STORY_ID_2} | completed | feature/{STORY_ID_2} | #N | N |
   | {STORY_ID_3} | escalation | feature/{STORY_ID_3} | - | - |

   **完了したストーリー** (N件):
   - {STORY_ID_1}: {概要} → PR #{N}
   - {STORY_ID_2}: {概要} → PR #{N}

   **未完了ストーリー** (N件):
   - {STORY_ID_3}: {エスカレーション理由}

   **次のアクション**:
   - 各 PR をレビュー・マージしてください
   - 未完了ストーリーは `/implement specs/stories/{STORY_ID}-{title}` で個別に実行できます
```

## 競合回避ルール

### Git ブランチ戦略
- 各 Teammate はスポーン直後に `feature/{STORY_ID}` ブランチを作成
- 全コミットはストーリー専用ブランチ上で実行（他ブランチへの checkout 禁止）
- これにより同一ワーキングディレクトリでも Teammate 間のファイル競合を防止
- Phase 4 で Lead が各ブランチを push し、PR を作成

### shared/ 型定義
- 先に到達した Teammate が型定義を追加
- 他の Teammate は完了を待ってから利用
- Lead が write メッセージで順序を調整

### DB マイグレーション
- Lead が Phase 2 でタイムスタンプ順序を事前指定
- 各 Teammate は指定されたタイムスタンプを使用
- 順序: グループ番号 x 100 + ストーリー順（例: Group1-Story1=100, Group1-Story2=200）

### 同一ファイル編集
- 各ストーリーは基本的に異なるモジュールを担当する前提
- 重複する場合は Phase 2 で依存関係として検出し、同グループに入れない
- 実行中に競合を検知した場合は Lead が該当 Teammate に write で停止指示

## モデル設定

| オプション | モデル | 用途 |
|-----------|--------|------|
| (デフォルト) | opus | 全 Teammate 共通、最高品質 |
| `--model sonnet` | sonnet | 全 Teammate 共通、コスト効率重視 |
| `--model haiku` | haiku | 全 Teammate 共通、高速・低コスト |

スポーン時に自然言語で指定:
「Use {MODEL} for each teammate.」

## エラーハンドリング

### エピックディレクトリ未指定
```
エピックディレクトリが指定されていません。

使用例:
/epic-implement specs/epics/E-02-task-management-system
/epic-implement specs/epics/E-02-task-management-system --model sonnet
```

### エピックディレクトリ不在
```
指定されたエピックディレクトリが見つかりません: {path}

利用可能なエピック:
  specs/epics/E-01-foundation-auth-system
  specs/epics/E-02-task-management-system
  ...
```

### Teammate セッション切断
```
1. commit 済みの成果は保持（git log で確認可能）
2. 未完了のタスクを特定
3. ユーザーに報告:
   Teammate ({STORY_ID}) のセッションが切断されました。
   - 完了済みコミット: {N}件（保持されています）
   - 未完了タスク: {タスク一覧}
   - 対処: `/implement specs/stories/{STORY_ID}-{title}` で個別に継続できます
4. 新しい Teammate をスポーンして継続することも可能
```

### ファイル競合検知
```
1. git status で変更ファイルの重複を検知
2. 該当 Teammate に write で停止指示
3. Lead が競合を解決:
   - どちらの変更を優先するか判断
   - 必要に応じてユーザーにエスカレーション
```

### 部分完了
```
1. 完了したストーリーと未完了ストーリーを明確に分離
2. 完了したストーリーのコミットは保持
3. 未完了ストーリーの状態をユーザーに報告
4. `/implement` での個別継続を案内
```

## 既知の制限事項（Agent Teams 公式）

- **/resume で Teammate は復元されない**: セッション再開後は新しい Teammate をスポーンする必要あり
- **タスクステータスの遅延**: Teammate が完了マークを付け忘れる場合あり。Lead が手動確認
- **shutdown に時間がかかる場合あり**: 現在のリクエスト完了を待つため
- **1セッション1チーム**: 現在のチームを cleanup してから新チームを作成
- **ネストチーム不可**: Teammate は自分のチームを作成できない
- **Lead は固定**: チーム作成セッションが永続的に Lead

## 使用例

### 基本的な使用例
```
/epic-implement specs/epics/E-02-task-management-system
```

### モデル指定あり
```
/epic-implement specs/epics/E-02-task-management-system --model sonnet
```

### 追加指示あり
```
/epic-implement specs/epics/E-02-task-management-system --model sonnet パフォーマンス重視で実装してください
```

## 品質基準

### 必須条件
- [ ] CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 環境変数の確認
- [ ] エピック情報が正しく取得されること（ローカル epic.md から）
- [ ] ストーリーの進捗状態が正しく判定されること
- [ ] 依存関係分析が正しく行われること
- [ ] 並列化計画がユーザーに提示・承認されること
- [ ] 各 Teammate が独立して /implement フローを完走できること
- [ ] shared/ の競合が発生しないこと
- [ ] 全ストーリーの完了/未完了が正しく報告されること
- [ ] チームの cleanup が正しく実行されること

### 推奨条件
- [ ] 2-3 ストーリーの小さい Epic で動作確認済み
- [ ] エスカレーション時のユーザー報告が明確であること
- [ ] 部分完了時の状態が正しく保持・報告されること
- [ ] delegate mode が有効化されていること
