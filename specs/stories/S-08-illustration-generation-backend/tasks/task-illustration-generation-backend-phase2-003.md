# タスク: prompt生成とGeminiクライアント契約を実装する

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 2
- 依存: `specs/stories/S-08-illustration-generation-backend/tasks/task-illustration-generation-backend-phase1-002.md`
- 提供成果物:
  - `frontend/src/lib/illustration/prompt.ts`
  - `frontend/src/lib/illustration/prompt.test.ts`
  - `frontend/src/lib/illustration/gemini-client.ts`
  - `frontend/src/lib/illustration/gemini-client.test.ts`
  - `frontend/src/lib/illustration/types.ts`
- 関連AC: AC-09, AC-14（+ AC-08/11の失敗分類前提）
- サイズ: 標準（4-10ファイル）

## 実装内容
`sanitizePromptInput` で制御文字除去と100文字上限を保証し、Gemini連携を `fetch` ベースで実装する。失敗理由を `model_info` に記録できる型契約を定義し、後続のgeneratorで利用可能にする。

## 対象ファイル
- [x] `frontend/src/lib/illustration/prompt.ts`
- [x] `frontend/src/lib/illustration/prompt.test.ts`
- [x] `frontend/src/lib/illustration/gemini-client.ts`
- [x] `frontend/src/lib/illustration/gemini-client.test.ts`
- [x] `frontend/src/lib/illustration/types.ts`

## テスト観点
- Unit:
  - 制御文字除去と100文字トリム
  - `fetch` 経由でGemini APIを呼び出し、SDK依存を追加しない
  - HTTP失敗・不正payload時の失敗分類が `model_info` に反映される

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `prompt.test.ts` に sanitize の境界テスト（制御文字・長文）を追加する。
- [x] `gemini-client.test.ts` に `fetch` 成功/失敗分類の失敗テストを追加する。
- [x] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/illustration/prompt.test.ts
npm run test --prefix frontend -- src/lib/illustration/gemini-client.test.ts
```

### 2. Green Phase
- [x] `prompt.ts` に sanitize + prompt 生成を実装する。
- [x] `types.ts` に model_infoの成功/失敗契約型を追加する。
- [x] `gemini-client.ts` に `fetch` 実装と失敗分類ロジックを実装する。
- [x] 追加したunitテストを通す。

```bash
npm run test --prefix frontend -- src/lib/illustration/prompt.test.ts
npm run test --prefix frontend -- src/lib/illustration/gemini-client.test.ts
```

### 3. Refactor Phase
- [x] Geminiレスポンス変換の重複処理をヘルパーへ整理する。
- [x] 型ガードを追加して `any` 依存を排除する。
- [x] unitテストを再実行する。

```bash
npm run test --prefix frontend -- src/lib/illustration/prompt.test.ts
npm run test --prefix frontend -- src/lib/illustration/gemini-client.test.ts
```

## 完了条件
- [x] AC-14（制御文字除去 + 100文字上限）を満たす。
- [x] AC-09（Gemini `fetch` 実装、SDK依存追加なし）を満たす。
- [x] model_info へ失敗理由を格納する型契約が後続タスクで利用可能になっている。
- [x] `prompt.test.ts` と `gemini-client.test.ts` がPASSしている。
- [x] 動作確認レベル L2（対象Unit）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/lib/illustration/prompt.test.ts`
- [x] `npm run test --prefix frontend -- src/lib/illustration/gemini-client.test.ts`
- [x] `git diff --name-only`
