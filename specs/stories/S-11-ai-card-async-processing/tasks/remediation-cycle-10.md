# S-11 true-autocommit review remediation cycle 10

- Date: 2026-07-16
- Scope: production-equivalent autocommit recovery proof, canonical UUID handling, and typed preview-secret access
- Prohibited: push, PR creation/update, merge, deploy, hosted mutation, secret persistence, or cron activation

## TDD and completion

- [x] Red: R14 failed 3/3 for `psql -c` migration execution, uppercase UUID propagation, and direct preview-secret environment access.
- [x] Execute migration text through `psql -f -` with statement-level autocommit and inspect each injected partial state from a new session.
- [x] Prove durable partial tables, NOT VALID constraints, policies, trigger count, runtime-function presence, exact explicit role ACL transition, absent ledger, and idempotent rerun/validate/single-ledger convergence.
- [x] Replace the ineffective schema-local default privilege revoke with the PostgreSQL global default revoke so interrupted new SECURITY DEFINER functions never inherit PUBLIC execute.
- [x] Canonicalize uppercase UUID input once before every DB/path/RPC/response boundary and keep mutation/Storage side effects at zero when lookup does not resolve.
- [x] Read `AI_PREVIEW_HMAC_SECRET` through the typed environment layer; missing and blank values return the existing safe 500 response before RPC.
- [x] Pass the full isolated root quality runner and retain all hosted gates as `not_run`/exit 2.

## PR body reservation / merge blocker

Local code readiness has zero findings, but it does not satisfy hosted acceptance. The PR body must explicitly list hosted `pg_cron` schedule execution, hosted real integration/E2E, bound resource artifacts, and Deno as `not_run`/exit 2. Merging is blocked until those exact target prerequisites are supplied and their gates pass; local fresh/upgrade/true-autocommit/local-real results must not be presented as substitutes.
