# タスク: S-10テスト基盤とUnicode正規化契約を実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 1
- 依存: なし
- 提供成果物: 共通fixture、pre-S10 Seed、型付きDB harness/job runner、S-10実行script、`normalize.ts`
- 関連AC: AC-01〜03, AC-10（前提）、UT-NORM-01〜05
- サイズ: 大きめ（9-11ファイル、テスト基盤と最初のproduction slice）

## 実装内容

TypeScript/SQLが共有するUnicode・canonical vectorと、owner A/B/anon/service、複数connection、snapshot、test clock、failpoint、独立DBを扱うS-10 harnessを作る。`S10_TEST_DATABASE_URL`未指定時は既定DBへfallbackせず失敗させる。同じ変更で表示用/重複判定用Unicode正規化を実装し、UT-NORM 5件をTODOから実テストへ置換する。

## 対象ファイル

- [x] `specs/stories/S-10-ai-card-import-foundation/fixtures/unicode-card-key.json`
- [x] `specs/stories/S-10-ai-card-import-foundation/fixtures/canonical-requests.json`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/fixtures/pre-s10-seed.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-jobs.ts`
- [x] `frontend/vitest.config.ts`
- [x] `frontend/package.json`
- [x] `frontend/src/lib/ai-import/normalize.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] fixtureへ固定White_Space全点、U+FEFF、NFKC、case、BMP外、結合文字、U+001F、generation/import差分vectorを定義する。
- [x] `UT-NORM-01〜05`をfixture駆動の失敗テストへ置換する。
- [x] VitestがS-10のUnit/Integration/E2E 3ファイルを検出し、TODO inventoryが32/62/13であることを確認する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-NORM"
npm --prefix frontend run test:s10:inventory
```

### 2. Green Phase

- [x] `normalizeDisplayText`はNFKC→固定White_SpaceのASCII SPACE化→trim/連続圧縮を行いcaseを保持する。
- [x] `normalizeForKey`は表示正規化後だけUnicode lowercaseを適用し、U+FEFFを空白扱いしない。
- [x] harnessは型付きquery/actor/snapshot/parallel connection/test clock/failpointを提供し、secretや本文をerrorへ含めない。
- [x] `test:s10:unit|integration|e2e|fresh|upgrade|failure|inventory`を個別選択可能にし、DB commandはURL未指定時にfail-fastする。
- [x] frozen SeedはS-10前のID・本文・skill・pattern・deck関連・旧keyを再現し、repoの更新Seedと独立させる。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-NORM"
env -u S10_TEST_DATABASE_URL npm --prefix frontend run test:s10:integration
```

### 3. Refactor Phase

- [x] S-02 helperを破壊変更せず、S-10固有actor/job責務をS-10 helperへ閉じる。
- [x] fixtureの期待値をテスト本文へ複製せず、`any`、外部network/provider/Storage起動がないことを確認する。

## 完了条件

- [x] `UT-NORM-01〜05`がPASSし、残るUnit TODOは27件である。
- [x] 固定White_Space全点とU+FEFF非空白、NFKC、case、BMP外/結合文字の結果がfixtureと一致する。
- [x] Unit/Integration/Contract E2Eと3種類のDB jobを別commandで選択できる。
- [x] DB URL未指定時のIntegration/jobがfallback接続せず安全に失敗する。
- [x] `npm --prefix frontend run typecheck`がPASSする。
- [x] 動作確認レベルL2（対象Unit + harness境界）が満たされる。

## 注意事項

- `ai-card-import-foundation.e2e.test.ts`は検出だけ行い、TODOを実テスト化しない。
- Queue/provider/Storage fixtureやstubを起動しない。
