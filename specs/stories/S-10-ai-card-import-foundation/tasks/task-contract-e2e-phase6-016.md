# タスク: Contract E2Eと最終品質・AC証跡を確定する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 6（最終タスク）
- 依存: `tasks/task-migration-jobs-phase6-015.md`
- 提供成果物: E2E-CONTRACT 10件、`s10-traceability.md`、最終quality approved証跡
- 関連AC: AC-01〜10、E2E-CONTRACT-01〜10
- サイズ: 大きめ（最終受入・回帰・証跡）

## 実装内容

adapter相当のpure schema/HMAC入力からQueue非依存DB primitiveと最終DB状態までの10 workflowを実装する。Unit 32、DB Integration 62、Contract E2E 13、独立DB 3 job、既存回帰、lint/typecheck/buildを全て通し、AC/sub-ACと実装/test ID/結果を追跡可能にする。

## 対象ファイル

- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-contract-workflow.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/s10-traceability.md`
- [x] `frontend/package.json`（既存scriptで全gateを実行できるため変更不要）
- [x] `specs/stories/S-10-ai-card-import-foundation/tasks/task-contract-e2e-phase6-016.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `E2E-CONTRACT-01〜10`をTODOから実テストへ置換する。
- [x] owner A/B、Seed同値、app_ai、remote_mcp exempt、upload、finalize duplicate、JST quota、study/edit/reset、delete/undo、lock交差を最終snapshotで検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:e2e -- -t "E2E-CONTRACT"
```

### 2. Green Phase

- [x] shared schema→canonical hash→preview HMAC→reserve/commit/finalize/fail/management/undoをsystem boundaryとしてworkflowを完走させる。
- [x] provider/Queue/Storageは起動せず、upload/illustrationは保存済みDB fixtureだけで契約を検証する。
- [x] 再送/並行/拒否の各caseでcodeだけでなく全table副作用とowner relationをassertする。
- [x] `s10-traceability.md`へAC-01〜10全sub-AC、requirements/design/ADR、production path、Unit/IT/E2E ID、実行command/resultを記録する。

### 3. Refactor / Final quality gate

- [x] flakyなsleepを排除し、DB lock/状態待機をtransaction完了・複数connection完了で同期する。
- [x] Unit/Integration/E2E 3骨子の未解決`it.todo`が0件であることを検索する。
- [x] fresh/upgrade/failureを再実行し、通常E2EのDBと共有していないことを確認する。
- [x] scope reviewで`pgmq|enqueue|provider SDK|Storage operation|app UI|Route Handler|MCP transport`の新規production差分が0件であることを確認する。
- [x] task-executorから `/quality-fixer frontend` を呼び、全修正後にlint/typecheck/test/buildを再実行して`status=approved`を得る。

```bash
npm --prefix frontend run test:s10:unit
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:e2e
npm --prefix frontend run test:s10:fresh
npm --prefix frontend run test:s10:upgrade
npm --prefix frontend run test:s10:failure
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
rg -n "it\\.todo|test\\.todo" specs/stories/S-10-ai-card-import-foundation/tests/*.ts
git diff --name-only
```

## 完了条件

- [x] S-10受入Unit 32/32、DB Integration 62/62、Contract E2E 13/13がPASSし、3骨子のTODOが0件である。
- [x] fresh/upgrade/failure 3 jobが独立してPASSする。
- [x] AC-01〜10全sub-ACをtest ID・実装・実行結果へ追跡できる。
- [x] 公開Seed一般項目差分0、新keyは期待値一致かつSeed再実行後差分0である。
- [x] 全既存test、lint、typecheck、buildがPASSする。
- [x] Queue/provider/UI/MCP transportのproduction実装が差分にない。
- [x] `/quality-fixer frontend`の構造化結果が`status=approved`、動作確認レベルL3である。

## 注意事項

- `/ship`、commit/push、merge、deploy、Issue closeはこのタスクの権限外。
- 品質を通す目的でtest削除/skip/無意味assertionを行わない。

## 実行結果（2026-07-14）

- Red: E2E-CONTRACT-01〜10を実テストへ置換後、`npm run typecheck`が未実装の`helpers/s10-contract-workflow` importでexit 2となることを確認した。
- Green: shared schema、generation/import canonical SHA-256、preview HMAC署名/検証、quota予約、commit、保存済みupload/illustration fixture、finalize、management/undo、全table snapshotを共有helperへ実装した。provider、Queue、Storage API、UI、Route、MCP transportは起動・追加していない。
- Contract: 通常DBでE2E-CONTRACT 10/10 PASS。owner A/B、公開Seed同値、app_ai並行冪等、remote_mcp exempt、upload consumed、finalize duplicate、JST card 200/image 50、active guard/review、tombstone/undo、commit/finalize/session/undo/direct DML/relation lock交差を検証した。
- S-10 inventory: Unit 32/32 PASS。DB Integrationは通常57件と独立job 5件の合算62/62 PASS。Contract E2Eは通常10件と独立job 3件の合算13/13 PASS。`it.todo|test.todo`は3骨子で0件。
- 独立job: freshはIntegration 58件 + E2E 11件（通常10 + MIGRATION 1）、upgradeはIntegration 3件 + E2E-MIGRATION 1件、failureはIntegration 1件 + E2E-MIGRATION 1件がPASSし、各専用DBをdropした。
- 全回帰: Vitest inventory 446件（47 files）。`S10_TEST_DATABASE_URL`を明示して1 workerで実行し、通常438/438 PASS、この通常runでは独立job条件付き8件skip、exit 0、Duration 31.08s。条件付き8件は独立fresh/upgrade/failure jobで8/8 PASSした。初回の全並列実行ではsandboxの同時DB接続が`Operation not permitted`となったため、test内容を変えずworker数だけ1へ固定して再実行した。
- 静的品質: lint（91 files）、typecheck、production build、`git diff --check`がPASS。buildは既存middleware matcher警告のみ。
- scope: production差分0。変更はContract E2E、test-only workflow helper、traceability、本task証跡だけである。
- 独立quality review: `/quality-fixer frontend` で全10 workflowをAC/sub-AC、owner/RLS、HMAC/hash/reservation連結、JST quota再送、active guard、tombstone/undo、lock交差、cleanupの観点から再監査した。全public Seed snapshot、改ざん時全副作用0、upload/storage owner、batch/item終端集計、同一key再送、全active guard、実tag関係変更のreview keep、cleanup marker差分/反復、lock最終snapshotを補強した。
- quality Green: 補強後の修正対象 `E2E-CONTRACT-06/08/10` は3/3 PASS、通常Contract E2Eは10/10 PASS（migration条件付き3 skip）、exit 0、Duration 3.59s。E2E-CONTRACT-09のcleanup 2回後readbackもbatch/reservation/card/deck/tag/illustration/upload/storage object残留0でPASSした。lint（90 files）、typecheck、Unit 32/32、Supabase検証用envを明示したproduction build、`git diff --check`もPASS。
- quality判定: `status=approved`、動作確認レベルL3。test削除/skip/無意味assertion、production差分、commit/pushは0。
- 最終review修正後: internal context解除、Unicode/UUID/Stage 1 parity、Seed private key分離、quota cleanup/state遷移、lock試験を補強し、fresh 58/58 + E2E 11/11、upgrade 3/3 + E2E 1/1、failure 1/1 + E2E 1/1、非DB 354/354、lint（91 files）、typecheck、production buildがPASSした。共有DBを直接使う既存S-04 9ケースの同時再実行のみsandbox接続`EPERM`だったが、変更したSeed再実行契約はupgrade専用DBの実Seed試験でPASSした。
