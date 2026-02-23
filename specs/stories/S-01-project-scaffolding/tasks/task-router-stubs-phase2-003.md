# タスク: App Router とスタブ導線ページの追加

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 2
- 依存: `task-bootstrap-phase0-001.md`
- 対応要件: AC3, AC4, AC5
- サイズ: 標準（4-10ファイル）
- 依存成果物: `frontend/src/lib/env.ts`, `frontend/src/lib/supabase/*`

## 実装内容

`frontend/app` に `/`/`/login`/`/decks` の最小スタブ画面を追加し、`/` でナビゲーション導線を返す。必要ならページの文言は後続実装に壊れないプレーンテキストを採用する。

## 対象ファイル
- [x] `frontend/app/layout.tsx`
- [x] `frontend/app/page.tsx`
- [x] `frontend/app/login/page.tsx`
- [x] `frontend/app/decks/page.tsx`
- [x] `frontend/app/globals.css`
- [x] `frontend/src/app/page.test.tsx`
- [x] `frontend/src/app/login/page.test.tsx`
- [x] `frontend/src/app/decks/page.test.tsx`
- [x] `specs/stories/S-01-project-scaffolding/tests/project-scaffolding.int.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] 上記テスト3件を `todo` から失敗テストとして実装
  - `/` が `login` と `decks` のリンクを含む
  - `/login` に「ログイン実装予定」等文言
  - `/decks` に「デッキ一覧実装予定」等文言
- [x] `project-scaffolding.int.test.ts` の AC3/AC4/AC5 を実行対象として明示
- [ ] テスト実行して失敗を確認

### 2. Green Phase
- [x] `frontend/app/layout.tsx` を追加し、`lang`, `metadata`, `viewport` を最小定義
- [x] `frontend/app/page.tsx` でトップ導線を含む表示を実装
- [x] `frontend/app/login/page.tsx` をスタブ表示に実装
- [x] `frontend/app/decks/page.tsx` をスタブ表示に実装
- [x] `frontend/app/globals.css` に最小スタイルを追加
- [ ] 3テストを通す

### 3. Refactor Phase
- [x] スタブ文言を将来差し替えしやすい定数化（必要時）
- [x] 画面構造をシンプルな DOM セレクタで確認しやすい形に微調整
- [ ] 追加テスト再実行で再度 Green を維持

## 完了条件
- [x] `frontend/app/page.tsx` が `/login` と `/decks` への導線を返す
- [x] `frontend/app/login/page.tsx` が壊れないスタブを返す
- [x] `frontend/app/decks/page.tsx` が壊れないスタブを返す
- [ ] `frontend/src/app/*.test.tsx` がすべて通る
- [x] `project-scaffolding.int.test.ts` で AC3/4/5 の実行対象接続

## 動作確認
- [ ] `cd frontend && npx vitest run src/app/page.test.tsx src/app/login/page.test.tsx src/app/decks/page.test.tsx`
- [ ] `cd frontend && npx vitest run --reporter=dot src/app/page.test.tsx`（出力確認）
