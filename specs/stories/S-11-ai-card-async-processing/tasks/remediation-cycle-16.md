# S-11 owner-safe Storage mutation remediation cycle 16

- Verification: `hosted 7 not_run; merge blocked`
- [x] Reproduce the column-ACL/RLS subquery regression in the F-18 contract.
- [x] Add an authenticated JWT owner-bound, fixed-search-path SECURITY DEFINER helper returning only managed/unmanaged.
- [x] Revoke helper EXECUTE from PUBLIC, anon, and service role; grant only authenticated policy callers.
- [x] Replace Storage INSERT/UPDATE OLD+NEW/DELETE tracking subqueries in core and forward migrations while leaving SELECT policy unchanged.
- [x] Add actual database owner/other-owner/service mutation coverage for legacy/source/tracked paths, exact denial state, helper direct-call ACL/behavior, safe column reads, and token/path 42501.
- [x] Move hosted internal sensitive snapshots and path lookups to service-role calls with adapter-enforced owner filtering; verify owner safe projection, other-owner zero rows, and sensitive 403/42501 through a fake boundary.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.14 / cycle 16 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Synchronize current counts: ordinary 693 passed/8 skipped of 701, inventory 254/254 (Unit 27, Integration 217, E2E 10), DB-backed focused 71/71.
- [x] Pass DB safety 31/31, isolated fresh/upgrade/true-autocommit recovery, actual Storage RLS matrix, real lifecycle, full root quality, external 7 structured not_run/exit 2, clean index, and residue 0.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
