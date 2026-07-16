# Remediation cycle 7 (independent review attempt 1 findings; next review 2/3)

Scope: preserve the completed bounded documentation pass and correct only the four findings verified by independent review attempt 1/3. The next independent review remains 2/3. Pinned base: `45969b140d1817be143fe6331159b88b647c2e29`; branch: `issue/12-ai-cards-2-6`.

## Authorized corrections after independent review attempt 1/3

- [x] F1 Red: real Queue RPC -> worker -> handler coverage proves malformed non-empty responses are incorrectly returned as HTTP 200 `idle`
- [x] F1 Green: only the legitimate empty Queue array is idle; malformed responses fail with HTTP 500, exactly one safe `worker_recoverable`, and no unsafe response content in logs
- [x] F2 Red: real outbox adapter coverage proves unknown shaped strings are accepted as safe runtime error codes
- [x] F2 Green: outbox codes are checked against canonical `SAFE_IMPORT_ERROR_CODES`; unknown/non-string values fail while null/absent and every canonical value retain their contract
- [x] F3 historical semantic correction: confirmed poison ACK evidence in cycle 3 says `worker_poison`, and the repeatable consistency check directly enforces it across every task record
- [x] F4 AC evidence correction: provider selection and concept-failure isolation map to the actual local/E2E/fail-closed PostgreSQL definitions consistently in plan and traceability
- [x] Current inventory/count SSOT synchronized for the focused tests added by F1/F2
- [x] Required local and seven fail-closed external gates rerun with exact results; unavailable prerequisites remain `not_run`/exit 2

## Independent review attempt 2/3 remediation (next review 3/3)

- [x] R2-F1 inventory drift: correct the plan suite declaration to current Integration 179 and make the repeatable consistency command assert both plan current-count locations and operations
- [x] R2-F2 evidence inspection: align plan and traceability AC-05 to Unit #1–7, F-02, NR-15, F-17, HI-08, R7-F4, and the applicable fail-closed real E2E/resource gates
- [x] R2-F2 Red assessment: record truthfully whether an implementation Red exists before fixture changes; do not fabricate a behavioral failure when the route already enforces five versus six
- [x] R2-F2 Green: the actual prepare route accepts exactly five source entries and rejects six before RPC or Storage side effects
- [x] Review-2 current inventory/count SSOT synchronized for added focused cases
- [x] Review-2 complete local and seven fail-closed external gates rerun with exact results; unavailable prerequisites remain `not_run`/exit 2

Review-2 Red assessment: no honest behavioral Red was technically available. Inspection found the actual prepare route already rejects `sources.length > 5` before constructing the service client and accepts lengths 1 through 5; the independent finding was missing executable boundary evidence and stale traceability, not missing production behavior. The new tests therefore add a faithful signed-upload fixture and directly exercise the actual route without claiming an implementation failure.

Review-2 focused Green command: `npm --prefix frontend run test:s11:integration -- -t 'R11-R2-F2'` exited 0 with 2 passed and 179 skipped (181 definitions). The actual authenticated route returned 201 with five uploads and exactly five RPC/signed-upload calls, then returned 400 for six sources with zero RPC or Storage side effects.

Red command: `npm --prefix frontend run test:s11:integration -- -t 'R11-F[12]'` exited 1 with 8 failed, 3 passed, and 168 skipped (179 definitions). The four F1 failures received HTTP 200 instead of 500. F2 accepted the unknown string and non-string values, and mapped an absent code to `INTERNAL_ERROR`; no fabricated Red evidence is claimed for the three cases that already passed.

Green command: `npm --prefix frontend run test:s11:integration -- -t 'R11-F[12]'` exited 0 with 11 passed and 168 skipped (179 definitions). The real handler path preserves `[]` as idle, rejects four malformed response shapes as one safe HTTP 500 event without unsafe markers, accepts the canonical allowlist and null/absent semantics, and rejects three invalid outbox code values.

