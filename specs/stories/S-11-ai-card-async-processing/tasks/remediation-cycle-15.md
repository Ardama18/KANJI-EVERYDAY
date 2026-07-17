# S-11 owner-safe read, normalized output, and status remediation cycle 15

- Verification: `hosted 7 not_run; merge blocked`
- [x] Replace owner table-wide SELECT with explicit safe-column projections while retaining owner RLS and full service-role access.
- [x] Apply the ACL fix both before S-11 expansion failpoints and through an append-only forward hardening migration.
- [x] Exercise owner-safe, other-owner-denied, token SQLSTATE 42501, and service-role-allowed projections in isolated fresh/upgrade/recovery databases.
- [x] Revalidate source/provider PNG encode output for identity, dimensions, 16MP, and 10MiB before destination Storage effects.
- [x] Treat normalized output oversize as permanent `IMAGE_TOO_LARGE` with retry/write/finalize zero.
- [x] Reject queued all-undone, processing/undone, terminal/undone, and other impossible status matrices as safe 502.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.13 / cycle 15 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Pass DB safety 31/31, real lifecycle harness, full root quality, all seven structured `not_run`/exit 2 gates, clean index, and strict-prefix residue 0.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
