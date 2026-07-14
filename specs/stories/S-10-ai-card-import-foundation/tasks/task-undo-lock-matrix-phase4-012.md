# タスク: undo_importと全経路lock matrixを実装しPhase 4品質ゲートを通す

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 4（最終タスク）
- 依存: `tasks/task-card-management-phase4-011.md`
- 提供成果物: `undo_import`、共通lock helper、IT-UNDO残3件、IT-LOCK-01、Phase 4 approved証跡
- 関連AC: AC-04, AC-05, AC-07〜09、IT-UNDO-01/03/04、IT-LOCK-01
- サイズ: 大きめ（undo + concurrency regression）

## 実装内容

batch由来card/relation/tag/auto deckを単一transactionで取り消し、edited/active batchを全体拒否、deleted tombstoneをskip、再undoを保存済み結果で冪等化する。同時にcommit/reserve/finalize/fail/undo/session/direct DML/relation RPCの全経路をDesignの単一lock matrixへ統一する。

## 対象ファイル

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-undo-lock-matrix-phase4-012.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-UNDO-01/03/04`と`IT-LOCK-01`を実テストへ置換する。
- [ ] non-owner/edited/active、再undo、auto deck空/非空、全経路並行交差を前後snapshotで検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-UNDO|IT-LOCK"
```

### 2. Green Phase

- [ ] auth.uid()で候補IDをnon-lock収集し、relation/card UUID昇順→advisory→batch/items→auto deck→relationsの順でlock後再検証する。
- [ ] 非ownerはnot-found、editedは`CARD_MODIFIED`、activeは`ACTIVE_SESSION`でbatch全体を副作用0拒否する。
- [ ] internal flag下でbatch由来relation/card/item-tagだけを削除し、deleted itemはskip、共有tag/他batch/public Seedを維持する。
- [ ] auto-created deckは空だけ削除し、SET NULL後も`undo_result`へ削除/維持/skip countを保存する。
- [ ] undone再送は保存済み`undo_result`を返し、quota reservationは返却しない。
- [ ] 全RPC/triggerがmatrix外の逆順lockを取得しないよう共通helperへ集約する。

### 3. Refactor / Phase gate

- [ ] `deadlock_timeout`を短くし有限反復で全経路を交差、timeout/deadlock/不変条件違反を経路名付きで報告する。
- [ ] Phase 4追加34件（QUOTA 8 + COMMIT 9 + UPLOAD 3 + FINALIZE 5 + FAIL 2 + OWNER 1 + REVIEW 1 + UNDO 4 + LOCK 1）を回帰する。
- [ ] task-executorから `/quality-fixer frontend` を呼び、Phase 1〜4対象テスト、lint、typecheckを通す。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-QUOTA|IT-COMMIT|IT-UPLOAD|IT-FINALIZE|IT-FAIL|IT-OWNER-04|IT-REVIEW-02|IT-UNDO|IT-LOCK"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [ ] DB Integration累計56/61件が実テスト化されPASSする。
- [ ] edited/active拒否時、undo途中failpoint時の部分永続化が0件である。
- [ ] deleted skip、再undo、auto deck空/非空が保存済みsafe resultどおりになる。
- [ ] 有限反復の交差試験でdeadlock 0、timeout 0、不変条件違反0である。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [ ] Phase 4の動作確認レベルL2を満たし、Phase 5開始条件が成立する。

## 注意事項

- lock testを無限反復やsleep依存にしない。
- Contract E2E TODO、Queue/provider/UI/MCP transportは変更しない。

