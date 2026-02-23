# タスク: frontend 開発基盤設定（tsconfig / biome / vitest / scripts）

メタ情報:
- ストーリー: S-01-project-scaffolding
- フェーズ: 3
- 依存: `task-bootstrap-phase0-001.md`
- 対応要件: strict有効化、paths alias、Vitest設定、検証系コマンド定義
- サイズ: 標準（4-10ファイル）
- 依存成果物: `frontend/package.json`

## 実装内容

`frontend/tsconfig.json`、`frontend/biome.json`、`frontend/vitest.config.ts`、`frontend/package.json` を整備し、`@/*` エイリアス、Tailwind/Biome/Vitest の起動基盤を確立する。

## 対象ファイル
- [x] `frontend/tsconfig.json`
- [x] `frontend/biome.json`
- [x] `frontend/vitest.config.ts`
- [x] `frontend/package.json`
- [ ] `frontend/src/vitest-setup.ts`（必要に応じて追加）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `frontend` の構成ファイルを不足状態としてテスト/型/リンターの失敗を確認
- [ ] `src/**/*.test.ts` / `src/**/*.test.tsx` が未検知となる既定実行条件を再現
- [ ] `@/*` エイリアスが未定義の import で解決エラーになることを確認

### 2. Green Phase
- [x] `frontend/tsconfig.json` を strict true、`baseUrl` と `paths` を `@/* -> ./src/*` へ設定
- [x] `frontend/biome.json` を追加し、lint/format の基本ルールを最小構成で有効化
- [x] `frontend/vitest.config.ts` を追加  
  - `src/**/*.test.ts`, `src/**/*.test.tsx` をテスト対象
  - `@/*` エイリアス解決を設定
- [x] `frontend/package.json` の script を `typecheck`, `lint`, `test`, `test:watch`, `build` などへ追加

### 3. Refactor Phase
- [x] `tsconfig` と `vitest.config` の重複設定を整理して一貫化
- [x] `package.json` の scripts を将来追加しやすい順序（check, lint, test）へ整形
- [ ] 変更後に最小コマンドを再実行し通過を確認

## 完了条件
- [x] `frontend/tsconfig.json` の `strict` が true
- [x] `@/*` の alias が `./src/*` に解決される
- [x] `frontend/vitest.config.ts` が `src/**/*.test.ts*` を拾える
- [x] `frontend/package.json` に lint/typecheck/test/build 実行が明記される

## 動作確認
- [ ] `cd frontend && npx tsc --noEmit`
- [ ] `cd frontend && npx biome check .`
- [ ] `cd frontend && npx vitest run`
- [ ] `cd frontend && npx vitest list`（テスト検出を目視）
