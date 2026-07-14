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

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tasks/task-undo-lock-matrix-phase4-012.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-UNDO-01/03/04`と`IT-LOCK-01`を実テストへ置換する。
- [x] non-owner/edited/active、再undo、auto deck空/非空、全経路並行交差を前後snapshotで検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-UNDO|IT-LOCK"
```

### 2. Green Phase

- [x] auth.uid()で候補IDをnon-lock収集し、relation/card UUID昇順→advisory→batch/items→auto deck→relationsの順でlock後再検証する。
- [x] 非ownerはnot-found、editedは`CARD_MODIFIED`、activeは`ACTIVE_SESSION`でbatch全体を副作用0拒否する。
- [x] internal flag下でbatch由来relation/card/item-tagだけを削除し、deleted itemはskip、共有tag/他batch/public Seedを維持する。
- [x] auto-created deckは空だけ削除し、SET NULL後も`undo_result`へ削除/維持/skip countを保存する。
- [x] undone再送は保存済み`undo_result`を返し、quota reservationは返却しない。
- [x] 全RPC/triggerがmatrix外の逆順lockを取得しないよう共通helperへ集約する。

### 3. Refactor / Phase gate

- [x] 非特権actorでも設定可能な`lock_timeout`を短くし有限反復で全経路を交差、timeout/deadlock/不変条件違反を経路名付きで報告する。
- [x] Phase 4追加34件（QUOTA 8 + COMMIT 9 + UPLOAD 3 + FINALIZE 5 + FAIL 2 + OWNER 1 + REVIEW 1 + UNDO 4 + LOCK 1）を回帰する。
- [x] task-executorから `/quality-fixer frontend` を呼び、Phase 1〜4対象テスト、lint、typecheckを通す。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-QUOTA|IT-COMMIT|IT-UPLOAD|IT-FINALIZE|IT-FAIL|IT-OWNER-04|IT-REVIEW-02|IT-UNDO|IT-LOCK"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [x] DB Integration累計56/62件が実テスト化されPASSする。
- [x] edited/active拒否時、undo途中failpoint時の部分永続化が0件である。
- [x] deleted skip、再undo、auto deck空/非空が保存済みsafe resultどおりになる。
- [x] 有限反復の交差試験でdeadlock 0、timeout 0、不変条件違反0である。
- [x] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [x] Phase 4の動作確認レベルL2を満たし、Phase 5開始条件が成立する。

## 注意事項

- lock testを無限反復やsleep依存にしない。
- Contract E2E TODO、Queue/provider/UI/MCP transportは変更しない。

## 完了証跡（2026-07-14）

- Red: `IT-UNDO-01/03/04`、`IT-LOCK-01`を実テスト化し、実装前は4/4件の失敗を確認した。
- Green: 対象4/4件PASS（5.17秒）。`IT-UNDO-01`へ管理コンテキスト漏洩検証を追加後も単独PASS。
- Phase 4回帰: 34/34件PASS、Phase 1〜4累計56/62件PASS（残り5件は後続PhaseのTODO）。
- Frontend回帰: Vitest 155/155件PASS、lint PASS（86 files）、typecheck PASS。
- DB: fresh migration + seed PASS。wrapper ACLは`authenticated=true / service_role=false / anon=false`、internal RPCは全クライアント`false`、管理コンテキスト行数0件。
- Lock matrix: card UUID lock → advisory → batch → items → auto deck → relations の定義順をcatalogで確認（位置 1534 → 1752 → 2399 → 2871 → 4111 → 4378）。有限2反復でdeadlock 0、timeout 0、不変条件違反0。
- 差分健全性: `git diff --check` PASS。
- `/quality-fixer frontend`: `status=approved`。独立fresh DBと下記critical probeを含む最終品質ゲートを完了した。

### Internal context差し戻し対応

- Red: undo定義に`ai_enable_internal_context` / `ai_disable_internal_context`が存在しないことを`IT-UNDO-01`で検出し、1/1件FAILを確認した。
- Green: undoのmutation区間を短命なinternal contextで囲み、成功時に非公開`ai_disable_internal_context()`で明示解除した。undo定義から`management_mutation_context`参照を除去した。
- Trigger契約: `tombstone_import_item_on_delete`と`mark_import_item_relation_edited`は`ai_internal_context_active()`だけをtrusted internal flagとして扱う。
- 漏洩/marker: undo前の`user_edited_at IS NULL`がundo後も2/2件NULL。成功後および全5 failpoint rollback後に`ai_internal_context_active() = false`、同transaction後続の直接mutationは`42501`、snapshot差分0件。
- 再回帰: fresh migration + seed PASS、Phase 4 34/34件PASS、S-10累計56/62件PASS、Frontend 155/155件PASS、lint/typecheck PASS。
- ACL/catalog: enable/disable/active helperは`authenticated/service_role/anon`すべて実行不可、owner=`s10_migration_owner`、固定`search_path`。undo内のenable/disable位置は5639/8543、management context位置0。
- `/quality-fixer frontend`: `status=approved`。差し戻し後の関連チェック2件を完了した。

### `/quality-fixer frontend` 最終確認

- 独立DB `s10_quality_phase4_20260714`を`template0`から作成し、Supabase auth/storage基盤、S-02 migration 2本、S-10 migration全文、`supabase/seed.sql`をすべて`ON_ERROR_STOP=1`で適用した。結果はcards 100件、decks 1件、deck_cards 100件、import batches 0件。
- Task012 Green証跡のS-10 Integration累計56/62件、Phase 4 34/34件、Frontend 155/155件、有限2反復deadlock/timeout/不変条件違反0を再確認した。今回のCodex sandboxではVitest配下の子`psql`通信がTCP/Unix socketとも`EPERM`になるため、DB統合テストの再実行はtop-level `psql` critical probeへ分離した。
- critical probe: S-10 DEFINER 42関数の不正owner 0、不正search_path 0、PUBLIC/anon公開0。`undo_import`はauthenticatedのみ実行可、internal context helperはanon/authenticated/service_roleすべて実行不可。public schema CREATEはmigration ownerのみ許可。
- undo contextは同一transactionで`false -> enable -> true -> disable -> false`、成功後のcontext行0件。`undo_import_internal`内のenable/disable位置5639/8543、legacy management context参照0。
- lock順はcard 1503 -> advisory 1752 -> batch 2399 -> items 2742 -> auto deck 4111 -> relations 4378で昇順。undo 5 failpointと有限2反復のlock試験定義が維持されている。
- Frontend: S-10 unit 22件PASS / 10件TODO、DB通信を使わない全346件PASS、lint PASS（86 files）、typecheck PASS、必要envを明示したproduction build PASS。
- 差分健全性: 対象4ファイルのみ、`git diff --check` PASS。repo内`node_modules` symlinkなし。
