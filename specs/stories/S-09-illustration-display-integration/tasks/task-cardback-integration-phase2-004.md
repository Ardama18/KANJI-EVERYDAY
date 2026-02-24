# タスク: CardBack 表示統合とPhase2検証を完了する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 2
- 依存: `specs/stories/S-09-illustration-display-integration/tasks/task-illustration-display-phase2-003.md`
- 提供成果物:
  - `frontend/src/components/study/CardBack.tsx`
  - `frontend/src/components/study/CardBack.test.tsx`
  - `frontend/src/components/study/RatingButtons.test.tsx`
  - `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- 関連AC: AC-11, AC-16, AC-17, AC-20
- サイズ: 標準（4-10ファイル）

## 実装内容
`CardBack` の固定プレースホルダを除去し、`IllustrationDisplay` 呼び出しへ置換する。front表示ではイラストDOMを常に0件に保ち、画像fallback時でも `RatingButtons` で評価操作が継続できることを保証する。`IT-AC11` を同phaseで具体化し、追加API呼び出しなし契約を固定する。

## 対象ファイル
- [ ] `frontend/src/components/study/CardBack.tsx`
- [ ] `frontend/src/components/study/CardBack.test.tsx`
- [ ] `frontend/src/components/study/RatingButtons.test.tsx`
- [ ] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`

## テスト観点
- Unit:
  - front表示でイラスト関連DOMが0件（AC-17）
  - back表示で `IllustrationDisplay` の状態別描画が連携する
  - fallback表示中でも `onRate` が実行可能（AC-16）
- Integration:
  - `IT-AC11`（reveal応答のみで裏面分岐し、追加API呼び出し0回）
- Manual UI (`ui_design: none`):
  - 表面非表示 / 裏面状態別表示 / fallback時の評価導線継続を確認

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `CardBack.test.tsx` にfront非表示とback表示連携の失敗テストを追加する。
- [ ] `RatingButtons.test.tsx` にfallback時の評価継続テストを追加する。
- [ ] `illustration-display-integration.int.test.ts` に `IT-AC11` の失敗ケースを追加する。

```bash
npm run test --prefix frontend -- src/components/study/CardBack.test.tsx
npm run test --prefix frontend -- src/components/study/RatingButtons.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

### 2. Green Phase
- [ ] `CardBack.tsx` を `IllustrationDisplay` 呼び出し構成へ置換する。
- [ ] fallback時も評価ボタンが活性のまま動作するよう連携する。
- [ ] `IT-AC11` を通過させ、追加API呼び出し0回を確認する。

```bash
npm run test --prefix frontend -- src/components/study/CardBack.test.tsx
npm run test --prefix frontend -- src/components/study/RatingButtons.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

### 3. Refactor Phase
- [ ] `CardBack` の表示責務を整理し、固定プレースホルダ由来の不要コードを削除する。
- [ ] unit/integration を再実行して回帰なしを確認する。
- [ ] `ui_design: none` の手動確認結果を作業ログへ記録する。

```bash
npm run test --prefix frontend -- src/components/study/CardBack.test.tsx
npm run test --prefix frontend -- src/components/study/RatingButtons.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

## 完了条件
- [ ] AC-16/17/20 を unit/integration で追跡できる。
- [ ] `IT-AC11` がPASSしている。
- [ ] 手動UI確認（表面非表示・裏面表示・fallback時評価継続）が完了している。
- [ ] Phase 2停止ポイント（UI単体 + 対象統合テストPASS）を満たしている。
- [ ] 動作確認レベル L2（対象Unit + Integration + 手動UI確認）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/components/study/CardBack.test.tsx`
- [ ] `npm run test --prefix frontend -- src/components/study/RatingButtons.test.tsx`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- [ ] `git diff --name-only`
