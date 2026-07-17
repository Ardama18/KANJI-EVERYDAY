# S-11 atomic constraint and readiness SSOT remediation cycle 11

- Verification state: `hosted 7 not_run; merge blocked`
- [x] Red R15-F1: legacy CHECK constraints were dropped in separate autocommit statements before replacement.
- [x] Green R15-F1: column expansion precedes one atomic ALTER that drops legacy/current names and adds all S-11 NOT VALID constraints.
- [x] `before_constraint_swap` interruption is inspected from a new connection: both legacy constraints remain, no S-11 status constraint exists, and the ledger is absent; true `psql -f -` recovery then validates and records one ledger row.
- [x] Red/Green R15-F2: meta/plan/traceability/operations use v2.0.9 and cycle 11, withdraw current ready/approved claims, and separate completed local boundary E2E from incomplete hosted full-system E2E.
- [ ] Hosted schedule, real integration/E2E, resource, and Deno acceptance pass with target prerequisites. This remains the merge blocker.
