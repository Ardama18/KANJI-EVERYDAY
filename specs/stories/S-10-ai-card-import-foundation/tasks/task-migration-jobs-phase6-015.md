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

- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-jobs.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/fixtures/pre-s10-seed.sql`（既存frozen fixtureを変更せず利用）
- [x] `frontend/package.json`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-MIGRATION-01〜05`と`E2E-MIGRATION-01〜03`を独立job前提の失敗テストへ置換する。
- [x] job marker/database name/connection stringが相互に異なり、未指定URLや同一DB使い回しを拒否するassertを入れる。

```bash
npm --prefix frontend run test:s10:fresh
npm --prefix frontend run test:s10:upgrade
npm --prefix frontend run test:s10:failure
```

### 2. Green Phase

- [x] freshは空DB→全migration→更新Seed→IT-MIGRATION-01→AC-01〜09 smoke→E2E-MIGRATION-01を実行する。
- [x] upgradeは旧migration→frozen Seed→baseline→S-10 migration→更新Seed再実行→IT-MIGRATION-02〜04→smoke→E2E-MIGRATION-02を実行する。
- [x] failure jobはnormalization/backfill/index/table/RLS各failpoint→IT-MIGRATION-05→E2E-MIGRATION-03を個別transactionで実行する。
- [x] baselineは旧keyを別記録し、一般snapshot（ID/本文/skill/pattern/deck関連/件数）は差分0、新keyは個別SHA-256期待値、Seed再実行後差分0を確認する。
- [x] job終了時に自身のDBだけをdropし、他jobのdatabase/container/connectionを触らない。

### 3. Refactor Phase

- [x] 共通AC smokeを3 jobから再利用し、期待値やmigration SQLをtestへ複製しない。
- [x] 3 jobを順不同/並行で実行しても結果が同じことを確認する。

```bash
npm --prefix frontend run test:s10:fresh &
npm --prefix frontend run test:s10:upgrade &
npm --prefix frontend run test:s10:failure &
wait
```

## 完了条件

- [x] DB Integration 62/62件が実テスト化され、`IT-MIGRATION-01〜05`が各専用DBでPASSする。
- [x] migration Contract E2E 3/3件が各job内でPASSする。
- [x] fresh/upgrade/failureが相互の実行順・状態へ依存しない。
- [x] 一般Seed snapshot差分0、新key期待値一致、Seed再実行後key差分0である。
- [x] 全failpointでschema/constraint/data/keyが適用前snapshotへ戻る。
- [x] 動作確認レベルL3（migration経路）を満たす。

## 注意事項

- 同一DBをresetして3 jobへ使い回さない。fallback URLも禁止する。
- E2E-CONTRACT-01〜10は次タスクまでTODOのまま維持する。

## 実行結果（2026-07-14）

- Red: migration 8件をTODOから実テストへ置換し、`npm run typecheck`が未実装のjob/snapshot/failpoint helper export（TS2305/TS2724）で失敗することを確認した。
- URL guard: `S10_FRESH_DATABASE_URL` / `S10_UPGRADE_DATABASE_URL` / `S10_FAILURE_DATABASE_URL`を全必須とし、未指定、同一connection string、queryだけ異なる同一database name、既存database再利用をprovision前に拒否する。
- lifecycle: 各npm scriptは別processで、自身の専用DBを`template0`からcreateし、Supabase最小contractをbootstrapして試験し、成功・失敗にかかわらず`finally`で自身のDBだけを`DROP DATABASE ... WITH (FORCE)`する。
- fresh: 全migration chainと更新Seedを適用し、既存DB Integration 56件 + `IT-MIGRATION-01`の57件がPASS、`E2E-MIGRATION-01`がPASSした。
- upgrade: 旧migration + frozen pre-S10 Seedから一般snapshot/旧keyを別記録し、S-10 forward migration後と更新Seed再実行後を比較した。`IT-MIGRATION-02〜04` 3件、`E2E-MIGRATION-02` 1件がPASSし、一般snapshot差分0、新key全件DB SHA-256再計算一致、Seed再実行後general/key差分0だった。
- failure: repositoryのmigration SQLを直接読み、normalization、collision/backfill準備、key/index、import table、RLS/grant完了の5区間へ失敗を注入した。各migration transaction失敗後にcolumns/constraints/indexes/policies/Seed一般値/key snapshotがbaselineへ完全一致し、`IT-MIGRATION-05`と`E2E-MIGRATION-03`がPASSした。RLS区間だけtest harnessが最終`COMMIT`直前へfailpointを注入し、production migrationは変更していない。
- 合算DB Integrationは62/62件、migration Contract E2Eは3/3件PASS。3 jobの同時並行実行もexit 0で、相互に異なるDB/connectionを維持した。
- 回帰: S-10 Unit 32/32、非DB 161/161、`npm run lint`、`npm run typecheck`、検証用Supabase環境変数を明示した`npm run build`がPASSした。buildは既存middleware matcher警告のみ。
- E2E-CONTRACT-01〜10はTask 016までTODOのまま変更していない。

