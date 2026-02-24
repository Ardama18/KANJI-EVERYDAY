# タスク: Storageアップロードと生成オーケストレーションを完成させる

メタ情報:
- ストーリー: S-08-illustration-generation-backend
- フェーズ: 2
- 依存: `specs/stories/S-08-illustration-generation-backend/tasks/task-illustration-generation-backend-phase2-003.md`
- 提供成果物:
  - `frontend/src/lib/illustration/storage.ts`
  - `frontend/src/lib/illustration/generator.ts`
  - `frontend/src/lib/illustration/generator.test.ts`
  - `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`（IT-AC02/08/09/10/11/14 実装）
- 関連AC: AC-02, AC-08, AC-10, AC-11（+ AC-09/14回帰）
- サイズ: 標準（4-10ファイル）

## 実装内容
Storage object key を `{user_id}/{illustration_id}.png` 形式で生成し、`processIllustrationGeneration` の成功/失敗収束（`ready/failed`）を実装する。APIキー未設定時 fail-safe、Gemini/Storage失敗時理由記録を含め、Phase 2対象統合テストを合格させる。

## 対象ファイル
- [ ] `frontend/src/lib/illustration/storage.ts`
- [ ] `frontend/src/lib/illustration/generator.ts`
- [ ] `frontend/src/lib/illustration/generator.test.ts`
- [ ] `specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts`

## テスト観点
- Unit:
  - object key が常に `{user_id}/{illustration_id}.png`
  - APIキー未設定時に外部API呼び出し0回 + failed収束
  - 生成成功時 `ready` + `storage_path/prompt/model_info` 更新
  - Gemini/Storage失敗時 `failed` + 理由記録
- Integration:
  - `IT-AC02`, `IT-AC08`, `IT-AC09`, `IT-AC10`, `IT-AC11`, `IT-AC14`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `generator.test.ts` に成功系/失敗系/APIキー未設定ケースの失敗テストを追加する。
- [ ] `illustration-generation-backend.int.test.ts` の `IT-AC02/08/09/10/11/14` を失敗テストへ変更する。
- [ ] 失敗を確認する。

```bash
npm run test --prefix frontend -- src/lib/illustration/generator.test.ts
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC02|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC14"
```

### 2. Green Phase
- [ ] `storage.ts` で `{user_id}/{illustration_id}.png` パス生成とアップロード処理を実装する。
- [ ] `generator.ts` で prompt -> Gemini -> Storage -> DB更新の処理を実装する。
- [ ] APIキー未設定時の fail-safe と `model_info.reason` 記録を実装する。
- [ ] Unit/IntegrationのPhase 2対象テストを通す。

```bash
npm run test --prefix frontend -- src/lib/illustration/generator.test.ts
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC02|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC14"
```

### 3. Refactor Phase
- [ ] generator内の例外ハンドリングとreasonマッピングを整理する。
- [ ] Storage path builder を単一責務に保ち、再利用点を明確化する。
- [ ] Phase 2対象テストを再実行して回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/lib/illustration/generator.test.ts
npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC02|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC14"
```

## 完了条件
- [ ] AC-02/08/10/11 を満たす実装とテストが揃っている。
- [ ] Phase 2対象統合テスト `IT-AC02/08/09/10/11/14` がPASSしている。
- [ ] APIキー未設定時に外部API呼び出し0回で `failed` 収束する。
- [ ] Storage key が `{user_id}/{illustration_id}.png` で固定されている。
- [ ] Phase 2 完了チェック（対象AC + 対象統合テストPASS）が本タスク内で完結している。
- [ ] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/lib/illustration/generator.test.ts`
- [ ] `npm run test --prefix frontend -- ../specs/stories/S-08-illustration-generation-backend/tests/illustration-generation-backend.int.test.ts -t "IT-AC02|IT-AC08|IT-AC09|IT-AC10|IT-AC11|IT-AC14"`
- [ ] `git diff --name-only`