- [x] Identify and correct exactly the three stale plan SSOT labels without changing any other plan content
- [x] Run the repeatable focused documentation-consistency check across requirements, design, ADR, plan, traceability, operations, metadata, and every task record
- [x] Run the complete required local regression and quality gates and preserve exact results
- [x] Run fail-closed external/deployed-service gates and record unavailable prerequisites only as `not_run`/exit 2
- [x] Preserve scope evidence and hand off to fresh read-only independent review attempt 1/3

## Focused documentation-consistency regression

Command (run from repository root):

```bash
bash -eu -o pipefail -c '
story=specs/stories/S-11-ai-card-async-processing
adr=specs/adr/ADR-008-ai-card-async-queue-image-processing.md
for file in "$story/requirements.md" "$story/design.md" "$adr" "$story/plan.md" "$story/traceability.md"; do
  test "$(sed -n "s/^version: //p" "$file" | head -1)" = 2.0.5
done
test "$(node -p "require(\"./$story/meta.json\").ssot_version")" = 2.0.5
test "$(node -p "require(\"./$story/meta.json\").requirements_version")" = 2.0.5
grep -Fqx "requirements: $story/requirements.md@2.0.5" "$story/traceability.md"
grep -Fqx "adr: $adr@2.0.5" "$story/traceability.md"
grep -Fqx "design: $story/design.md@2.0.5" "$story/traceability.md"
grep -Fqx "plan: $story/plan.md@2.0.5" "$story/traceability.md"
grep -Fqx -- "- 要件定義書: \`$story/requirements.md\` v2.0.5 Approved" "$story/plan.md"
grep -Fqx -- "- ADR: \`$adr\` v2.0.5 Accepted" "$story/plan.md"
grep -Fqx -- "- Design Doc: \`$story/design.md\` v2.0.5 Approved" "$story/plan.md"
test "$(rg -F "v2.0.5" "$story/plan.md" | wc -l | tr -d " ")" = 3
task_count=0
for task in "$story"/tasks/*.md; do
  test -s "$task"
  grep -Eq "^# " "$task"
  grep -Eq "^- \[x\] " "$task"
  task_count=$((task_count + 1))
done
test "$task_count" -gt 0
grep -Fqx -- "- [x] F3 Green: poison deliveries preserve ACK and emit exactly one safe correlated \`worker_poison\` event with zero terminal failures" "$story/tasks/remediation-cycle-3.md"
if rg -n "^- \[x\].*poison deliveries.*worker_recoverable" "$story/tasks"; then
  exit 1
fi
grep -Fqx "| AC-04 provider選択 | T2-02, T4-01 | #9〜11 | IT-16 | E2E-07 |" "$story/plan.md"
grep -Fqx "| AC-04 explicit provider, no fallback | provider factory, OpenAI/Gemini adapters | #9–11 | IT-16 | E2E-07 |" "$story/traceability.md"
grep -Fqx "| AC-08 concept失敗分離 | T1-04, T4-02 | - | F-08 fail-closed PostgreSQL pair-failure/sibling-success | E2E-04 (local) |" "$story/plan.md"
grep -Fqx "| AC-08 concept failure isolation | concept message and pair fail transaction | - | F-08 fail-closed PostgreSQL pair-failure/sibling-success | E2E-04 (local) |" "$story/traceability.md"
if rg -n "AC-04.*IT-14|AC-08.*IT-2[34]" "$story/plan.md" "$story/traceability.md"; then
  exit 1
fi
grep -Fqx "| AC-05 source/入力画像 | T2-01, T3-01 | #1–7 | F-02, NR-15, F-17, HI-08, R7-F4 | \`test:s11:real-e2e\` source owner/upload + \`test:s11:resource\` max/decode (fail-closed) |" "$story/plan.md"
grep -Fqx "| AC-05 source validation and owner path | source routes, recorded bucket/path, image validator, source RPCs | #1–7 | F-02, NR-15, F-17, HI-08, R7-F4 | \`test:s11:real-e2e\` source owner/upload + \`test:s11:resource\` max/decode (fail-closed) |" "$story/traceability.md"
if rg -n "^\| AC-05.*(IT-15|IT-16|IT-20|HI-12|E2E-05)" "$story/plan.md" "$story/traceability.md"; then
  exit 1
fi
grep -Fqx -- "- Integration suite: \`$story/tests/ai-card-async-processing.int.test.ts\`（現行181件。127/139/142/147/153/154/155/162/163/168/179件は履歴値）" "$story/plan.md"
grep -Fq "数量gateは現行Unit 23件、Integration 181件、E2E 10件である。" "$story/plan.md"
grep -Fq "Unit 23, Integration 181, E2E 10" "$story/operations.md"
if rg -n "v2\\.0\\.3 (Approved|Accepted)" "$story/requirements.md" "$story/design.md" "$adr" "$story/plan.md" "$story/traceability.md" "$story/operations.md" "$story/meta.json" "$story/tasks"; then
  exit 1
fi
'
```

