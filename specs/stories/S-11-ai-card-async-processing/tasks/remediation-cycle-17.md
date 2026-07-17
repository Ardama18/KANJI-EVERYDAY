# S-11 service snapshot credential remediation cycle 17

- Verification: `hosted 7 not_run; merge blocked`
- Starting state: two helper/test changes had unknown provenance; they were preserved and adopted because independent review identified a concrete credential-confusion risk and the hardening improves the service-only security boundary.
- [x] Reproduce uppercase `APIKEY` duplication with the anon default while canonical lowercase credentials remain valid.
- [x] Normalize explicit headers through `Headers` before adding the anon default, and add the default only when case-insensitive apikey is absent.
- [x] Require a case-insensitive Authorization Bearer/apikey pair containing the same credential before any service-only snapshot fetch.
- [x] Add table-driven canonical pair, AUTHORIZATION/APIKEY variant, missing Authorization, missing apikey, owner bearer+anon spoof, and mismatched service credential cases.
- [x] Assert valid outgoing Authorization/apikey equal the explicit service values and every rejected case calls fetch zero times without exposing credential values in errors or logs.
- [x] Keep production code and database schema unchanged.
- [x] Reproduce ordinary-suite nondeterminism caused by separate S-10 integration/E2E file workers sharing the usage owner and observing transient state after a five-second timeout.
- [x] Add `maxWorkers=1/minWorkers=1` only to the ordinary Vitest npm phase; preserve inventory, focused, hosted/external gates and concurrency/lock checks within each test file.
- [x] Add a runner contract proving argument order, both ordinary flags, no inventory/focused flag leakage, and exactly two worker-flag occurrences.
- [x] Advance meta/plan/traceability/operations/tasks to v2.0.15 / cycle 17 while retaining hosted 7 `not_run`/exit 2 and merge blocked.
- [x] Synchronize current counts: ordinary 699 passed/8 skipped of 707, inventory 260/260 (Unit 27, Integration 223, E2E 10), focused 77/77.
- [ ] Hosted full-system acceptance gates pass with target prerequisites; until then merge remains blocked.
