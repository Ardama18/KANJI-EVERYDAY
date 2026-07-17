# S-11 S-10 DB test settlement remediation cycle 18

- Verification: `hosted 7 not_run; merge blocked`
- [x] Prove deterministically that a Vitest timeout equivalent does not cancel the underlying Promise.
- [x] Bound ordinary S-10 psql commands with statement 10s, lock 5s, and child process 12s before the DB-only 30s test timeout.
- [x] Keep the global Vitest timeout, cycle-17 ordinary one-worker configuration, and in-file concurrency/deadlock tests unchanged.
- [x] Reject killed psql children rather than classifying them as SQL business diagnostics.
- [x] Await IT-COMMIT-02 and E2E-CONTRACT-03/04 operation plus cleanup as one settled scope.
- [x] Serialize marker cleanup with a marker-derived advisory lock and preserve safe duplicate cleanup.
- [x] Replace affected owner-wide usage sums/joins with reservation-key or reservation-date scoped evidence.
- [x] Record Red from the HEAD helper contract (exit 1: no process bound or settled scope).
- [x] Record non-DB Green: UT-DB 3/3, quality database harness 32/32, typecheck pass, diff check clean.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.16 / cycle 18 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Parent disposable runner passes final review diff twice consecutively: ordinary 703 pass/8 conditional skip of 711, DB4, S-11 260, focused 77; run 1 ordinary 63.12s/S-10 Integration 42.617s/IT-COMMIT-02 5.510s/IT-FINALIZE-05 2.291s, run 2 ordinary 65.80s/S-10 Integration 41.164s/IT-COMMIT-02 4.095s/IT-FINALIZE-05 2.140s. Run-1 IT-COMMIT-02 passes beyond the old 5s default under the bounded 30s DB-suite timeout.
- [x] After each disposable full run, strict residue is zero and source synthetic owner-A batches/reservations/usage/decks are all zero.
- [ ] External seven and independent review remain parent gates before commit.
- [x] Final review M1 Red 1/1 then Green 1/1: real injected Node children prove SIGTERM timeout, exit→reject→next-snapshot ordering, and no live process residue for run/capture/settle; UT-DB focused is now 4/4 and S-10 Unit inventory 36.
- [x] Final review M2 scopes `ai_usage_daily` baseline/delta to reservation owner/date/kind, verifies commit plus idempotent retry add no usage, and verifies remote_mcp/upload exempt delta zero; non-DB source contract is included in quality harness 32/32.
- [x] Parent disposable runner revalidates current ordinary 711 definitions and DB-backed IT-COMMIT-01/03 after final review remediation in both consecutive runs.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
