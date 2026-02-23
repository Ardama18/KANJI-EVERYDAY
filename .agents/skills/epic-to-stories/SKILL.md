---
name: epic-to-stories
description: エピックをストーリーに分解し、ストーリーを一括作成
argument-hint: '<エピックディレクトリパス> [追加指示]'
disable-model-invocation: true
---

**コマンドコンテキスト**: Epic層の管理（エピック分解→ストーリー一括作成）

## 初回必須タスク

作業開始前に以下のファイルを必ず読み込み、厳守してください：
- @.claude/steering/story-structure.md - ディレクトリ構造とSSOT原則
- @.claude/steering/sub-agents.md - サブエージェント管理フロー
- @decomposer.md - ストーリー分解ロジック（本スキルのサブファイル）
- @.agents/shared/delegation-protocol.md - 委任プロトコル共通定義

## 責務

**Epic層のみ担当**（Story層は/implementコマンドが担当）

このコマンドは以下をオーケストレーションします：
1. **ローカルファイル操作**: エピック情報読み取り、ストーリーディレクトリ・ファイル作成
2. **@decomposer.md**: エピックのストーリー分解ロジック（スキル内サブファイル）

**責務境界**：
- ✅ エピック→ストーリー分解（@decomposer.mdのロジックに従い実行）
- ✅ エピックディレクトリ作成（@decomposer.mdのロジックに従い実行）
- ✅ epic.md生成（技術方針のみ生成、ストーリー一覧は空）
- ✅ ローカルでストーリーディレクトリ + story.md + meta.json を作成
- ✅ ストーリーIDの採番（TC-S-{連番}形式）
- ✅ epic.mdにストーリー一覧を追記（採番したストーリーIDを使用）
- ❌ ストーリーの設計・実装（/implementコマンドが担当）

## 入力

```
/epic-to-stories <エピックディレクトリパス> [追加指示]
```

**引数**：
- `<エピックディレクトリパス>` (必須): エピックディレクトリパス（例: `specs/epics/TC-E-1-authentication-system`）
- `[追加指示]` (任意): ユーザーからの追加要望・制約・方針
  - 例: 「モバイルファーストで設計」「既存DBスキーマを流用」「セキュリティ重視」

## 実行フロー

### Step 1: エピックディレクトリパス検証

```
1. 引数チェック: エピックディレクトリパスが指定されているか確認
2. エラー時:
   - エラーメッセージを表示
   - 使用例を提示
   - 処理を中断
```

### Step 2: ローカルのエピック情報読み込み

```
1. エピックディレクトリ内のファイルをReadツールで読み込み:
   - 読み込み対象: epic.md, requirements.md（存在する場合）
   - 出力: epicData (epicId, title, description, requirements)

2. エラーハンドリング:
   - ディレクトリ不存在 → エラーメッセージ表示、処理中断
   - epic.md不存在 → エラーメッセージ表示、処理中断
```

### Step 3: ストーリー分解ロジック実行

**参照**: @decomposer.md

```
1. @decomposer.mdのロジックに従い分解を実行:
   - 入力:
     - epicData（Step 2の出力 - ローカルファイルから取得したエピック情報）
     - userRequest（ユーザーからの追加指示）
   - 処理内容（@decomposer.md参照）:
     - Phase 1: ストーリー分解（リリース単位、必要最小限）
     - Phase 2: エピック全体のアーキテクチャ方針策定
     - Phase 3: エピックディレクトリ作成（specs/epics/のみ）
     - Phase 4: epic.md生成（技術方針のみ、ストーリー一覧は空）
   - 出力: storiesData (epicId, epicDirectory, stories[{title, summary, detailedContent}], implementationOrder[])

2. エラーハンドリング:
   - ディレクトリ作成失敗 → エラーメッセージ表示、処理中断
```

**重要な変更点**:
- stories配列には`summary`（簡潔な概要）と`detailedContent`（詳細な要件）が含まれる
- ストーリーIDはローカルで採番（既存のspecs/stories/ディレクトリを走査して次の連番を決定）

### Step 4: ユーザー確認（分解結果の承認）

```
1. epic-decomposerの出力を表示:
   - エピックID、タイトル
   - 生成されたストーリー一覧（ID、タイトル）
   - 実装順序の推奨
   - ディレクトリ構造

2. ユーザーに確認を求める:
   「このストーリー分解で進めてよろしいですか？ (yes/no)」

3. ユーザー応答のハンドリング:
   - "yes" または "y": Step 5へ進む
   - "no" または "n": 処理をキャンセル、メッセージ表示して終了
   - その他: 再度確認を求める
```

