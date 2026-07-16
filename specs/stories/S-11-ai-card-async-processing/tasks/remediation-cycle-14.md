# S-11 ambiguous ref and staged diff remediation cycle 14

- Verification: `hosted 7 not_run; merge blocked`
- [x] Red/Green branch/tag, local/remote, and wider ref namespace collisions; accept only one exact shorthand candidate.
- [x] Verify full heads/remotes/tags refs by exact existence, allow symbolic HEAD, and reject detached HEAD in favor of its full SHA-1 commit.
- [x] Preserve full SHA identity, short OID and revision-expression rejection, shell-free execution, and `origin/main` then `main` fallback.
- [x] Red/Green committed, staged, and unstaged diff phase arguments/order plus first-nonzero exit propagation.
- [x] Execute a temporary repository with staged-only trailing whitespace and prove the staged phase fails before unstaged validation.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.12 / cycle 14 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Pass DB safety 31/31, real lifecycle harness, full root quality, all seven structured `not_run`/exit 2 gates, clean index, and strict-prefix residue 0.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
