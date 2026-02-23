---
name: story-to-stories
description: 大きなストーリーを複数の小さなストーリーに分解し、子ストーリーを一括作成
argument-hint: '<親ストーリーディレクトリパス> [追加指示]'
disable-model-invocation: true
---

**コマンドコンテキスト**: Story層の管理（大きすぎるストーリーの分割）

## 初回必須タスク

作業開始前に以下のルールファイルを必ず読み込み、厳守してください：
- @.claude/steering/story-structure.md - ディレクトリ構造とSSOT原則
- @.claude/steering/sub-agents.md - サブエージェント管理フロー
- @.agents/shared/delegation-protocol.md - 委任プロトコル共通定義

## 責務

**Story層のストーリー分割を担当**

このコマンドは、スコープが大きすぎるストーリーを複数の小さなストーリーに分割します。分割粒度はエピック→ストーリー分割と同等です。

### 親子関係の管理

ストーリーの親子関係はmeta.jsonの`parent_story_id`フィールドで管理します：

- **子ストーリー**: meta.jsonの`parent_story_id`に親ストーリーIDを設定
- **親ストーリー**: requirements.md/design.mdに子ストーリーリストを追記

**使用するエージェント**:
1. **ローカルファイル操作**: 親ストーリー情報読み取り、子ストーリーディレクトリ・ファイル作成
2. **epic-decomposer**: ストーリーの分解（エピック分解と同じロジックを流用）

**責務境界**：
- ✅ 親ストーリー情報読み取り（ローカルの story.md / requirements.md / meta.json をRead）
- ✅ 親ストーリー→子ストーリー分解（epic-decomposerが実行）
- ✅ ローカルで子ストーリーディレクトリ + story.md + meta.json を作成
- ✅ 子ストーリーIDの採番（TC-S-{連番}形式）
- ✅ meta.json作成（parent_story_idを含む）
- ✅ 親ストーリーのドキュメントに子ストーリーリストを追記
- ❌ 子ストーリーの設計・実装（/implementコマンドが担当）

## 入力

```
/story-to-stories <親ストーリーディレクトリパス> [追加指示]
```

**引数**：
- `<親ストーリーディレクトリパス>` (必須): 分割する親ストーリーのディレクトリパス（例: `specs/stories/TC-S-34-user-management`）
- `[追加指示]` (任意): ユーザーからの追加要望・制約・方針
  - 例: 「画面単位で分割」「API開発とフロントエンド開発を分離」

## 実行フロー

### Step 1: 親ストーリーディレクトリパス検証

```
1. 引数チェック: 親ストーリーディレクトリパスが指定されているか確認
2. エラー時:
   - エラーメッセージを表示
   - 使用例を提示
   - 処理を中断
```

### Step 2: ローカルの親ストーリー情報読み込み

```
1. 親ストーリーディレクトリ内のファイルをReadツールで読み込み:
   - 読み込み対象: story.md, requirements.md, meta.json
   - 出力: storyData (storyId, title, description, requirements, epicId)
     - epicId: meta.jsonのepic_idから取得

2. エラーハンドリング:
   - ディレクトリ不存在 → エラーメッセージ表示、処理中断
   - 必要なファイル不存在 → エラーメッセージ表示、処理中断
```

### Step 3: epic-decomposer実行（ストーリー分解モード）

```
1. epic-decomposerエージェントを呼び出し:
   - 入力:
     - storyData（Step 2の出力 - ローカルファイルから取得した親ストーリー情報）
     - userRequest（ユーザーからの追加指示）
     - mode: "story-decomposition"（ストーリー分解モード）
   - 処理内容:
     - ストーリー分解（リリース単位、必要最小限）
     - 各子ストーリーの詳細な要件を生成（要件概要、機能詳細、技術要件、UI仕様）
     - エピックディレクトリ作成・epic.md生成はスキップ
   - 出力: childStoriesData (parentStoryId, childStories[{title, summary, detailedContent}], implementationOrder[])

2. エラーハンドリング:
   - 分解失敗 → エラーメッセージ表示、処理中断
```

**重要な変更点**:
- エピックではなく親ストーリーを入力とする
- epic.md生成はスキップ（ストーリー層のため）
- childStories配列には`summary`（簡潔な概要）と`detailedContent`（詳細な要件）が含まれる
- 子ストーリーIDはローカルで採番（既存のspecs/stories/ディレクトリを走査して次の連番を決定）

### Step 4: ユーザー確認（分解結果の承認）