### Step 5: ストーリーID採番とディレクトリ・ファイル作成

```
1. ストーリーIDの採番:
   - specs/stories/ ディレクトリを走査し、既存のTC-S-{N}形式のIDを収集
   - 最大番号 + 1 から連番で新しいストーリーIDを割り当て
   - 例: 既存がTC-S-33まであれば、TC-S-34, TC-S-35, ... と採番

2. 各ストーリーについて:
   a. ストーリーディレクトリ作成:
      `specs/stories/{STORY_ID}-{title}/`
      例: `specs/stories/TC-S-34-parent-task-creation-distribution/`

   b. story.mdを作成:
      - epic-decomposerが生成したdetailedContentをそのまま書き込み

   c. meta.jsonを作成:
      {
        "story_id": "TC-S-34",
        "epic_id": "TC-E-1",
        "parent_story_id": "",
        "status": "not_started",
        "github_pr_url": "",
        "github_branch": ""
      }

3. エラーハンドリング:
   - ディレクトリ作成失敗 → エラーメッセージ表示、処理中断
   - 部分的成功 → 成功/失敗した項目を明示、ユーザーに報告
```

**重要・必須・省略厳禁**: epic-decomposerが生成した`detailedContent`（詳細な要件定義）を**必ず完全な形で**story.mdに書き込むこと。

**厳禁行為**:
- detailedContentを「(省略)」などと省略して書き込むこと
- summaryだけを書き込んでdetailedContentを書き込まないこと
- detailedContentの一部だけを書き込むこと

**detailedContentの検証**:
- 「# 要件概要」「# 機能要件の詳細」「# 技術要件」などのセクションを含むはず
- 省略されている場合は即座にエラーとして処理を中断すること

### Step 6: epic.mdにストーリー一覧を追記

```
1. `specs/epics/{EPIC_ID}-{title}/epic.md` を読み込み
2. 「## このエピックのストーリー」セクションを見つける
3. テンプレートのコメント行を削除
4. 各ストーリーについて以下の形式で追記:
   - [{STORY_ID}](../../stories/{STORY_ID}-{title}/) - {summary}
   例: - [TC-S-34](../../stories/TC-S-34-parent-task-creation-distribution/) - 親がタスクを作成・配布する画面...
5. epic.mdを保存
```

**重要な変更点**:
- epic-decomposerはepic.mdを生成するが、ストーリー一覧は空（テンプレートのコメントのみ）
- このステップで採番した実際のストーリーIDを使用してリンクを追記
- 各ストーリーのsummary（簡潔な要件概要）を含める（1-2行程度）

### Step 7: 結果表示

```
1. 完了メッセージを表示:
   - エピックID、タイトル
   - 生成されたストーリー数
   - 各ストーリーのディレクトリパス
   - 実装順序の推奨

2. 次のアクションを案内:
   「各ストーリーの実装は以下のコマンドで開始できます：」
   /implement <ストーリーディレクトリパス>
```

## エラーハンドリング

### エピックディレクトリパス未指定

```
エラー検出時:
1. エラーメッセージを表示:
   エピックディレクトリパスが指定されていません。

2. 使用例を提示:
   使用例:
   /epic-to-stories specs/epics/TC-E-1-authentication-system

3. 処理を中断
```

### ファイル読み込み失敗

```
エラー検出時:
1. エラーメッセージを表示:
   エピック情報の読み込みに失敗しました。

2. 対処方法を案内:
   - ディレクトリパスが正しいか確認してください
   - epic.mdが存在するか確認してください

3. 処理を中断
```

### ユーザーがキャンセル

```
ユーザーが"no"を選択した場合:
1. キャンセルメッセージを表示:
   ⚠️ ストーリー分解をキャンセルしました。

2. 作成済みのディレクトリ構造を案内:
   以下のディレクトリは作成済みです：
   - specs/epics/{EPIC_ID}/
   - specs/stories/{STORY_ID}/

   ※ストーリーページは作成されていません。

3. 処理を終了
```

### 部分的成功（一部のストーリー作成失敗）

