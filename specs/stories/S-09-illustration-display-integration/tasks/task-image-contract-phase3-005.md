# タスク: 画像設定と静的契約を固定する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 3
- 依存: `specs/stories/S-09-illustration-display-integration/tasks/task-cardback-integration-phase2-004.md`
- 提供成果物:
  - `frontend/next.config.mjs`
  - `frontend/vitest.config.ts`
  - `frontend/src/components/study/IllustrationDisplay.test.tsx`
  - `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- 関連AC: AC-18, AC-19
- サイズ: 標準（4-10ファイル）

## 実装内容
`frontend/next.config.mjs` を作成し、`https://*.supabase.co/storage/v1/object/sign/**` を `images.remotePatterns` に許可する。`next.config.ts` は非対象として変更しない。`<Image>` props契約（`priority` 未使用、`width/height/sizes` 明記、遅延読込維持）を静的テストで固定し、Phase 1〜3統合テストを再実行して退行を確認する。

## 対象ファイル
- [ ] `frontend/next.config.mjs`
- [ ] `frontend/vitest.config.ts`
- [ ] `frontend/src/components/study/IllustrationDisplay.test.tsx`
- [ ] `specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`

## テスト観点
- Static contract:
  - `remotePatterns` に `*.supabase.co` + `/storage/v1/object/sign/**` が設定される（AC-18）
  - `<Image>` が `priority` を使わず、`width/height/sizes` を保持する（AC-19）
- Integration regression:
  - `illustration-display-integration.int.test.ts` 全件

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `IllustrationDisplay.test.tsx` に `<Image>` props契約の失敗テストを追加する。
- [ ] `next.config.mjs` の remotePatterns 契約を静的に検証する失敗テストを追加する（既存テストファイルに統合可）。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
```

### 2. Green Phase
- [ ] `frontend/next.config.mjs` を新規作成し、Supabase署名URL向け `remotePatterns` を設定する。
- [ ] `frontend/vitest.config.ts` を必要最小限更新し、story配下テスト実行経路を維持する。
- [ ] `<Image>` props契約のテストを通過させる。
- [ ] 統合テスト全件を再実行してPhase 1〜3の退行がないことを確認する。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

### 3. Refactor Phase
- [ ] 設定値・テスト名を契約用語（AC-18/19）へ統一する。
- [ ] 統合テストを再実行して最終状態を固定する。

```bash
npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts
```

## 完了条件
- [ ] AC-18/19 の静的契約がテストで追跡可能になっている。
- [ ] `next.config.ts` を変更せず、`next.config.mjs` のみで要件を満たしている。
- [ ] Phase 1〜3 の統合テスト全件がPASSしている。
- [ ] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/components/study/IllustrationDisplay.test.tsx`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts`
- [ ] `git diff --name-only`
