# タスク: migration Integrationと独立DB 3 jobを実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 6
- 依存: `tasks/task-database-types-phase5-014.md`（全production実装 + Phase 5 quality approved）
- 提供成果物: IT-MIGRATION 5件、fresh/upgrade/failure job、E2E-MIGRATION 3件
- 関連AC: AC-03, AC-10、IT-MIGRATION-01〜05、E2E-MIGRATION-01〜03
- サイズ: 大きめ（isolated DB job vertical slice）

## 実装内容

migration断面5件を実テスト化し、fresh、pre-S10 seeded upgrade、区間別failure-injectionを別process・別database・別connection stringでprovision/run/dropする。Phase 6に入ったためmigration Contract E2E 3件を初めてTODOから実テスト化し、各job内でAC-01〜09 smokeをQueue/providerなしで実行する。

## 対象ファイル

- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-jobs.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/fixtures/pre-s10-seed.sql`
- [ ] `frontend/package.json`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-MIGRATION-01〜05`と`E2E-MIGRATION-01〜03`を独立job前提の失敗テストへ置換する。
- [ ] job marker/database name/connection stringが相互に異なり、未指定URLや同一DB使い回しを拒否するassertを入れる。

```bash
npm --prefix frontend run test:s10:fresh
npm --prefix frontend run test:s10:upgrade
npm --prefix frontend run test:s10:failure
```

### 2. Green Phase

- [ ] freshは空DB→全migration→更新Seed→IT-MIGRATION-01→AC-01〜09 smoke→E2E-MIGRATION-01を実行する。
- [ ] upgradeは旧migration→frozen Seed→baseline→S-10 migration→更新Seed再実行→IT-MIGRATION-02〜04→smoke→E2E-MIGRATION-02を実行する。
- [ ] failure jobはnormalization/backfill/index/table/RLS各failpoint→IT-MIGRATION-05→E2E-MIGRATION-03を個別transactionで実行する。
- [ ] baselineは旧keyを別記録し、一般snapshot（ID/本文/skill/pattern/deck関連/件数）は差分0、新keyは個別SHA-256期待値、Seed再実行後差分0を確認する。
- [ ] job終了時に自身のDBだけをdropし、他jobのdatabase/container/connectionを触らない。

### 3. Refactor Phase

- [ ] 共通AC smokeを3 jobから再利用し、期待値やmigration SQLをtestへ複製しない。
- [ ] 3 jobを順不同/並行で実行しても結果が同じことを確認する。

```bash
npm --prefix frontend run test:s10:fresh &
npm --prefix frontend run test:s10:upgrade &
npm --prefix frontend run test:s10:failure &
wait
```

## 完了条件

- [ ] DB Integration 61/61件が実テスト化され、`IT-MIGRATION-01〜05`が各専用DBでPASSする。
- [ ] migration Contract E2E 3/3件が各job内でPASSする。
- [ ] fresh/upgrade/failureが相互の実行順・状態へ依存しない。
- [ ] 一般Seed snapshot差分0、新key期待値一致、Seed再実行後key差分0である。
- [ ] 全failpointでschema/constraint/data/keyが適用前snapshotへ戻る。
- [ ] 動作確認レベルL3（migration経路）を満たす。

## 注意事項

- 同一DBをresetして3 jobへ使い回さない。fallback URLも禁止する。
- E2E-CONTRACT-01〜10は次タスクまでTODOのまま維持する。

