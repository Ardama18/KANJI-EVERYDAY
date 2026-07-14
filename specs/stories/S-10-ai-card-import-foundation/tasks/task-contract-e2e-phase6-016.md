# タスク: Contract E2Eと最終品質・AC証跡を確定する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 6（最終タスク）
- 依存: `tasks/task-migration-jobs-phase6-015.md`
- 提供成果物: E2E-CONTRACT 10件、`s10-traceability.md`、最終quality approved証跡
- 関連AC: AC-01〜10、E2E-CONTRACT-01〜10
- サイズ: 大きめ（最終受入・回帰・証跡）

## 実装内容

adapter相当のpure schema/HMAC入力からQueue非依存DB primitiveと最終DB状態までの10 workflowを実装する。Unit 32、DB Integration 61、Contract E2E 13、独立DB 3 job、既存回帰、lint/typecheck/buildを全て通し、AC/sub-ACと実装/test ID/結果を追跡可能にする。

## 対象ファイル

- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/s10-traceability.md`
- [ ] `frontend/package.json`（最終script調整が必要な場合のみ）
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-contract-e2e-phase6-016.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `E2E-CONTRACT-01〜10`をTODOから実テストへ置換する。
- [ ] owner A/B、Seed同値、app_ai、remote_mcp exempt、upload、finalize duplicate、JST quota、study/edit/reset、delete/undo、lock交差を最終snapshotで検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:e2e -- -t "E2E-CONTRACT"
```

### 2. Green Phase

- [ ] shared schema→canonical hash→preview HMAC→reserve/commit/finalize/fail/management/undoをsystem boundaryとしてworkflowを完走させる。
- [ ] provider/Queue/Storageは起動せず、upload/illustrationは保存済みDB fixtureだけで契約を検証する。
- [ ] 再送/並行/拒否の各caseでcodeだけでなく全table副作用とowner relationをassertする。
- [ ] `s10-traceability.md`へAC-01〜10全sub-AC、requirements/design/ADR、production path、Unit/IT/E2E ID、実行command/resultを記録する。

### 3. Refactor / Final quality gate

- [ ] flakyなsleepを排除し、DB lock/状態待機を有限pollまたはtransaction同期へ置換する。
- [ ] Unit/Integration/E2E 3骨子の未解決`it.todo`が0件であることを検索する。
- [ ] fresh/upgrade/failureを再実行し、通常E2EのDBと共有していないことを確認する。
- [ ] scope reviewで`pgmq|enqueue|provider SDK|Storage operation|app UI|Route Handler|MCP transport`の新規production差分が0件であることを確認する。
- [ ] task-executorから `/quality-fixer frontend` を呼び、全修正後にlint/typecheck/test/buildを再実行して`status=approved`を得る。

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

- [ ] S-10受入Unit 32/32、DB Integration 61/61、Contract E2E 13/13がPASSし、3骨子のTODOが0件である。
- [ ] fresh/upgrade/failure 3 jobが独立してPASSする。
- [ ] AC-01〜10全sub-ACをtest ID・実装・実行結果へ追跡できる。
- [ ] 公開Seed一般項目差分0、新keyは期待値一致かつSeed再実行後差分0である。
- [ ] 全既存test、lint、typecheck、buildがPASSする。
- [ ] Queue/provider/UI/MCP transportのproduction実装が差分にない。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`、動作確認レベルL3である。

## 注意事項

- `/ship`、commit/push、merge、deploy、Issue closeはこのタスクの権限外。
- 品質を通す目的でtest削除/skip/無意味assertionを行わない。

