# タスク: SRS契約基盤とPhase0統合テストを固定する

メタ情報:
- ストーリー: S-05-srs-engine
- フェーズ: 0
- 依存: なし
- 提供成果物:
  - `frontend/src/lib/srs/constants.ts`
  - `frontend/src/lib/srs/types.ts`
  - `frontend/src/lib/srs/index.ts`
  - `frontend/vitest.config.ts`
  - `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`（`IT-AC01`, `IT-AC02` 実装）
- 関連AC: AC#1, AC#2
- サイズ: 標準（4-10ファイル）

## 実装内容
SRS公開契約の最小境界（定数・型・再エクスポート）を確定し、S-05ストーリーテストが `frontend` のテスト実行経路で起動する状態を作る。Phase 0対象統合テスト `IT-AC01` / `IT-AC02` を同コミットでPASSさせ、以降Phaseの前提を固定する。

## 対象ファイル
- [x] `frontend/src/lib/srs/constants.ts`
- [x] `frontend/src/lib/srs/types.ts`
- [x] `frontend/src/lib/srs/index.ts`
- [x] `frontend/vitest.config.ts`
- [x] `specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts`

## テスト観点
- Integration:
  - `IT-AC01`: `GOOD_INTERVALS` / `HARD_INTERVALS` / `RETRY_TODAY_LIMIT` 公開値の固定
  - `IT-AC02`: `Rating = good | hard | again` 契約の固定

## 実装手順（TDD: Red-Green-Refactor）
### 1. Red Phase
- [x] `srs-engine.int.test.ts` の `IT-AC01` / `IT-AC02` を `it.todo` から失敗テストへ変更する。
- [x] `frontend/vitest.config.ts` 未設定時に S-05 テストが実行対象外になることを確認する。
- [x] 期待どおり失敗することを確認する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC01|IT-AC02"
```

### 2. Green Phase
- [x] `constants.ts` に仕様値を定義し、`types.ts` に `Rating` 契約を定義する。
- [x] `index.ts` から定数・型を再エクスポートする。
- [x] `frontend/vitest.config.ts` に S-05 ストーリーテストパスを追加する。
- [x] `IT-AC01` / `IT-AC02` がPASSするまで実装を調整する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC01|IT-AC02"
```

### 3. Refactor Phase
- [x] 定数名と公開API境界（`index.ts`）を整理し、外部公開面を最小化する。
- [x] 不要exportや重複型定義がないことを確認する。
- [x] Phase 0対象テストを再実行し回帰がないことを確認する。

```bash
npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC01|IT-AC02"
```

## 品質チェック
- [x] `npm run test --prefix frontend -- ../specs/stories/S-05-srs-engine/tests/srs-engine.int.test.ts -t "IT-AC01|IT-AC02"`
- [x] `npm run typecheck --prefix frontend`
- [x] `git diff --name-only` が想定対象ファイルに限定される

## 完了条件
- [x] AC#1, AC#2 を満たす統合テストがPASSしている。
- [x] `frontend/vitest.config.ts` から S-05 ストーリーテストを実行できる。
- [x] 定数・型の公開境界が `index.ts` で固定されている。
- [x] 動作確認レベル L2（対象Integration + 型チェック）を満たす。
