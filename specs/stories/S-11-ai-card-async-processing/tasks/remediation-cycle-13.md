# S-11 strict diff-base identity remediation cycle 13

- Verification: `hosted 7 not_run; merge blocked`
- [x] Red/Green abbreviated current/base OIDs, 4..39 and 41..64 hex lengths, `HEAD~1`, `main^{commit}`, and colon revision syntax before any resolver call.
- [x] Accept a raw object ID only when it is a complete 40-hex SHA-1 commit matching the repository object format and resolved commit identity.
- [x] Accept symbolic, local, remote-tracking, and full ref inputs only when Git resolves one existing full `refs/...` name, then peel that ref to a commit SHA.
- [x] Preserve blank, shell-like, ambiguous, unresolved fail-closed behavior and deterministic `origin/main` then `main` fallback.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.11 / cycle 13 and retain historical approvals, hosted 7 `not_run`/exit 2, and merge blocked.
- [x] Pass DB safety 27/27, real lifecycle harness, full root quality, all seven structured `not_run`/exit 2 gates, and strict-prefix residue 0.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
