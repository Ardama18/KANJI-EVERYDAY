# タスク: IllustrationDisplay の状態別描画を実装する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 2
- 依存: `specs/stories/S-09-illustration-display-integration/tasks/task-reveal-backfill-phase1-002.md`
- 提供成果物:
  - `frontend/src/components/study/IllustrationDisplay.tsx`
  - `frontend/src/components/study/IllustrationDisplay.test.tsx`
- 関連AC: AC-03, AC-12, AC-13, AC-14, AC-15, AC-16
- サイズ: 標準（4-10ファイル）

## 実装内容
`IllustrationDisplay` を新規実装し、`none/pending/generating/failed/ready` の5状態を `data-testid` で判定可能に描画する。`ready` では `<Image>` を使用し、ロード失敗時は `illustration-fallback` へ切り替える。

## 対象ファイル
- [x] `frontend/src/components/study/IllustrationDisplay.tsx`
- [x] `frontend/src/components/study/IllustrationDisplay.test.tsx`

## テスト観点
- Unit:
  - `none` は `illustration-region` が0件（AC-03）
  - `pending` / `generating` で `illustration-loading=1`（AC-12, AC-13）
  - `failed` で `illustration-failed=1` + 再試行UIなし（AC-14）
  - `ready` で `illustration-image=1`（AC-15）
  - 画像エラーで `illustration-fallback=1`（AC-16）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `IllustrationDisplay.test.tsx` に5状態とfallbackの失敗テストを追加する。
- [x] `ready` 画像の `onError` 発火でfallbackへ遷移する失敗テストを追加する。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
```

### 2. Green Phase
- [x] `IllustrationDisplay.tsx` を実装し、状態ごとのDOM契約を満たす。
- [x] `ready` で `<Image>` を使い、`onError` 時は `illustration-fallback` を表示する。
- [x] 追加したテストを通過させる。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
```

### 3. Refactor Phase
- [x] 表示分岐と `data-testid` 定義を整理し、重複JSXを削減する。
- [x] テストを再実行して回帰なしを確認する。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
```

## 完了条件
- [x] AC-03/12/13/14/15/16 を `IllustrationDisplay` 単体テストで追跡できる。
- [x] `ready` 画像エラー時の fallback 契約が固定されている。
- [x] `CardBack` から安全に再利用できるprops契約が明確である。
- [x] 動作確認レベル L1（対象Unit + 静的確認）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx`
- [x] `npm run check --prefix frontend`（lint/typecheckは通過、既存S-04 DB依存テストが環境I/Oエラーで失敗）
- [x] `git diff --name-only`
