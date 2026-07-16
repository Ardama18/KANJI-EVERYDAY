# S-11 service snapshot credential remediation cycle 17

- Verification: `hosted 7 not_run; merge blocked`
- [x] Reproduce case-variant explicit `APIKEY` combining with the anon default.
- [x] Normalize explicit headers before adding anon fallback, preserving case-insensitive service credentials.
- [x] Cover canonical/uppercase valid pairs and missing/spoofed/mismatched invalid pairs in one table-driven regression test.
- [x] Require every invalid pair to reject before fetch without exposing credential values.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.15 / cycle 17 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Synchronize current counts: ordinary 694 passed/8 skipped of 702, inventory 255/255 (Unit 27, Integration 218, E2E 10), DB-backed focused 72/72.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
