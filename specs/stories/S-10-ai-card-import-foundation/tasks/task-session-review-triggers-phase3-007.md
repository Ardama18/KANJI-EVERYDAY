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

- [ ] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-session-review-triggers-phase3-007.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `IT-GUARD-01〜04`、`IT-REVIEW-01/03`、`IT-SECURITY-03`を実テストへ置換する。
- [ ] current/queue_due/learn/new/retry、invalid JSON値、直接DML、session同時更新、後段trigger失敗を独立caseにする。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-GUARD|IT-REVIEW-0[13]|IT-SECURITY-03"
```

### 2. Green Phase

- [ ] JSON stringかつcanonical UUID regexp一致だけを抽出し、OLD/NEW和集合をdistinct UUID昇順でlockする。
- [ ] `guard_card_active_session`をcards BEFORE UPDATE/DELETEへ付け、owner本人のsession/deck IDだけをsafe detailにする。
- [ ] front/back/skill/patternの`IS DISTINCT FROM`変更後だけ全review_statesを同transactionで削除する。
- [ ] public immutable、card key再計算、tag正規化、owner triggerをservice roleでも迂回不能にする。
- [ ] transaction-local internal flagは外部設定不能とし、この段階では通常直接DMLに適用しない。

### 3. Refactor / Phase gate

- [ ] Phase 3追加16件（RLS 7 + SECURITY 3 + GUARD 4 + REVIEW 2）をまとめて回帰する。
- [ ] catalogで全trigger/DEFINER securityを再確認する。
- [ ] task-executorから `/quality-fixer frontend` を呼び、Phase 1〜3対象テスト、lint、typecheckを通す。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-RLS|IT-SECURITY|IT-GUARD|IT-REVIEW-0[13]"
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 完了条件

- [ ] DB Integration累計22/61件（Phase 2の6 + Phase 3の16）が実テスト化されPASSする。
- [ ] current + 4 queueのactive cardを直接DMLでも副作用0で拒否する。
- [ ] invalid JSON値は無視し、session INSERT/UPDATE競合でもguardを取りこぼさない。
- [ ] content 4列だけreview resetし、失敗statementではreview stateを維持する。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [ ] Phase 3の動作確認レベルL2を満たし、Phase 4開始条件が成立する。

## 注意事項

- relation変更のreview keepは管理RPCと同時にPhase 4で`IT-REVIEW-02`として実装する。
- Contract E2E TODOは変更しない。

