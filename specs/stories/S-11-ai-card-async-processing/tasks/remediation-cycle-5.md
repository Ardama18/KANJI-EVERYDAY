# Fresh bounded remediation cycle 5 (new authorized cycle; review counter reset to 1/3)

- [x] F1 Red: cleanup-completed illustration can be resurrected through owner UPDATE/RLS and attached again
- [x] F1 Green: DB lifecycle trigger and attach fence reject every owner/API resurrection while preserving pre-cleanup owner and service lifecycle updates
- [x] F2 Red: concept claim/reclaim expiry can be controlled by Edge `p_now`
- [x] F2 Green: claim creation/reclaim and every business side effect derive claim validity from DB time only
- [x] F3 Red: cleanup age/claim/reclaim/verify can be controlled by Edge `p_now`
- [x] F3 Green: cleanup eligibility, lease fencing, verification, and completion derive time from DB only
- [x] F4 Red: source complete calls Storage SDK `download()` before a bounded streaming read
- [x] F4 Green: Content-Length and actual `Response.body` bytes are bounded and the reader is cancelled immediately on overflow
- [x] F5 Red: S-11 SQL maintains a duplicate weaker prompt rule instead of invoking the repository prompt-safety policy
- [x] F5 Green: S-08 and S-11 invoke one shared prompt-safety policy and preserve safe errors
- [x] F6 Red: outbox claim/reclaim can be controlled by Edge `p_now` and completion lacks DB-clock lease expiry
- [x] F6 Green: outbox claim/reclaim/completion use DB time only with stable event IDs and service-role-only access
- [x] SSOT/test inventory: requirements/design/plan/traceability/operations/ADR and real/local gates synchronized
- [x] Verification: focused and complete local gates Green; unavailable external gates explicit `not_run`/exit 2

## Durable Red evidence

Command: `npm --prefix frontend run test:s11:integration -- -t 'R7-F[1-6]'`

Result: exit 1, 6 failed / 147 skipped. Independent failures:

1. F1: lifecycle trigger and four real-DB reachability markers were absent.
2. F2: concept claim still accepted `p_now`; adapter still sent `args.now`.
3. F3: cleanup claim/verify still accepted `p_now`; adapter still sent caller time.
4. F4: source complete exported no bounded `Response` reader and still used SDK `bucket.download()`.
5. F5: S-11 claim returned no shared-policy prompt and migration contained its own weaker English prompt.
6. F6: outbox claim still accepted `p_now`; completion had no DB-clock lease predicate.

Focused Green: the same command exited 0 with 6 passed / 147 skipped.

## Verification evidence

- Initial six-finding S-11 inventory: 186/186 (Unit 23, Integration 153, E2E 10)
- S-10 baseline: 32/32
- Safe-error regression: 6/6
- Lint: 97 files passed
- TypeScript typecheck: passed
- Configured production build: passed with existing warnings only
- `git diff --check`: passed
- Fresh, upgrade, failure, real integration, real E2E, resource, and Deno gates: each explicit `not_run`/exit 2 because its required local/hosted prerequisites were unavailable; none is a pass
- Next gate at that checkpoint: independent read-only code-reviewer attempt 1/3 over all S-11 acceptance criteria and the complete uncommitted diff

## Independent review attempt 1 bounded remediation

- [x] R8-F1 Red: first removal from a shared illustration incorrectly marks the object `delete_pending` and blocks the S-10 attach path
- [x] R8-F1 Green: tracking/reference locks preserve `ready` for 2→1, last removal creates `delete_pending`, and pre-cleanup pending re-reference is atomic with cleanup fencing
- [x] R8-F1 real/local evidence and SSOT: shared reference, S-10 attach, last-reference, concurrency/fencing, inventory, and gate records synchronized

Red command: `npm --prefix frontend run test:s11:integration -- -t 'R8-F1'`

Red result: exit 1, 1 failed / 153 skipped. The migration lacked a locked remaining-reference check before `ready → delete_pending`, lacked an atomic unclaimed `delete_pending → ready` re-reference path, and the real DB gate lacked the four shared-reference/S-10/concurrency boundaries.

Green command: `npm --prefix frontend run test:s11:integration -- -t 'R8-F1'`

Green result: exit 0, 1 passed / 153 skipped. Existing R7 plus R8 focused evidence also passed 7/7.

Review-attempt-1 remediation verification:

- S-11 inventory: 187/187 (Unit 23, Integration 154, E2E 10)
- S-10 baseline: 32/32; safe-error: 6/6
- Lint: 97 files; typecheck, configured production build, and `git diff --check`: passed
- Fresh/upgrade/failure/real integration/real E2E/resource/Deno: explicit `not_run`/exit 2 for unavailable prerequisites; none counted as passing
- Next gate: genuinely independent read-only code-reviewer attempt 2/3

## Independent review attempt 2 bounded remediation

- [x] R9-F1 Red: sibling-card locking permits distinct shared-card delete/delete and delete/attach deadlocks
- [x] R9-F1 Green: atomic reference metadata and canonical lifecycle locking eliminate sibling-card inversion while preserving all shared/delete/cleanup invariants
- [x] R9-F1 real/local evidence and SSOT: bounded two-session delete/delete and delete/attach gates, inventory, and document versions synchronized

Red command: `npm --prefix frontend run test:s11:integration -- -t 'R9-F1'`

Red result: exit 1, 1 failed / 154 skipped. The schema had no atomic reference metadata, the removal trigger locked sibling cards after holding the lifecycle row, and the real gate lacked bounded distinct-card delete/delete and delete/attach reachability markers.

Green command: `npm --prefix frontend run test:s11:integration -- -t 'R[789]-F'`

Green result: exit 0, 8 passed / 147 skipped. R9-F1 alone and all prior R7/R8 contracts are Green.

Review-attempt-2 remediation verification:

- S-11 inventory: 188/188 (Unit 23, Integration 155, E2E 10)
- S-10 baseline: 32/32; safe-error: 6/6
- Lint: 97 files; typecheck, configured production build, and `git diff --check`: passed
- Fresh/upgrade/failure/real integration/real E2E/resource/Deno: explicit `not_run`/exit 2 for unavailable prerequisites; none counted as passing
- Next gate: final genuinely independent read-only code-reviewer attempt 3/3