Post-finding correction result: exit 0; `focused_documentation_consistency: passed`. Unlike the original count-only task check, this command opens every task record and verifies a heading and completed evidence, directly enforces confirmed poison ACK as `worker_poison`, rejects the stale provider/concept mappings, checks mutually consistent replacement rows, and preserves the version/count checks.

## Initial bounded documentation-pass gate evidence (before review attempt 1 findings)

Local gates:

- `npm --prefix frontend run test:s11:inventory`: exit 0; 201/201 (Unit 23/23, Integration 168/168, E2E 10/10; 3 files passed)
- `npm --prefix frontend run test:s11:integration -- -t 'R[789]-F|R10-(R[12]-)?F'`: exit 0; 21 passed / 147 skipped (168 total)
- `npm --prefix frontend run test:s10:unit`: exit 0; 32/32 (1 file passed)
- `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts`: exit 0; 6/6 (1 file passed)
- `npm --prefix frontend run lint`: exit 0; Biome checked 97 files, no fixes applied
- `npm --prefix frontend run typecheck`: exit 0; `tsc --noEmit`
- `npm --prefix frontend run build`: exit 1; fail-closed because `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` were absent; compilation completed before prerender rejected the missing prerequisites
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=build-anon-key SUPABASE_SERVICE_ROLE_KEY=build-service-role-key npm --prefix frontend run build`: exit 0; production build passed with the existing middleware matcher and dynamic ImageMagick import warnings
- `git diff --check`: exit 0

External/deployed-service gates (none counted as passing):

- `npm --prefix frontend run test:s11:fresh`: `not_run`, exit 2; three distinct S-11 database URLs are required and fallback is forbidden
- `npm --prefix frontend run test:s11:upgrade`: `not_run`, exit 2; same three-distinct-database prerequisite
- `npm --prefix frontend run test:s11:failure`: `not_run`, exit 2; same three-distinct-database prerequisite
- `npm --prefix frontend run test:s11:real-integration`: `not_run`, exit 2; `S11_REAL_DATABASE_URL` is absent and mock fallback is forbidden
- `npm --prefix frontend run test:s11:real-e2e`: `not_run`, exit 2; required real app/Edge/Supabase credentials, owners, fixture, provider controls/binding, logs, attestations, and secret marker are absent; mock fallback is forbidden
- `npm --prefix frontend run test:s11:resource`: `not_run`, exit 2; `S11_RESOURCE_FIXTURE_DIR`, `S11_RESOURCE_BUNDLE_PATH`, and `S11_RESOURCE_WASM_PATH` are absent; fallback is forbidden
- `npm --prefix frontend run test:s11:deno`: `not_run`, exit 2; configured Deno executable is unavailable and fallback is forbidden

## Scope and handoff

- Pinned-base scope: the post-review correction changed only the Queue/outbox adapter, focused Integration tests, the affected plan/traceability/operations/meta SSOT, cycle-3 poison wording, and this cycle-7 record. The pre-existing Issue #12 implementation diff remains otherwise preserved.
- Independent review attempt 1/3 completed with `changes_requested`; all four authorized findings are now corrected. The next counter remains 2/3.
- Quality-fixer, CHECKPOINT 2, commit, ship, push, PR, issue close, deploy, remote migration, secret mutation, and cron activation are outside this task-executor pass and were not performed.

## Independent review attempt 1/3 remediation verification

- [x] F1 verified: `createSupabaseDatabase().readOne()` passes every non-array `read_ai_import_queue` response through `firstRecord()` to `undefined`; `processOneConcept()` then returns `idle`. Requirements FR-11 and the handler contract require Queue RPC contract faults to surface as HTTP 500 with exactly one safe `worker_recoverable`, not idle.
- [x] F2 verified: `parseWorkerEvent()` delegates outbox `errorCode` to `safeCode()`, which casts every string to `SafeImportErrorCode`. `ai_worker_log_outbox_error_check` enforces only `^[A-Z0-9_]{1,64}$`; runtime validation against `SAFE_IMPORT_ERROR_CODES` is absent, contrary to the safe allowlist contract.
- [x] F3 verified: the focused documentation command only counts task files and scans them for one stale-label pattern. It does not detect `remediation-cycle-3.md` line 28 describing confirmed poison delivery as `worker_recoverable`, while current requirements, ADR, design, tests, and traceability require confirmed poison ACK to emit `worker_poison`.
- [x] F4 verified: plan AC-04 maps provider selection to IT-14, but IT-14 is retry exhaustion and IT-16 is provider selection. Plan and traceability AC-08 cite IT-23/IT-24, which cover aggregate finalization and image-mode-none bypass rather than concept failure isolation; E2E-04 and the fail-closed real PostgreSQL pair-failure/sibling-success gate are the applicable evidence.
- [x] Hard scope enforced: no application, database, test, historical task, or additional plan-body content was changed. F1/F2 require forbidden production/test remediation; F3 requires correction outside the new cycle-7 task record; F4 requires forbidden plan-body correction. The result is `escalation_needed`, not a false remediation or pass.

## Post-finding correction gate evidence

Local gates:

- Focused Red: `npm --prefix frontend run test:s11:integration -- -t 'R11-F[12]'` exited 1 with 8 failed, 3 passed, and 168 skipped; the failures matched F1/F2 exactly.
- Focused Green: the identical command exited 0 with 11 passed and 168 skipped.
- Strengthened documentation/traceability consistency command above: exit 0.
- `npm --prefix frontend run test:s11:inventory`: exit 0; 212/212 (Unit 23/23, Integration 179/179, E2E 10/10; 3 files passed).
- `npm --prefix frontend run test:s11:integration -- -t 'R[789]-F|R10-(R[12]-)?F|R11-F[12]'`: exit 0; 32 passed / 147 skipped (179 definitions), preserving the prior 21 and adding 11.
- `npm --prefix frontend run test:s10:unit`: exit 0; 32/32.
- `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts ../specs/stories/S-11-ai-card-async-processing/tests/ai-card-async-processing.int.test.ts -t 'AI import error mapper|R11-F2'`: exit 0; 12 passed / 173 skipped (the existing safe-error 6 plus 6 outbox safe-code cases).
- `npm --prefix frontend run lint`: exit 0; Biome checked 97 files, no fixes applied.
- `npm --prefix frontend run typecheck`: exit 0; `tsc --noEmit`.
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=build-anon-key SUPABASE_SERVICE_ROLE_KEY=build-service-role-key npm --prefix frontend run build`: exit 0; configured production build passed with the existing middleware matcher and dynamic ImageMagick import warnings.
- `git diff --check`: exit 0.