## 独立quality review（2026-07-14）

- `/quality-fixer frontend`: `status=approved`。対象差分はTask015の6ファイルだけで、テストの削除・skip化・weak assertion追加はない。
- URL guard Red: path上は専用DBでも`?dbname=postgres`を付けるとselectionを通過し、実`psql`が`postgres`へ接続することを再現した。`?host=...`を含むconnection identity上書きもselectionを通過していた。
- URL guard Green: `dbname` / `host` / `hostaddr` / `port` / `user` / `password` / `service` query parameterをprovision前に拒否するよう修正した。PostgreSQL identifier上限63文字、postgres/template 3種、SQL identifier injection、同一URL、queryだけ異なる同一DB名の拒否もassertし、pure URL probeでPASSした。
- lifecycle監査: 既存DB確認後だけ`CREATE DATABASE ... TEMPLATE template0`を実行し、作成成功後のbootstrap/migration/test途中失敗は`finally`から自身のquoted database nameだけをforce dropする。URL/SQL値はargv、strict database-name regex、identifier quote、literal escapeを使い、migration/seedはrepository原文を`-f`で利用する。各npm jobと各Vitestは別process、各queryは別`psql` connectionである。
- failure監査: production migration原文を利用する5 failpointを維持し、最終RLS区間だけtest harnessが原文の最終`COMMIT`直前へfailpointを注入する。rollback snapshotをcolumns/constraints/indexes/policies/data/keyに加え、schema owner/ACL、relation RLS/ACL、function定義/owner/ACL/search config、trigger、collationまで拡張した。拡張catalog SQLは実DBで構文・評価PASS。
- upgrade監査: general snapshotは公開cardのID/本文/skill/pattern/illustration、deck、relation、件数を比較し、key snapshotは全公開cardのID/keyを比較する。さらに100件すべてをDB helperとは独立したTypeScript NFKC/SHA-256実装で再計算し、個別期待値一致を検証する。
- test pattern監査: `vitest list`の実測はfresh 58件（既存57 + MIGRATION-01）、upgrade 3件、failure 1件で、合算62件・重複0。E2Eはfresh 11件（通常10 + MIGRATION-01）、upgrade 1件、failure 1件で合算13件・重複0。
- 3 job/並行実行はtask-executor証跡で全exit 0、DB Integration 62/62、migration E2E 3/3。品質担当sandboxでのfresh再実走は`vite-node`配下の子`psql`接続制約によりprovision前admin queryで停止したため、新規修正はpure URL probe、実`psql` redirect再現、catalog SQL probe、compile/lintで補完した。
- URL guard・snapshot・独立SHA-256照合の修正後、primary agent環境で3 jobを再実走した。fresh 58件 + E2E 11件、upgrade 3件 + E2E 1件、failure 1件 + E2E 1件がすべてPASSし、各runnerは専用DBのdropを完了してexit 0となった。
- 回帰: S-10 Unit 32/32、非DB 161/161、lint（90 files）、typecheck、必要envを明示したproduction build、`git diff --check`がPASS。buildは既存middleware matcher警告のみ。
