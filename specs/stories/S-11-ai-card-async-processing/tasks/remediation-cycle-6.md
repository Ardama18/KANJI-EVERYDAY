# Fresh bounded remediation cycle 6 (new authorized cycle; review counter reset to 1/3)

- [x] R10-F1 Red: cleanup completion and authenticated S-10 attach can deadlock by locking lifecycle and illustration rows in opposite orders
- [x] R10-F1 Green: every card/illustration/lifecycle production path follows the documented canonical lock order
- [x] R10-F1 real evidence: two independent sessions cover attach-first and completion-first scheduling with bounded timeouts, no `40P01`, and one serializable winner
- [x] R10-F2 Red: declared-oversize provider responses are not cancelled and cancellation failures can replace `IMAGE_TOO_LARGE`
- [x] R10-F2 Green: shared OpenAI/Gemini response cancellation is best-effort and size classification remains authoritative
- [x] R10-F2 evidence: cancel success, synchronous throw, asynchronous rejection, absent body, absent Content-Length, and understated Content-Length overflow are covered without unsafe logging
- [x] SSOT/test inventory: requirements/design/ADR/plan/traceability/operations and current counts are synchronized
- [x] Verification: focused and complete task-level gates are Green; unavailable external gates remain explicit `not_run`/exit 2

## Durable Red evidence

Command: `npm --prefix frontend run test:s11:integration -- -t 'R10-F[12]'`

Result: exit 1, 5 failed / 2 passed / 155 skipped before production changes.

1. R10-F1: the canonical lifecycle lock helper and both complete-vs-attach real-session markers were absent.
2. R10-F2 OpenAI/Gemini declared oversize: body reads were correctly zero, but cancellation count was zero for both adapters.
3. R10-F2 stream overflow: synchronous cancellation throw and asynchronous cancellation rejection both replaced `IMAGE_TOO_LARGE` with `PROVIDER_PERMANENT_ERROR`.

## Verification evidence

Focused Green command: `npm --prefix frontend run test:s11:integration -- -t 'R10-F[12]'`

Focused Green result: exit 0, 7 passed / 155 skipped. The real two-session cases are present in the fail-closed real integration gate; their configured execution is recorded separately and is never promoted from `not_run` to pass.

Complete local evidence:

- `npm --prefix frontend run test:s11:inventory`: 195/195 (Unit 23, Integration 162, E2E 10)
- `npm --prefix frontend run test:s11:integration -- -t 'R[789]-F|R10-F'`: 15/15
- `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts`: 6/6
- S-10 unit suite: 32/32
- Lint: 97 files; typecheck, configured production build, and `git diff --check`: passed
- `test:s11:{fresh,upgrade,failure}`, real integration, real E2E, resource, and Deno: structured `not_run`, exit 2 because their explicit prerequisites were unavailable; none is counted as passing

Quality-fixer and commit remain outside this task-executor run.

## Independent review attempt 1 remediation

- [x] R10-R1-F1 Red: different-key S-10 attach does not lock OLD+NEW illustrations together before the S-11 trigger
- [x] R10-R1-F1 Green: forward S-10 primitive override locks OLD+NEW through the canonical helper before card mutation
- [x] R10-R1-F1 real evidence: A→B / B→A two-session swaps in both scheduling arrangements are bounded, avoid `40P01`, and end in a valid serializable state
- [x] Review-attempt-1 complete local/external gates and SSOT inventory are synchronized for review 2/3

Red command: `npm --prefix frontend run test:s11:integration -- -t 'R10-R1-F1'`

Red result: exit 1, 1 failed / 162 skipped. The forward `CREATE OR REPLACE FUNCTION public.set_card_illustration_internal` was absent, so the production primitive could pre-lock only NEW while the S-11 BEFORE trigger later requested OLD+NEW in UUID order. Cross-swap real-session markers were also absent.

Green command: `npm --prefix frontend run test:s11:integration -- -t 'R10-R1-F1'`

Green result: exit 0, 1 passed / 162 skipped. The real gate installs a test-only pre-trigger delay that deterministically widens the historical target-lock window, then runs authenticated A→B / B→A swaps with A-first and B-first schedules, 2-second lock timeout, 5-second statement timeout, explicit no-`40P01` checks, and exact swapped-card/reference-count/ready-state assertions. Configured PostgreSQL execution remains fail-closed and is recorded separately.

Review-attempt-1 complete evidence:

- S-11 inventory: 196/196 (Unit 23, Integration 163, E2E 10)
- Focused R7〜R10/R10-R1: 16/16
- S-10 Unit: 32/32; frontend safe-error: 6/6
- Lint: 97 files; typecheck, configured production build, and `git diff --check`: passed
- Fresh/upgrade/failure, real integration, real E2E, resource, and Deno: structured `not_run`, exit 2 for unavailable explicit prerequisites; none counted as passing

## Independent review attempt 2 remediation

- [x] R10-R2-F1 Red: SECURITY DEFINER lifecycle guard trusts `current_user` and bypasses authenticated deleted-object resurrection rejection
- [x] R10-R2-F1 Green: deleted lifecycle restoration trusts only service JWT context while owner resurrection is rejected and untracked legacy mutation remains allowed
- [x] R10-R2-F2 Red: terminal permanent/duplicate outbox claim or completion failure changes outcome to recoverable and skips immediate source release
- [x] R10-R2-F2 Green: post-terminal outbox dispatch is best-effort, terminal outcome/source release remain authoritative, and the durable event remains reclaimable
- [x] Review-attempt-2 complete local/external gates and SSOT inventory are synchronized for final review 3/3

Red command: `npm --prefix frontend run test:s11:integration -- -t 'R10-R2-F[12]'`

Red result: exit 1, 5 failed / 163 skipped. Four terminal tests received `recoverable` instead of `failed` for permanent/duplicate × outbox claim/complete failure, before reaching the expected immediate source deletion. The lifecycle SQL test found `current_user` inside the SECURITY DEFINER guard instead of the caller JWT service-role predicate.

Green command: `npm --prefix frontend run test:s11:integration -- -t 'R10-R2-F[12]'`

Green result: exit 0, 5 passed / 163 skipped. The lifecycle guard now uses the same `request.jwt.claim.role=service_role` authority as service RPCs. Permanent and duplicate terminal paths contain outbox claim/complete faults without logging injected unsafe details, return the durable `failed` outcome, immediately release the upload source, and leave the stable event available for completion/reclaim.

Review-attempt-2 complete evidence:

- S-11 inventory: 201/201 (Unit 23, Integration 168, E2E 10)
- Focused R7〜R10 including review remediations: 21/21
- S-10 Unit: 32/32; frontend safe-error: 6/6
- Lint: 97 files; typecheck, configured production build, and `git diff --check`: passed
- Fresh/upgrade/failure, real integration, real E2E, resource, and Deno: structured `not_run`, exit 2 for unavailable explicit prerequisites; none counted as passing