External/deployed-service gates (none counted as passing):

- `test:s11:fresh`, `test:s11:upgrade`, and `test:s11:failure`: each `not_run`, exit 2; three distinct S-11 database URLs are required and fallback is forbidden.
- `test:s11:real-integration`: `not_run`, exit 2; `S11_REAL_DATABASE_URL` is absent and mock fallback is forbidden.
- `test:s11:real-e2e`: `not_run`, exit 2; the reported real app/Edge/Supabase users, credentials, fixture, provider controls/binding, runtime logs, artifact attestations, recoverable worker, and secret marker are absent; mock fallback is forbidden.
- `test:s11:resource`: `not_run`, exit 2; `S11_RESOURCE_FIXTURE_DIR`, `S11_RESOURCE_BUNDLE_PATH`, and `S11_RESOURCE_WASM_PATH` are absent; fallback is forbidden.
- `test:s11:deno`: `not_run`, exit 2; the configured Deno executable is unavailable and fallback is forbidden.

The four verified findings are remediated and the task-executor handoff is ready for fresh read-only independent review attempt 2/3. This is not a zero-finding review claim.

## Independent review attempt 2/3 remediation gate evidence

Local gates:

- Review-2 Red assessment: no implementation Red claimed; inspection proved the five-source limit already existed and the finding concerned missing boundary evidence and stale AC mapping.
- `npm --prefix frontend run test:s11:integration -- -t 'R11-R2-F2'`: exit 0; 2 passed / 179 skipped (181 definitions).
- Strengthened documentation/traceability consistency command above: exit 0; it now directly asserts both plan inventory declarations, operations current count, and the mutually consistent AC-05 rows while rejecting the stale test identifiers.
- `npm --prefix frontend run test:s11:inventory`: exit 0; 214/214 (Unit 23/23, Integration 181/181, E2E 10/10; 3 files passed).
- `npm --prefix frontend run test:s11:integration -- -t 'R[789]-F|R10-(R[12]-)?F|R11-(R2-)?F[12]'`: exit 0; 34 passed / 147 skipped (181 definitions), preserving the prior 32 and adding 2.
- `npm --prefix frontend run test:s10:unit`: exit 0; 32/32.
- `npm --prefix frontend run test -- src/lib/ai-import/errors.test.ts ../specs/stories/S-11-ai-card-async-processing/tests/ai-card-async-processing.int.test.ts -t 'AI import error mapper|R11-F2'`: exit 0; 12 passed / 175 skipped (existing safe-error 6 plus outbox 6).
- `npm --prefix frontend run lint`: exit 0; Biome checked 97 files, no fixes applied.
- `npm --prefix frontend run typecheck`: exit 0; `tsc --noEmit`.
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=build-anon-key SUPABASE_SERVICE_ROLE_KEY=build-service-role-key npm --prefix frontend run build`: exit 0; configured production build passed with the existing middleware matcher and dynamic ImageMagick import warnings.
- `git diff --check`: exit 0.

External/deployed-service gates (none counted as passing):

- `test:s11:fresh`, `test:s11:upgrade`, and `test:s11:failure`: each `not_run`, exit 2; three distinct S-11 database URLs are required and fallback is forbidden.
- `test:s11:real-integration`: `not_run`, exit 2; `S11_REAL_DATABASE_URL` is absent and mock fallback is forbidden.
- `test:s11:real-e2e`: `not_run`, exit 2; all reported real app/Edge/Supabase users, credentials, fixture, provider controls/binding, runtime logs, artifact attestations, recoverable worker, and secret marker prerequisites remain absent; mock fallback is forbidden.
- `test:s11:resource`: `not_run`, exit 2; its fixture directory, bundle path, and WASM path are absent; fallback is forbidden.
- `test:s11:deno`: `not_run`, exit 2; the configured Deno executable is unavailable and fallback is forbidden.

Independent review attempt 2/3 returned two findings; both are remediated. The next and hard-stop gate is fresh read-only independent review 3/3. This is not a zero-finding review claim.
