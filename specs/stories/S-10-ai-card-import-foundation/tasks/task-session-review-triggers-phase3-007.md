# タスク: active-session guardとreview reset triggerを実装しPhase 3品質ゲートを通す

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 3（最終タスク）
- 依存: `tasks/task-rls-security-phase3-006.md`
- 提供成果物: session/card対称lock、active guard、review reset、trigger rollback、Integration 7件、Phase 3 approved証跡
- 関連AC: AC-07〜09、IT-GUARD-01〜04、IT-REVIEW-01/03、IT-SECURITY-03
- サイズ: 大きめ（trigger concurrency slice）

## 実装内容

study sessionのcurrentと4 queueからcanonical UUID文字列だけを抽出し、session側/card側で同じcard row/advisory順を取得する。直接UPDATE/DELETEを含めactive cardを拒否し、content 4列の実変更時だけreview stateを原子的に削除する。trigger途中失敗時にreview/edit/tombstone副作用を残さない。

## 対象ファイル

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [x] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts`（S-10 card_key forward互換回帰）
- [x] `specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts`（S-10 card_key forward互換回帰）
- [x] `specs/stories/S-10-ai-card-import-foundation/tasks/task-session-review-triggers-phase3-007.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-GUARD-01〜04`、`IT-REVIEW-01/03`、`IT-SECURITY-03`を実テストへ置換する。
- [x] current/queue_due/learn/new/retry、invalid JSON値、直接DML、session同時更新、後段trigger失敗を独立caseにする。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-GUARD|IT-REVIEW-0[13]|IT-SECURITY-03"
```

### 2. Green Phase

- [x] JSON stringかつcanonical UUID regexp一致だけを抽出し、OLD/NEW和集合をdistinct UUID昇順でlockする。
- [x] `guard_card_active_session`をcards BEFORE UPDATE/DELETEへ付け、owner本人のsession/deck IDだけをsafe detailにする。
- [x] front/back/skill/patternの`IS DISTINCT FROM`変更後だけ全review_statesを同transactionで削除する。
- [x] public immutable、card key再計算、tag正規化、owner triggerをservice roleでも迂回不能にする。
- [x] transaction-local internal flagは外部設定不能とし、この段階では通常直接DMLに適用しない。

### 3. Refactor / Phase gate

- [x] Phase 3追加16件（RLS 7 + SECURITY 3 + GUARD 4 + REVIEW 2）をまとめて回帰する。
- [x] catalogで全trigger/DEFINER securityを再確認する。
- [x] task-executorから `/quality-fixer frontend` を呼び、Phase 1〜3対象テスト、lint、typecheckを通す。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-RLS|IT-SECURITY|IT-GUARD|IT-REVIEW-0[13]"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [x] DB Integration累計22/62件（Phase 2の6 + Phase 3の16）が実テスト化されPASSする。
- [x] current + 4 queueのactive cardを直接DMLでも副作用0で拒否する。
- [x] invalid JSON値は無視し、session INSERT/UPDATE競合でもguardを取りこぼさない。
- [x] content 4列だけreview resetし、失敗statementではreview stateを維持する。
- [x] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [x] Phase 3の動作確認レベルL2を満たし、Phase 4開始条件が成立する。

## 注意事項

- relation変更のreview keepは管理RPCと同時にPhase 4で`IT-REVIEW-02`として実装する。
- Contract E2E TODOは変更しない。

## Phase 3 品質ゲート証跡（2026-07-14）

- status: `approved`
- fresh DB: 独立DBへSupabase `auth`/`storage`基盤を用意し、S-02 migration 2本、S-10 migration全体、`supabase/seed.sql`を`psql -v ON_ERROR_STOP=1`で順次末尾まで適用。Seed card 100件を確認。
- DB Integration: `IT-UNIQUE|IT-OWNER|IT-RLS|IT-SECURITY|IT-GUARD|IT-REVIEW` は22件PASS、37件skip、2件todo。並行session/card guard（`IT-GUARD-04`）と失敗statementのreview rollback（`IT-REVIEW-03`）を含む。
- S-10 Unit: 22件PASS、10件todo。
- 全体test: 45 files PASS、1 file skip、377 tests PASS、62 tests todo。S-04の旧連結card_key期待を64hex・`ai_compute_card_key`・境界空白正規化・Seed deck内100件一意・seed再実行key不変へforward互換更新。
- catalog: `cards`/`study_sessions`の対象trigger 3件を確認。各SECURITY DEFINER関数はowner=`s10_migration_owner`、`search_path=pg_catalog, pg_temp`。
- static/build: Biome 86 files PASS、`tsc --noEmit` PASS、Next.js production build PASS、`git diff --check` PASS。
- 既知警告: Next.js middleware matcherの既存warningのみ。Phase 3差分起因のerror/warningなし。
