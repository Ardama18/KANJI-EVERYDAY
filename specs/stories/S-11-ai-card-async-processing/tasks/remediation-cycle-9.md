# S-11 ship review remediation cycle 9

- Date: 2026-07-16
- Scope: response-loss reconciliation, autocommit migration recovery, function privilege safety, schedule configuration validation, and run-scoped quality database residue control
- Prohibited: push, PR, merge, deploy, remote database mutation, persistent secret change, or cron activation

## Checklist

- [x] Reject a malformed completion upload UUID before service DB or Storage access.
- [x] Reconcile a lost `mark_ai_source_ready` response against the exact durable row, digest, metadata, and write intent; delete source bytes only for a DB-confirmed uncommitted outcome.
- [x] Run the core migration without an enclosing test transaction, inject three autocommit boundary failures, keep the migration ledger empty on failure, and prove idempotent forward recovery.
- [x] Revoke default PUBLIC function execution before creating any S-11 function and preserve explicit least-privilege grants after recovery.
- [x] Reject blank worker secrets and non-canonical/non-HTTPS project URLs in both schedule activation and invocation.
- [x] Give every quality run a strict run scope plus advisory lease; remove inactive strict-prefix residue, retain active concurrent runs, and verify the current run leaves no residue.
- [x] Pass DB safety 23/23 and the repository quality runner, including fresh/upgrade/failure/local-real/build, ordinary 666 pass/8 skip, S-11 228/228, focused 48/48, and `git diff --check`.
- [x] Re-run all seven hosted/external gates and retain `not_run`/exit 2 without claiming acceptance.

## Red / Green evidence

Red: focused R13 initially failed 5/5: malformed UUID reached service lookup, reconciliation was absent, the failure job depended on one transaction, default privileges were not denied first, and schedule values were accepted by existence alone. DB safety also failed because run-scoped residue reconciliation was absent. The first autocommit failure execution unexpectedly completed at `after_expand_tables`.

Green: the actual completion route and fresh PostgreSQL database simulate a committed ready transition whose response is lost, reconcile it to HTTP 200, delete only the raw object, and retain the normalized source. Three independent autocommit interruptions recover in place with no migration-ledger claim during failure and no PUBLIC SECURITY DEFINER exposure. The real local gate validates canonical HTTPS/nonblank schedule settings. DB safety passes 23/23 and the full repository runner exits 0 with zero strict-prefix residue.