```
1. epic-decomposerの出力を表示:
   - 親ストーリーID、タイトル
   - 生成された子ストーリー一覧（ID、タイトル）
   - 実装順序の推奨

2. ユーザーに確認を求める:
   「このストーリー分解で進めてよろしいですか？ (yes/no)」

3. ユーザー応答のハンドリング:
   - "yes" または "y": Step 5へ進む
   - "no" または "n": 処理をキャンセル、メッセージ表示して終了
   - その他: 再度確認を求める
```

### Step 5: 子ストーリーID採番とディレクトリ・ファイル作成

```
1. 子ストーリーIDの採番:
   - specs/stories/ ディレクトリを走査し、既存のTC-S-{N}形式のIDを収集
   - 最大番号 + 1 から連番で新しい子ストーリーIDを割り当て
   - 例: 既存がTC-S-36まであれば、TC-S-37, TC-S-38, ... と採番

2. 各子ストーリーについて:
   a. 子ストーリーディレクトリ作成:
      `specs/stories/{STORY_ID}-{title}/`
      例: `specs/stories/TC-S-37-registration-form-ui/`

   b. story.mdを作成:
      - epic-decomposerが生成したdetailedContentをそのまま書き込み

   c. meta.jsonを作成:
      {
        "story_id": "TC-S-37",
        "epic_id": "TC-E-1",
        "parent_story_id": "TC-S-34",
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

### Step 6.5: 親ストーリーのドキュメントに子ストーリーリストを追記

```
1. 親ストーリーのrequirements.mdを読み込み
   - ファイルパス: `specs/stories/{PARENT_STORY_ID}-{title}/requirements.md`

2. requirements.mdの末尾に「## 子ストーリー」セクションを追加（存在しない場合）
   - 既に存在する場合は、既存のリストに追記

3. 各子ストーリーについて以下の形式で追記:
   - [{STORY_ID}](../{STORY_ID}-{title}/) - {summary}
   例: - [TC-S-37](../TC-S-37-registration-form-ui/) - ユーザー登録フォームのUI実装...

4. requirements.mdを保存

5. design.mdが存在する場合も同様の処理を実施
   - ファイルパス: `specs/stories/{PARENT_STORY_ID}-{title}/design.md`
   - 末尾に「## 子ストーリー」セクションを追加
```

**重要な変更点**:
- 親ストーリーのドキュメントに子ストーリーのリンクを自動追加
- 親子関係を明示化

### Step 7: 結果表示

```
1. 完了メッセージを表示:
   - 親ストーリーID、タイトル
   - 生成された子ストーリー数
   - 各子ストーリーのURL
   - 実装順序の推奨

2. 次のアクションを案内:
   「各子ストーリーの実装は以下のコマンドで開始できます：」
   /implement <子ストーリーディレクトリパス>
```

## エラーハンドリング

### 親ストーリーディレクトリパス未指定

```
エラー検出時:
1. エラーメッセージを表示:
   親ストーリーディレクトリパスが指定されていません。

2. 使用例を提示:
   使用例:
   /story-to-stories specs/stories/TC-S-34-user-management

3. 処理を中断
```

### ファイル読み込み失敗

```
エラー検出時:
1. エラーメッセージを表示:
   ストーリー情報の読み込みに失敗しました。

2. 対処方法を案内:
   - ディレクトリパスが正しいか確認してください
   - story.md / meta.json が存在するか確認してください

3. 処理を中断
```

### ユーザーがキャンセル

```
ユーザーが"no"を選択した場合:
1. キャンセルメッセージを表示:
   ⚠️ ストーリー分解をキャンセルしました。

2. 案内:
   ※子ストーリーページは作成されていません。

3. 処理を終了
```

### 部分的成功（一部の子ストーリー作成失敗）

```
一部の子ストーリー作成に失敗した場合:
1. 警告メッセージを表示:
   ⚠️ 一部の子ストーリー作成に失敗しました。

2. 成功/失敗の詳細を表示:
   成功した子ストーリー (2件):
   - TC-S-37: Registration Form UI
   - TC-S-38: Login Form UI

   失敗した子ストーリー (1件):
   - Profile Edit Form UI (エラー: ディレクトリ作成失敗)

3. 対処方法を案内:
   失敗した子ストーリーは手動で作成するか、/story-to-storiesコマンドを再実行してください。

4. 処理を完了（成功した子ストーリーは有効）
```

## 出力フォーマット

### 成功時の出力

```markdown
✅ ストーリー分解完了

