# S-11 root-resolution RC1 remediation cycle 19

- Status: `rc1_remediation`
- Verification: `local evidence pending; hosted 7 not_run/exit 2; merge blocked`
- Frozen scope: Issue #12, S-11 AC-01..AC-09, base `45969b140d1817be143fe6331159b88b647c2e29`

## Release contract first

- [x] Add the versioned machine-readable release contract and redacted evidence manifest.
- [x] Fail closed on contract drift, missing/duplicate/unknown or unresolved gates, bad identities, evidence mismatch, unresolved reviews, and unredacted evidence.
- [x] Wire validation into the authoritative repository quality runner.
- [x] Bootstrap correction before RC candidate freeze: run immutable definition-only preflight before phase 1, while keeping completed candidate evidence and evidence-only child-commit binding exclusively in the final validator. Pending RC1 evidence may start local gates but cannot pass final acceptance.
- [x] Freeze release contract `S11-RC1-1.0.1` after this bootstrap correction; no policy or scope expansion is permitted.
- [x] Replace open-ended review loops with one cumulative review plus one scope-limited verification.

## Consolidated RC1

- [x] Classify provider and Storage response-body transport failures as typed retryable failures without changing semantic/limit classifications.
- [x] Make source non-OK cancellation best-effort while always marking cleanup and returning the safe response.
- [x] Bound the aggregate S-10 operation+cleanup scope at 20+6 seconds below 30 seconds and settle every child with TERM→KILL escalation.
- [x] Apply the same bounded child supervisor to psql command, autocommit, migration-file, quality control-plane, lease, and teardown paths.

Targeted RC1 evidence before candidate commit: release validator 5/5, quality database 35/35,
S-10 UT-DB 6/6, and S-11 R23-F1 6/6 passed; typecheck passed. These are working-tree
results, not candidate-bound release evidence, and do not change the Hosted7 blocker.
- [x] Correct the ordinary Vitest concurrency explanation against `fileParallelism:false`, remove redundant CLI worker flags, and retain an executable deterministic-runner assertion.

## Evidence pending

- [ ] Run all fixed local gates on one final candidate SHA and record commands/exits/counts/residue/source results.
- [ ] Run all Hosted7 commands on that same SHA; `not_run`/exit 2 is not a pass.
- [ ] Run redacted secret scans, one cumulative review, and one limited verification on that same SHA.
- [ ] Keep merge blocked until the validator accepts the complete evidence set.
