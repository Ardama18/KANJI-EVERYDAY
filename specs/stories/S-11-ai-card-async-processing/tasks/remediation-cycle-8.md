# Remediation Cycle 8: Repository-Owned Quality Dispatcher

## Metadata

- Story: `S-11-ai-card-async-processing`
- Cycle: 8 (fresh bounded cycle)
- Pinned base: `45969b140d1817be143fe6331159b88b647c2e29`
- Required branch: `issue/12-ai-cards-2-6`
- Scope: repository-owned quality configuration, disposable S-10 database lifecycle, executable safety harness, local/external gate evidence, and documentation synchronization
- Prohibited: invoking the plugin quality-fixer dispatcher; commit/push/PR/ship/deploy; remote database mutation; cron activation

## Checklist

- [x] Verify the pinned base, required branch, mandatory steering rules, dispatcher contract, repository/frontend scripts, S-10 harness, cycle-7 evidence, story design/operations, and full diff.
- [x] Capture Red evidence with focused executable tests/harness for missing repository-owned quality behavior.
- [x] Implement `.codex/quality.json` and minimum repository-owned executable quality scripts without no-op package scripts.
- [x] Prove disposable database safety: unique strict prefix, source/target distinction, protected-name rejection, no secret/name logging, immediate cleanup, success/failure cleanup, exit propagation, concurrency noncollision, source continuity, target run-only lifetime, and zero residue.
- [x] Run the configured local quality command: frontend lint, typecheck, production build, complete ordinary Vitest with isolated S-10 database, S-11 focused/inventory regressions as needed, and `git diff --check`.
- [x] Run all seven hosted/resource/Deno/multi-database S-11 gates and record fail-closed `not_run`/exit 2 outcomes or passes with exact totals.
- [x] Synchronize cycle-8 evidence and only the required `meta.json`, traceability, operations, plan, and task records.
- [x] Perform final diff/safety review and verify every cycle-8 checkbox and reported total against executable evidence.

### Independent Review 1/3 Remediation

- [x] R8-R1-F1 Red: reproduce cluster-wide role/membership mutation risk and fail closed when prerequisites are absent or the before/after catalog fingerprint changes.
- [x] R8-R1-F1 Green: prepare the disposable target without executing cluster-role or membership mutation statements, and prove the real local cluster role/membership fingerprint is unchanged on success and setup failure.
- [x] R8-R1-F2 Red: reproduce drop failure and post-drop residue verification failure while a primary quality check also fails.
- [x] R8-R1-F2 Green: surface sanitized teardown failures ahead of the primary error, while preserving exact quality exit codes only after verified cleanup.
- [x] R8-R1-F3 Verification: record post-change S-10 Unit 32/32 and safe-error/outbox 12/12, refresh configured quality evidence, and advance to independent review 2/3 without changing the seven fail-closed external gates.

### Independent Review 2/3 Remediation

- [x] R8-R2-F1 Red/Green: make the signal-installed cleanup callback perform sanitized drop, source continuity, exact-target absence, and cluster role/membership verification; teardown failure must override SIGINT/SIGTERM with generic exit 1.
- [x] R8-R2-F2 Red/Green: fingerprint `pg_auth_members.admin_option`, `inherit_option`, and `set_option`, with executable SQL-contract coverage against the local PostgreSQL catalog.
- [x] R8-R2-F3 Verification: pass safety 20/20, the real local three-target harness, exact S-10/safe-error regressions, complete configured quality, final source/role/residue checks, and advance to independent review 3/3 with external gates unchanged.

### Final Review and CHECKPOINT 2

- [x] Independent read-only review 3/3: complete diff, AC 9/9, and quality/database safety contract approved with zero findings and 100% compliance.
- [x] Root `$ar-core:quality-fixer`: `.codex/quality.json` discovered; repo-owned command passed and returned `approved`/exit 0.
- [x] CHECKPOINT 2: zero-finding review and root quality approval recorded; exact-target teardown verified; single focused commit is authorized next.

## Evidence

Red: before this cycle, the installed repository-root `$ar-core:quality-fixer` dispatcher exited 1 because neither `.codex/quality.json` nor a usable root package quality contract existed. The initial focused command `node --test scripts/quality/quality-database.test.mjs` also exited 1 because the repository-owned database lifecycle module did not yet exist.

Green safety evidence after review 1 remediation: `node --test scripts/quality/quality-database.test.mjs` passed 17/17, covering mutation-free S-10 migration input, missing role prerequisites, before/after role-state drift, drop failure, residue verification failure, cleanup requested during database creation, and prior lifecycle contracts. `node scripts/quality/quality-database-harness.mjs` passed against the configured local source with three simultaneous unique targets: success, exact controlled quality exit 23, and controlled setup failure. Every path enforced unchanged role/membership fingerprints, source continuity, target run-only lifetime, and zero strict-prefix residue. Preparation required existing role/membership prerequisites and removed cluster-wide role creation/membership grant statements before applying the S-10 migration; no role was created/altered/granted/revoked/dropped. Output contained neither URLs, credentials, nor generated database names.

Configured quality evidence: `.codex/quality.json` invoked `node scripts/quality/run-quality-with-database.mjs` and exited 0. Safety tests and the real source harness were executed separately so the runner owns signal cleanup directly without an intermediate process. Lint checked 97 files; typecheck passed; configured production build passed with existing warnings; ordinary Vitest passed 50 files, 652 tests, and conditionally skipped 8 of 660 definitions; S-11 inventory passed 214/214; focused remediation passed 34/34 with 147 skipped; `git diff --check` passed.

Exact review-remediation regressions: `npm --prefix frontend run test:s10:unit` passed 32/32. `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts ../specs/stories/S-11-ai-card-async-processing/tests/ai-card-async-processing.int.test.ts -t 'AI import error mapper|R11-F2'` passed 12/12 with 175 unrelated tests skipped. Independent review attempt 1 findings are remediated; attempt 2/3 is the next gate.

External evidence: `test:s11:fresh`, `upgrade`, `failure`, `real-integration`, `real-e2e`, `resource`, and `deno` each returned `not_run`/exit 2 for its explicit unavailable prerequisites. No external gate is counted as a pass.

Review-2 remediation evidence: focused Red passed 17/20 with the missing membership attributes, escaping cleanup rejection, and unverified signal exit assertions failing; Green safety passed 20/20. The signal-installed callback now performs the same complete sanitized teardown as the normal path, and a rejection or failed source/target/cluster verification returns only generic exit 1 instead of 130/143. The fingerprint includes local PostgreSQL `pg_auth_members.admin_option`, `inherit_option`, and `set_option`. The real local three-target harness, S-10 Unit 32/32, safe-error/outbox 12/12, complete configured quality (lint 97, typecheck, build, ordinary 652 pass/8 skip, S-11 214/214, focused 34/34, diff check), and final source/role/residue check all passed. The seven external gates remain unchanged `not_run`/exit 2; independent review attempt 3/3 is next.

Final gate evidence: independent review 3/3 returned zero findings, AC 9/9, 100%, and `approved`. The installed repository-root quality-fixer discovered `.codex/quality.json` and exited 0 after the repo-owned quality command passed lint 97, typecheck, configured build, ordinary 652 pass/8 skip, S-11 214/214, focused 34/34, and diff check. Authoritative teardown verified source continuity, exact target absence, and unchanged cluster role/membership state. CHECKPOINT 2 is complete; no external gate was promoted to pass and no prohibited external action occurred.