**親ストーリー情報**:
- ストーリーID: {PARENT_STORY_ID}
- タイトル: {タイトル}
- ディレクトリ: `specs/stories/{PARENT_STORY_ID}-{title}/`

**生成された子ストーリー** ({N}件):
1. {CHILD_STORY_ID}: {タイトル}
   - ディレクトリ: `specs/stories/{CHILD_STORY_ID}-{title}/`

2. {CHILD_STORY_ID}: {タイトル}
   ...

**実装順序の推奨**:
1. {CHILD_STORY_ID} - {理由}
2. {CHILD_STORY_ID} - {理由}
3. {CHILD_STORY_ID} - {理由}

**次のアクション**:
各子ストーリーの実装は以下のコマンドで開始できます:
```
/implement specs/stories/{CHILD_STORY_ID}-{title}
```
```

### エラー時の出力

```markdown
❌ ストーリー分解失敗

**エラー内容**: {エラーメッセージ}

**対処方法**: {対処方法の説明}
```

## 使用例

### 基本的な使用例

```
入力:
/story-to-stories specs/stories/TC-S-34-user-management

実行内容:
1. 親ストーリー情報読み込み（ローカルファイル）
2. 3つの子ストーリーに分解（epic-decomposer）
3. ユーザー確認（承認）
4. 子ストーリーID採番、ディレクトリ・story.md・meta.json作成
5. 親ストーリーのrequirements.md/design.mdに子ストーリーリストを追記

出力:
ストーリー分解完了

**親ストーリー情報**:
- ストーリーID: TC-S-34
- タイトル: User Management
- ディレクトリ: `specs/stories/TC-S-34-user-management/`

**生成された子ストーリー** (3件):
1. TC-S-37: User Registration Form
   - ディレクトリ: `specs/stories/TC-S-37-user-registration-form/`

2. TC-S-38: User Login Form
   - ディレクトリ: `specs/stories/TC-S-38-user-login-form/`

3. TC-S-39: User Profile Management
   - ディレクトリ: `specs/stories/TC-S-39-user-profile-management/`

**実装順序の推奨**:
1. TC-S-37 - 基盤となるユーザー登録機能
2. TC-S-38 - ログイン機能（登録機能に依存）
3. TC-S-39 - プロフィール管理（ログイン機能に依存）

**次のアクション**:
各子ストーリーの実装は以下のコマンドで開始できます:
```
/implement specs/stories/TC-S-37-user-registration-form
```
```

### キャンセルの例

```
入力:
/story-to-stories specs/stories/TC-S-35-payment-integration

実行内容:
1. 親ストーリー情報取得
2. 2つの子ストーリーに分解
3. ユーザー確認（拒否）

出力:
⚠️ ストーリー分解をキャンセルしました。

※子ストーリーページおよび子ストーリーディレクトリは作成されていません。

再度分解を実行する場合は、/story-to-storiesコマンドを実行してください。
```

## 品質基準

### 必須条件
- [ ] 親ストーリーディレクトリパスが正しく検証されること
- [ ] ローカルの story.md / requirements.md / meta.json が正常に読み込めること
- [ ] epic-decomposerが正常に実行されること（ストーリー分解モード）
- [ ] ユーザー確認が適切に動作すること（yes/no判定）
- [ ] 子ストーリーIDが正しく採番されること（TC-S-{連番}形式）
- [ ] 子ストーリーディレクトリが正しく作成されること
- [ ] story.mdにdetailedContentが完全に書き込まれること
- [ ] meta.jsonが正しく作成されること（parent_story_idを含む、新フォーマット準拠）
- [ ] 親ストーリーのrequirements.md/design.mdに子ストーリーリストが追記されること
- [ ] 子ストーリーディレクトリパスリストが正しく表示されること

### 推奨条件
- [ ] エラーメッセージがわかりやすく、対処方法が明確であること
- [ ] 部分的成功時に成功/失敗の詳細が明示されること
- [ ] 次のアクション（/implementコマンド）が明確に案内されること

## epic-to-storiesコマンドとの違い

| 項目 | epic-to-stories | story-to-stories |
|------|----------------|------------------|
| 入力 | エピックディレクトリパス | 親ストーリーディレクトリパス |
| 出力 | ストーリー | 子ストーリー |
| エピックディレクトリ作成 | ✅ | ❌（不要） |
| epic.md生成 | ✅ | ❌（不要） |
| meta.jsonのparent_story_id | 空文字列 | 親ストーリーID |
| ドキュメント更新 | epic.md | requirements.md / design.md |
| 親子関係の表現 | エピック→ストーリー | 親ストーリー→子ストーリー |
