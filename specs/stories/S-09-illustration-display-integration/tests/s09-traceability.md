# S-09 Traceability Report

- Story: `S-09-illustration-display-integration`
- Last Updated: 2026-02-24
- Requirements: `specs/stories/S-09-illustration-display-integration/requirements.md`
- ADR: `specs/adr/ADR-006-illustration-display-state-contract.md`
- Design: `specs/stories/S-09-illustration-display-integration/design.md`
- Task: `specs/stories/S-09-illustration-display-integration/tasks/task-final-quality-e2e-phase4-006.md`
- Scope: Final Phase (`AC-01`〜`AC-20`)

## AC Traceability Matrix

| ID | Requirement / Rule | Implementation Evidence | Integration Evidence | E2E Evidence | Status |
|---|---|---|---|---|---|
| AC-01 | `revealCard` は `illustrationStatus` / `illustrationUrl` を返し5状態契約を維持する | `frontend/src/actions/session-actions.ts`, `frontend/src/actions/session-actions.test.ts` (`UT-S09-AC01-STATUS-ENUM-CONTRACT`) | `illustration-display-integration.int.test.ts` (`IT-AC01`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC01`) | Passed |
| AC-02 | `illustration_key=null` は `none/null` を返す | `frontend/src/actions/session-actions.ts`, `frontend/src/actions/session-actions.test.ts` (`UT-S09-AC02-NONE-KEY-NULL`) | `illustration-display-integration.int.test.ts` (`IT-AC02`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC03`) | Passed |
| AC-03 | `none` はイラスト領域DOMを描画しない | `frontend/src/components/study/IllustrationDisplay.tsx`, `frontend/src/components/study/CardBack.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC03`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC03`) | Passed |
| AC-04 | `ready + storage_path` で Signed URL と `ready` を返す | `frontend/src/actions/session-actions.ts` | `illustration-display-integration.int.test.ts` (`IT-AC03`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC15`) | Passed |
| AC-05 | Signed URL 生成は `expiresIn=3600` | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-AC05-SIGNED-URL-EXPIRESIN-3600`) | `illustration-display-integration.int.test.ts` (`IT-AC05`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC15` ready 導線) | Passed |
| AC-06 | `pending` 行は `pending/null` を返す | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC06-PENDING-NORMALIZATION`) | `illustration-display-integration.int.test.ts` (`IT-AC11` pending 分岐) | `illustration-display-integration.e2e.test.ts` (`E2E-AC12`) | Passed |
| AC-07 | `failed` 行は `failed/null` + triggerなし | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC07-FAILED-NO-TRIGGER`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC14`) | Passed |
| AC-08 | レコードなし + `ok=true && started=true` は `generating` | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC08-TRIGGER-STARTED-GENERATING`) | `illustration-display-integration.int.test.ts` (`IT-AC06`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC13`) | Passed |
| AC-09 | レコードなし + `ok=true && started=false` は `pending` | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC09-TRIGGER-NOT-STARTED-PENDING`) | `illustration-display-integration.int.test.ts` (`IT-AC07`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC13` 同一導線回帰) | Passed |
| AC-10 | レコードなし + `ok=false` でも例外を投げず `pending` | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC10-TRIGGER-OK-FALSE-PENDING`) | `illustration-display-integration.int.test.ts` (`IT-AC08`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC13` 系回帰) | Passed |
| AC-11 | レコードなし + trigger例外でも `pending` | `frontend/src/actions/session-actions.ts`, `session-actions.test.ts` (`UT-S09-AC11-TRIGGER-EXCEPTION-PENDING`) | `illustration-display-integration.int.test.ts` (`IT-AC09`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC13` 系回帰) | Passed |
| AC-12 | `pending` は loading 表示 + image非表示 | `frontend/src/components/study/IllustrationDisplay.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC12`) | `illustration-display-integration.int.test.ts` (`IT-AC11`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC12`) | Passed |
| AC-13 | `generating` は pending と同一 loading 表示 | `frontend/src/components/study/IllustrationDisplay.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC13`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC13`) | Passed |
| AC-14 | `failed` は静的プレースホルダ表示 + 再試行UIなし | `frontend/src/components/study/IllustrationDisplay.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC14`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC14`) | Passed |
| AC-15 | `ready` は `illustration-image` を表示 | `frontend/src/components/study/IllustrationDisplay.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC15`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC15`) | Passed |
| AC-16 | 画像ロード失敗時 fallback + 評価操作継続 | `IllustrationDisplay.tsx`, `RatingButtons.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC16-READY-LOAD-ERROR-FALLBACK`), `RatingButtons.test.tsx` (`UT-AC16-RATING-HANDLER-ALIVE`) | `illustration-display-integration.int.test.ts` (`IT-AC11`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC16`) | Passed |
| AC-17 | front ではイラスト関連DOMを表示しない | `frontend/src/components/study/CardFront.tsx`, `CardBack.test.tsx` (`UT-AC17`) | `illustration-display-integration.int.test.ts` (`IT-AC11` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC17`) | Passed |
| AC-18 | `next.config.mjs` に Supabase remotePatterns がある | `frontend/next.config.mjs` | `illustration-display-integration.int.test.ts` (`IT-AC18`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC20` 回帰) | Passed |
| AC-19 | `<Image>` が `priority` 未使用 / `width` `height` `sizes` / lazy維持 | `frontend/src/components/study/IllustrationDisplay.tsx`, `IllustrationDisplay.test.tsx` (`UT-AC19`) | `illustration-display-integration.int.test.ts` (`IT-AC18` 回帰) | `illustration-display-integration.e2e.test.ts` (`E2E-AC15` 回帰) | Passed |
| AC-20 | reveal後に追加API呼び出しなしで表示分岐できる | `frontend/src/actions/session-actions.ts`, `frontend/src/components/study/CardBack.tsx` | `illustration-display-integration.int.test.ts` (`IT-AC11`) | `illustration-display-integration.e2e.test.ts` (`E2E-AC20`) | Passed |

## Final Run Log

| Command | Purpose | Result |
|---|---|---|
| `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts` | E2E AC-01/03/12/13/14/15/16/17/20 | Passed（9 tests） |
| `npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts` | Integration 全件回帰（IT-AC01〜11/18） | Passed（12 tests） |
| `npm run check --prefix frontend` | frontend 品質ゲート（lint/typecheck/full test） | Failed（S-04 seed系が `127.0.0.1:54322` の `pg_filenode.map` I/O error） |
| `bash .claude/skills/quality-fixer/scripts/quality-check.sh` | `/quality-fixer` 規定コマンド | Not Available（script missing） |
| `npm run lint --prefix frontend && npm run typecheck --prefix frontend && npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts` | `/quality-fixer` 代替（S-09 scope gate） | Passed（21 tests） |

## Quality-fixer Result

```json
{
  "status": "approved",
  "scope": "S-09-illustration-display-integration",
  "equivalentCommand": "npm run lint --prefix frontend && npm run typecheck --prefix frontend && npm run test --prefix frontend -- ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.int.test.ts ../specs/stories/S-09-illustration-display-integration/tests/illustration-display-integration.e2e.test.ts",
  "notes": [
    "公式 quality-check.sh はリポジトリ内に存在しない",
    "プロジェクト全体の npm run check --prefix frontend は S-04 DB 環境障害（127.0.0.1:54322）で失敗"
  ]
}
```

## Plan Rule Evidence

- Rule: 「統合テストは各Phase内で実行」
  - Evidence: `illustration-display-integration.int.test.ts` は Phase 1〜3で具体化済み、最終Phaseで全件回帰実行済み。
- Rule: 「E2Eは最終Phaseでのみ実行」
  - Evidence: `illustration-display-integration.e2e.test.ts` の `E2E-AC01/03/12/13/14/15/16/17/20` を最終Phaseで実装・実行。
