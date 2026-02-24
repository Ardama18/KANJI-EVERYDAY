# タスク: getIllustrationUrl の最新ready決定規則を固定する

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 3
- 依存: `specs/stories/S-08-illustration-generation-backend/tasks/task-illustration-generation-backend-phase2-004.md`
- 提供成果物:
  - `frontend/src/actions/illustration-actions.ts`
  - `frontend/src/actions/illustration-actions.test.ts`
  - `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`（IT-AC12/13 実装 + 全件回帰）
  - `specs/stories/S-08-illustration-generation-backend/tests/s08-traceability.md`
- 関連AC: AC-12, AC-13
- サイズ: 標準（4-10ファイル）

## 実装内容
`getIllustrationUrl(illustrationKey)` に owner + key + `ready` + `storage_path IS NOT NULL` 条件を実装し、`updated_at DESC, id DESC` で最新1件を選択する。条件一致なしでは `null` を返す。Phase 3対象統合テストに加え統合テスト全件回帰を実施し、トレーサビリティを更新する。

## 対象ファイル
- [ ] `frontend/src/actions/illustration-actions.ts`
- [ ] `frontend/src/actions/illustration-actions.test.ts`
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/s08-traceability.md`

## テスト観点
- Unit:
  - latest-ready 1件選択（`updated_at DESC, id DESC`）
  - `expiresIn=3600` のSigned URL生成
  - 条件一致なしで `null` 返却
- Integration:
  - `IT-AC12`, `IT-AC13`
  - `illustration-generation-backend.int.test.ts` 全件回帰

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `illustration-actions.test.ts` に tie-break/`null` 返却の失敗テストを追加する。
- [ ] `illustration-generation-backend.int.test.ts` の `IT-AC12/13` を失敗テストへ変更する。
- [ ] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-12|AC-13"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC12|IT-AC13"
```

### 2. Green Phase
- [ ] `getIllustrationUrl` の絞り込み・並び順・Signed URL生成を実装する。
- [ ] tie-break観点のUnit/Integrationを通す。
- [ ] `s08-traceability.md` に AC-12/13 の実装・テスト対応を追記する。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-12|AC-13"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC12|IT-AC13"
```

### 3. Refactor Phase
- [ ] クエリ条件とソート規則を定数化し、可読性を向上させる。
- [ ] 統合テスト全件を再実行し、Phase 1〜3回帰がないことを確認する。
- [ ] `s08-traceability.md` の表記ゆれを解消する。

```bash
npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-12|AC-13"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC12|IT-AC13"
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts
```

## 完了条件
- [ ] AC-12（latest-ready 1件 + Signed URL 3600秒）を満たす。
- [ ] AC-13（条件一致なしで `null`）を満たす。
- [ ] `IT-AC12/13` がPASSしている。
- [ ] 統合テスト全件再実行で退行がない。
- [ ] `s08-traceability.md` が AC-12/13 を追跡可能に更新されている。
- [ ] Phase 3 完了チェック（対象AC + 対象統合テストPASS + 統合全件回帰）が本タスク内で完結している。
- [ ] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/actions/illustration-actions.test.ts -t "AC-12|AC-13"`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC12|IT-AC13"`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`
- [ ] `git diff --name-only`