```
一部のストーリー作成に失敗した場合:
1. 警告メッセージを表示:
   ⚠️ 一部のストーリー作成に失敗しました。

2. 成功/失敗の詳細を表示:
   成功したストーリー (3件):
   - TC-S-34: User Registration
   - TC-S-35: User Login
   - TC-S-36: Session Management

   失敗したストーリー (2件):
   - TC-S-37: Password Reset (エラー: ディレクトリ作成失敗)
   - TC-S-38: Email Verification (エラー: ファイル書き込み失敗)

3. 対処方法を案内:
   失敗したストーリーは手動で作成するか、/epic-to-storiesコマンドを再実行してください。

4. 処理を完了（成功したストーリーは有効）
```

## 出力フォーマット

### 成功時の出力

```markdown
✅ エピック分解完了

**エピック情報**:
- エピックID: {EPIC_ID}
- タイトル: {タイトル}
- ディレクトリ: `specs/epics/{EPIC_ID}-{title}/`

**生成されたストーリー** ({N}件):
1. {STORY_ID}: {タイトル}
   - ディレクトリ: `specs/stories/{STORY_ID}-{title}/`

2. {STORY_ID}: {タイトル}
   ...

**実装順序の推奨**:
1. {STORY_ID} - {理由}
2. {STORY_ID} - {理由}
3. {STORY_ID} - {理由}

**次のアクション**:
各ストーリーの実装は以下のコマンドで開始できます:
```
/implement specs/stories/{STORY_ID}-{title}
```
```

### エラー時の出力

```markdown
❌ エピック分解失敗

**エラー内容**: {エラーメッセージ}

**対処方法**: {対処方法の説明}
```

## 使用例

### 基本的な使用例

```
入力:
/epic-to-stories specs/epics/TC-E-1-authentication-system

実行内容:
1. エピック情報読み込み（ローカルファイル）
2. 5つのストーリーに分解（epic-decomposer）
3. ユーザー確認（承認）
4. ストーリーID採番、ディレクトリ・story.md・meta.json作成
5. epic.mdにストーリー一覧を追記

出力:
エピック分解完了

**エピック情報**:
- エピックID: TC-E-1
- タイトル: Authentication System
- ディレクトリ: `specs/epics/TC-E-1-authentication-system/`

**生成されたストーリー** (5件):
1. TC-S-34: User Registration
   - ディレクトリ: `specs/stories/TC-S-34-user-registration/`

2. TC-S-35: User Login
   - ディレクトリ: `specs/stories/TC-S-35-user-login/`

...

**実装順序の推奨**:
1. TC-S-34 - 基盤となるユーザー登録機能
2. TC-S-35 - ログイン機能（登録機能に依存）
3. TC-S-36 - セッション管理（ログイン機能に依存）
...

**次のアクション**:
各ストーリーの実装は以下のコマンドで開始できます:
```
/implement specs/stories/TC-S-34-user-registration
```
```

### キャンセルの例

```
入力:
/epic-to-stories specs/epics/TC-E-2-payment-integration

実行内容:
1. エピック情報読み込み
2. 3つのストーリーに分解
3. ユーザー確認（拒否）

出力:
ストーリー分解をキャンセルしました。

以下のディレクトリは作成済みです：
- specs/epics/TC-E-2-payment-integration/

※ストーリーディレクトリは作成されていません。

再度分解を実行する場合は、/epic-to-storiesコマンドを実行してください。
```

## 品質基準

### 必須条件
- [ ] エピックディレクトリパスが正しく検証されること
- [ ] ローカルのepic.md/requirements.mdが正常に読み込めること
- [ ] epic-decomposerが正常に実行されること（エピックディレクトリのみ作成）
- [ ] ユーザー確認が適切に動作すること（yes/no判定）
- [ ] ストーリーIDが正しく採番されること（TC-S-{連番}形式）
- [ ] ストーリーディレクトリが正しく作成されること
- [ ] story.mdにdetailedContentが完全に書き込まれること
- [ ] meta.jsonが正しく作成されること（新フォーマット準拠）
- [ ] epic.mdのストーリー一覧が正しく更新されること（採番したIDを使用）
- [ ] ストーリーディレクトリパスリストが正しく表示されること

### 推奨条件
- [ ] エラーメッセージがわかりやすく、対処方法が明確であること
- [ ] 部分的成功時に成功/失敗の詳細が明示されること
- [ ] 次のアクション（/implementコマンド、または/design-to-implementationコマンド）が明確に案内されること
