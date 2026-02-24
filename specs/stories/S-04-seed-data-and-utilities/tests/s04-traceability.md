# S-04 Traceability Report

- Story: `S-04-seed-data-and-utilities`
- Last Updated: 2026-02-24
- Story Doc: `specs/stories/S-04-seed-data-and-utilities/story.md`
- Design: `specs/stories/S-04-seed-data-and-utilities/design.md`
- Plan: `specs/stories/S-04-seed-data-and-utilities/plan.md`
- Task: `specs/stories/S-04-seed-data-and-utilities/tasks/task-seed-data-and-utilities-phase3-005.md`

## AC / E2E Traceability Matrix

| ID | Requirement / Rule | Implementation Evidence | Integration Evidence | E2E Evidence | Status |
|---|---|---|---|---|---|
| AC-01 | `date.ts` が `getTodayJST/getTomorrowJST/addDaysJST/isBeforeOrEqualJST` を export | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC01` | `seed-data-and-utilities.e2e.test.ts` - `E2E-01` | Passed |
| AC-02 | UTC/JST境界で `getTodayJST` が `2026-02-24` | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC02` | `seed-data-and-utilities.e2e.test.ts` - `E2E-01` | Passed |
| AC-03 | `getTomorrowJST("2026-02-28")` が `2026-03-01` | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC03` | `seed-data-and-utilities.e2e.test.ts` - `E2E-01` | Passed |
| AC-04 | `addDaysJST("2026-12-31", 1)` が `2027-01-01` | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC04` | `seed-data-and-utilities.e2e.test.ts` - `E2E-01` | Passed |
| AC-05 | `isBeforeOrEqualJST("2026-02-24","2026-02-23")` が `false` | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC05` | `seed-data-and-utilities.e2e.test.ts` - `E2E-01` | Passed |
| AC-06 | 不正日付入力で fail-fast 例外 | `frontend/src/lib/date.ts` | `seed-data-and-utilities.int.test.ts` - `IT-AC06` | `seed-data-and-utilities.e2e.test.ts` - `E2E-02` | Passed |
| AC-07 | seed 50字 x R1/W1 で cards=100 | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC07` | `seed-data-and-utilities.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-08 | seed cards 契約 (`visibility public` / `owner_user_id null` / `card_key`) | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC08` | `seed-data-and-utilities.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-09 | fixed owner/profile/deck upsert 契約 | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC09` | `seed-data-and-utilities.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-10 | seed deck と cards の `deck_cards` 100件 | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC10` | `seed-data-and-utilities.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-11 | seed 再実行で件数不増 | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC11` | `seed-data-and-utilities.e2e.test.ts` - `E2E-04` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-12 | seed 失敗時ロールバック（部分成功なし） | `supabase/seed.sql` | `seed-data-and-utilities.int.test.ts` - `IT-AC12` | `seed-data-and-utilities.e2e.test.ts` - `E2E-05` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |

## Final Run Log

| Command | Purpose | Result |
|---|---|---|
| `supabase db reset` | seed含むDB再初期化 | Blocked (`supabase: command not found`) |
| `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.e2e.test.ts` | E2E-01〜E2E-05 実行 | Failed (E2E-01/02 passed, E2E-03/04/05 blocked by DB connection denied) |
| `npm --prefix frontend run test -- ../specs/stories/S-04-seed-data-and-utilities/tests/seed-data-and-utilities.int.test.ts` | IT-AC01〜IT-AC12 回帰 | Failed (IT-AC01〜06 passed, IT-AC07〜12 blocked by DB connection denied) |
| `npm --prefix frontend run check` | frontend 品質ゲート（lint/typecheck/test） | Failed (DB依存テストが sandbox で失敗) |
| `bash .claude/skills/quality-fixer/scripts/quality-check.sh` | `/quality-fixer` 実行 | Blocked (script missing: `No such file or directory`) |
| `npm --prefix frontend run lint` | 代替品質確認（静的解析） | Passed |
| `npm --prefix frontend run typecheck` | 代替品質確認（型） | Passed |
| `npm --prefix frontend run test -- src/lib/date.test.ts` | DB非依存回帰 | Passed |

## Plan Rule Evidence

- Rule: 「統合テストは各Phase内で実行」
  - Evidence: `seed-data-and-utilities.int.test.ts` は `IT-AC01`〜`IT-AC12` が実装済みで、最終Phaseで全件回帰実行を試行。
- Rule: 「E2Eは最終Phaseでのみ実行」
  - Evidence: `seed-data-and-utilities.e2e.test.ts` の `E2E-01`〜`E2E-05` を最終Phaseで実装・実行。
