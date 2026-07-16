---
id: S-11
feature: ai-card-async-processing
type: traceability
version: 2.0.11
created: 2026-07-15
updated: 2026-07-16
status: implementation_review
requirements: specs/stories/S-11-ai-card-async-processing/requirements.md@2.0.5
adr: specs/adr/ADR-008-ai-card-async-queue-image-processing.md@2.0.5
design: specs/stories/S-11-ai-card-async-processing/design.md@2.0.5
plan: specs/stories/S-11-ai-card-async-processing/plan.md@2.0.11
---

# S-11 implementation traceability

| Acceptance criterion | Production evidence | Unit | Integration | E2E |
|---|---|---|---|---|
| AC-01 async commit and reconnect | `commit_import_async`, commit/status routes | - | IT-01–03 | E2E-01–02 |
| AC-02 visibility, fencing, duplicates | queue/claim/retry/finalize/ACK RPCs, terminal message/token reconciliation, worker | #14 | F2 A-expiry/B-failure, IT-04–10, IT-12 | E2E-06 |
| AC-03 transient-only retry | retry policy, replacement-message RPC | #12–14 | IT-11–15, IT-17 | E2E-03 |
| AC-04 explicit provider, no fallback | provider factory, OpenAI/Gemini adapters | #9–11 | IT-16 | E2E-07 |
| AC-05 source validation and owner path | source routes, recorded bucket/path, image validator, source RPCs | #1–7 | F-02, NR-15, F-17, HI-08, R7-F4 | `test:s11:real-e2e` source owner/upload + `test:s11:resource` max/decode (fail-closed) |
| AC-06 PNG normalization and sharing | input-only 64px validator, aspect-preserving codec, 1..1024 DB dimensions, stable object tracking, pair finalize | #8/#8b | P3-02 real codec/worker/DB, IT-19, IT-23 | E2E-08 |
| AC-07 source/orphan cleanup | durable upload consumers, duplicate/Storage terminal immediate compensation after orphan proof, leased cleanup with prior lifecycle state | - | R4-F3 delete_pending immediate retry/reference recheck, F4 direct/response-loss/delete result, F-16 Storage compensation, IT-20–22, HI-09 | E2E-05, E2E-09 |
| AC-08 concept failure isolation | concept message and pair fail transaction | - | F-08 fail-closed PostgreSQL pair-failure/sibling-success | E2E-04 (local) |
| AC-09 secret-safe logging | worker/cleanup auth/config handlers, allowlist logger, confirmed correlated poison/duplicate events, strict claim-bound terminal `worker_failure` taxonomy | #15/P3-01 | R4-F1/F2/F4, attempt-2 F1/F2/F3/F4, prior reconciliation | E2E-10 served correlated probe |

Integration includes authenticated routes, service-role RPC, provider HTTP, private Storage, recorded legacy/fresh buckets, shared-source ordering, cleanup lease recovery, pinned ImageMagick decode/re-encode, and finalize/failure reconciliation. `test:s11:real-integration`, `test:s11:real-e2e`, and `test:s11:resource` are fail-closed gates: missing real environment/fixtures produce `not_run` and exit 2, never a mock pass. Configured real E2E obtains owner A/B through Supabase password login, sends package-generated SSR cookies to Next routes, and uses access-token Authorization only for PostgREST RPC/RLS; rejection scenarios require the exact Next 404/`NOT_FOUND`, PostgREST 404/`PGRST202`, or Storage 400/`404`/`not_found` contract. The resource gate directly serves the exact self-contained local bundle plus pinned WASM, independently hashes/sizes both, measures spawned PID CPU/external RSS and codec peak RSS, enforces request abort/process kill at CPU/RSS/120-second limits, and exercises direct 16MP/decode-bomb/independent decode-failure plus OpenAI-adapter maximum response/110-second timeout cases.

Fresh/upgrade/failure database jobs are also fail-closed when invoked directly: absent or non-distinct database URLs emit structured `not_run` and exit 2. The repository quality runner now provisions three distinct disposable databases and executes local core fresh/upgrade/failure plus the real two-session completion/cleanup race. Current inventory is Unit 23/23, Integration 200/200, E2E 10/10. Hosted `pg_cron`, real integration/E2E, resource artifact, and Deno gates remain explicit `not_run`/exit 2 until their target prerequisites exist; no local result promotes them to pass.

Fresh bounded remediation cycle 7 corrects only the three stale plan SSOT labels to current v2.0.5 and resets the independent review counter to attempt 1/3. Its repeatable documentation-consistency and unchanged-code regression evidence is recorded in `tasks/remediation-cycle-7.md`; the subsequent independent review outcome is recorded below.

Repository-owned quality cycle 8 adds no production or AC contract. `.codex/quality.json` delegates to a repository runner that creates a strict-prefix disposable database from the existing S-10 bootstrap, repository migrations, and Seed without dumping/restoring Supabase platform schemas, roles, default privileges, or extensions. Review-1 remediation requires the existing S-10 role/membership prerequisites, removes cluster-wide role/membership statements from the disposable migration stream, and proves a non-revealing `pg_roles`/`pg_auth_members` fingerprint unchanged. Review-2 remediation makes the signal-installed callback the same complete verified teardown used by the normal path and fingerprints all mutable local membership attributes (`admin_option`, `inherit_option`, `set_option`). Executable evidence is safety 20/20 plus the real success/check-failure/setup-failure harness, S-10 Unit 32/32, safe-error/outbox 12/12, ordinary Vitest 652 pass/8 conditional skip, current S-11 inventory 214/214, focused remediation 34/34, lint/typecheck/configured build/diff pass, final source/role/residue pass, and seven unchanged external `not_run`/exit 2 outcomes. Cleanup/drop or any teardown verification failure overrides a simultaneous primary quality failure or signal status with generic exit 1 and sanitized output; exact quality or signal exit propagation is evidence only after verified cleanup.

Historical cycle 8 independent review attempt 3/3 returned zero findings and `approved` for that cycle's diff. The installed root quality-fixer then returned exit 0 through the then-current isolated S-10 lifecycle. This historical record does not approve any post-cycle-8 remediation and does not establish hosted AC acceptance.

Historical R12 remediation introduced five boundaries: ready rows cannot be downgraded by stale cleanup, malformed JSON and status identifiers fail before side effects, expand/backfill/validate are bounded stages, resource-only authorization rejects blank secrets, and the repository runner owns three isolated disposable databases. This is historical implementation evidence, not current hosted acceptance. The current cycle-13 verification state remains hosted schedule controls, full real integration/E2E, resource artifact, and Deno `not_run`/exit 2 with merge blocked.

Cycle 7 independent review attempt 1 returned `changes_requested`. Its four authorized corrections now distinguish an empty Queue result from malformed RPC output at the real handler boundary, validate outbox error codes against `SAFE_IMPORT_ERROR_CODES`, directly check the corrected confirmed-poison `worker_poison` task evidence, and map provider selection/concept isolation to IT-16, local E2E-04, and the fail-closed F-08 PostgreSQL pair-failure/sibling-success gate. Independent review attempt 2/3 remains the next gate.

Cycle 7 independent review attempt 2 returned two documentation/evidence findings. The plan suite declaration and all current-count assertions now use Integration 181 after adding actual prepare-route five-accept/six-reject coverage. AC-05 plan/traceability rows now cite Unit #1–7, F-02, NR-15, F-17, HI-08, R7-F4, and the fail-closed real E2E source-owner/upload and resource max/decode gates. Independent review attempt 3/3 is the next hard-stop gate.

Fresh remediation cycle 3 adds P3-01/P3-02 focused evidence: `worker_failure` is exactly one only for a DB-confirmed terminal failure and zero for uncommitted, reconciliation-ambiguous, or retry-persistence infrastructure outcomes; `worker_recoverable` contains allowlisted metadata only. Valid 4096x64 and 64x4096 inputs pass the pure codec, worker contract, pinned real ImageMagick normalization, and 1..1024 DB persistence contract as 1024x16 and 16x1024 PNGs. The final local gate record is maintained in `operations.md`; hosted gates remain fail closed.

| Fresh remediation finding | Production/executable resolution | Current evidence |
|---|---|---|
| F-01 | real integration/E2E/resource, three DB jobs, and Deno wrapper all fail closed with structured `not_run`/exit 2 | local gate invocation record in operations; no real pass claimed |
| F-02 | shared bounded provider reader + decoded-size preflight; OpenAI/Gemini and served resource cases | focused Integration Content-Length/missing/underreported/10MiB+1 Green; resource execution not_run |
| F-03 | strict commit/status parsers construct allowlist DTOs | malformed/extra enum/count/item/card/error/URL regressions Green |
| F-04 | malformed JSON=400, PreviewTokenError=401; MD-22 availability=503 unchanged | focused route regressions Green |
| F-05 | non-array/invalid cleanup claim RPC throws contract error | null/object/invalid-row regressions Green |
| F-06 | real SQL claim A→expiry→claim B; A finalize/fail/retry fenced, B succeeds with counts | real integration gate added; execution not_run |
| F-07 | served R1/W1 first-delete preserve, last-delete remove, owner-B denial | real E2E gate added; execution not_run |
| F-08 | real same-batch pair fail transaction + sibling success + exact status counts | real integration gate added; execution not_run |
| F-09 | pre-worker anon/owner-B live source denial and owner-B upload commit 409/CONFLICT | real E2E gate added; execution not_run |
| F-10 | independent bundle/WASM bytes+SHA-256 and manifest/package-lock identity | static manifest/typecheck Green; resource execution not_run |
| F-11 | strict queued/statusUrl, retry/batch/key snapshots, terminal equality, duplicate side-effect snapshot | real E2E gate added; execution not_run |
| F-12 | source 23:59:59 protected/24:00 eligible, referenced and owner/path mismatch protected | migration fence + real integration gate added; execution not_run |
| F-13 | configured provider control and complete runtime log collector; success/retry/permanent/cleanup scan | real E2E gate added; execution not_run |
| F-14 | SQL/shared/frontend strict safe status allowlist includes `DUPLICATE_EXISTING`; unknown/malformed rejected | focused strict DTO and unsafe-code regressions Green |
| F-15 | official endpoint default plus paired HTTPS override/binding propagated through worker adapter | Unit resolver and adapter header Green; configured served real E2E binding gate not_run |
| F-16 | terminal provider/Storage permanent and retry-exhausted results log exactly one safe `worker_failure` | focused Integration log-count regressions Green |
| F-17 | existing-object conflict read uses declared+streamed 10MiB reader and cancellation | declared/missing/underreported Content-Length regressions Green |
| F-18 | tracked managed path owner mutation denied; untracked legacy same-prefix and service lifecycle retained | static policy regression Green; DB smoke and owner-A/B/anon/service/source served gates not_run |
| P3-01 | terminal-failure logging is gated on `fail` success or `terminal_failed` reconciliation; all other paths emit only safe `worker_recoverable` | focused confirmed/uncommitted/ambiguous/retry-persistence regressions Green |
| P3-02 | illustration 64px minimum is input-only; normalized output and DB persistence allow each edge 1..1024 | portrait/landscape pure codec, worker, pinned ImageMagick, migration-contract regressions Green |
| Review F1 | entrypoint outer fault boundary emits `worker_recoverable`, never `worker_failure` | read/claim/ACK/WASM/config entrypoint-focused regressions Green |
| Review F2 | failed job persists terminal message/token; reconciliation requires both to match | local worker stale-A regression + static SQL contract Green; real DB gate added/not_run locally |
| Review F3 | real runtime gate invokes a separate same-origin served recoverable instance and correlates event counts | static gate contract Green; configured served execution not_run locally |
| Review-2 F1 | actual handler contains trimmed non-empty configured secret lookup and all setup faults; auth denial stays 401 | missing/blank/mismatch/match + secret-read/execute focused Green |
| Review-2 F2 | independent immutable control-plane attestations bind main/recoverable deployments to one expected SHA-256; validated probe UUID binds response/log | static fail-closed gate contract Green; served attestations/collector not_run locally |
| Review-2 F3 | malformed payload/job-missing ACK then emit one safe `worker_poison`, zero failure | focused poison ACK/count/forbidden-field Green |
| Review-2 F4 | strict duplicate DTO and claim-bound `terminal_duplicate` trigger immediate deletion only after durable orphan proof; failure remains cleanup-eligible | direct/response-loss × delete success/failure + no-premature-delete + Storage adjacent Green |
| Review-2 F5 | historical counts remain labeled; current inventory is Unit 23/Integration 127/E2E 10 | `test:s11:inventory` 160/160 Green |
| Cycle-4 F1 | terminal log classifier requires DB confirmation plus normal provider/Storage HTTP failure or provider/Storage retry exhaustion | configuration/decode/provider-contract/object-conflict zero-failure regressions; normal provider/Storage/exhaustion exactly-one preservation Green |
| Cycle-4 F2 | strict boolean `ack_inert_delivery` response gates queue-message-correlated poison event | malformed/missing-job false ACK poison-zero/recoverable plus RPC false rejection Green |
| Cycle-4 F3 | `cleanup_previous_state` preserves `delete_pending` across Storage retry and drives age-independent reclaim | static migration regression Green; real DB immediate retry/re-reference protection gate added/not_run locally |
| Cycle-4 F4 | cleanup actual handler lazily validates trimmed non-empty secret and creates dependencies inside safe boundary | missing/blank/header mismatch/match plus secret-read/setup matrix Green |

| Reviewer finding | Production evidence | Executable evidence |
|---|---|---|
| CR-01/HI-07 | migration owner grants and service-only status RPC | IT-01–03, DB contract smoke |
| CR-02/CR-03/MD-14 | concept failure/finalize transaction | CR-02 adapter safe-code matrix, IT-23, E2E-04/06 |
| CR-04/CR-05/HI-19 | terminal source cleanup, finalize reconciliation, durable orphan-before-compensation | CR-04/05 and HI-19 cleanup-convergence regressions, E2E-05/08 |
| CR-06 | SSR-cookie upload+AI route, token-scoped RPC/RLS, pgmq/provider/Edge codec/Storage/cleanup; directly served artifact+WASM failure resource enforcement | fail-closed `test:s11:real-integration`, `test:s11:real-e2e`, `test:s11:resource`, including exact denial contracts, decode-bomb/decode-failure 422, PID CPU/RSS/deadline, provider 10MiB/16MP + 110s abort |
| HI-08 | source sanitizer and pinned WASM codec | PNG/JPEG/WebP/truncated/EXIF and real WASM tests |
| HI-09/HI-10 | global cleanup candidates and per-path completion | cleanup boundary plus DB contract jobs |
| HI-11 | typed provider/Storage failures | network, 408/429/5xx, 4xx, malformed-response matrix |
| HI-12 | pre-constraint lifecycle backfill | populated upgrade fixture/job |
| HI-13 | runtime Vault invocation wrapper | inactive schedule DB smoke and operations gate |
| HI-20 | declared and streamed source limit in the Edge Storage adapter | fresh missing/declared and legacy lying Content-Length worker cases |
| NR-17/NR-18 | idempotent WASM initialization and all-terminal shared-source release | real WASM decode/re-encode and parallel/out-of-order consumer tests |
| MD-22 | commit route Queue/RPC infrastructure/availability mapping | focused integration: resolved RPC/PGRST and thrown transport failures=`503 SERVICE_UNAVAILABLE`; conflict/authorization/internal mappings preserved |
| R5-F1 | terminal/archive transaction + `ai_worker_log_outbox`; stable `eventId` dispatcher | Red 1/1 then Green; ambiguous response, unique outbox SQL, logger duplicate-ID suppression, real DB outbox claim/complete gate |
| R5-F2 | cleanup claim UUID in migration, adapter, runtime | Red 1/1 then Green; exact verify/complete signatures, stale `CLAIM_LOST`, delete_pending preservation and real DB stale-token gate |
| R5-F3 | source completion route + combined upload cleanup claim | Red 1/1 then Green; no fabricated source, source/raw independent first-run claim, real DB `source-and-raw-first-run` boundary |
| R6-F1 | common DB-clock active-claim fence + reconciles | Red 1/1 then Green; +299/+300 claim boundary, pre-reclaim expired mutation/reconcile rejection real gate |
| R6-F2 | durable exact source write intent before Storage | Red 1/1 then Green; route ordering, ready promotion, ambiguous write 404-safe cleanup real gate |
| R6-F3 | cleanup entity selection then path expansion | Red 1/1 then Green; `limit=1` returns a due source/raw pair in the same real DB run |
| R6-F4 | complete DB-clock lease recheck | Red 1/1 then Green; 4:59 verify and 6:00 completion `CLAIM_LOST` real gate |
| R6-F5 | atomic deleted illustration deactivation | Red 1/1 then Green; status/path transition and authenticated public-RPC reattach rejection real gate |
| R7-F1 | deleted illustration lifecycle trigger + attach invariant | focused Red/Green; owner REST-equivalent UPDATE, direct attach, service cleanup, legitimate owner update real DB gate |
| R7-F2 | concept claim signature and all business fences use DB clock | focused Red/Green; malicious caller time is unrepresentable and DB-controlled expiry fixtures cover active/reclaim |
| R7-F3 | cleanup claim/verify/complete use DB clock | focused Red/Green; exact age and stale lease fixtures mutate DB state rather than caller time |
| R7-F4 | source complete reads actual Storage `Response.body` with declared/stream byte limits | actual missing/underreported Content-Length streams cancel immediately on overflow; SDK Blob download absent from production path |
| R7-F5 | S-08 and S-11 call one shared prompt-safety policy | claim adapter regression proves control stripping, 100-character cap, and safety directive; duplicate SQL prompt absent |
| R7-F6 | outbox claim/reclaim/completion use DB clock | focused Red/Green; caller time absent, completion lease fenced, stable event ID/service ACL retained |
| R8-F1 | shared illustration removal/re-reference lifecycle | focused Red 1/1 then Green; atomic tracking metadata preserves 2→1 ready, S-10 third attach succeeds, last reference creates pending, actual two-session attach/cleanup gate fences both lock winners |
| R9-F1 | shared-card deadlock-free lifecycle serialization | focused Red 1/1 then Green; atomic reference count/backfill and canonical object locks remove sibling-card inversion; bounded two-session delete/delete and delete/attach gates assert final counts/states |
| R10-F1 | complete-vs-attach canonical lock order | focused Red then Green; existing cards→illustrations→tracking helper covers S-10/S-11 triggers, finalize/fail, cleanup verify/complete, and owner/service lifecycle; real two-session attach-first/complete-first gates require bounded timeouts, no `40P01`, one winner, and exact final state |
| R10-F2 | provider oversize cancellation/classification | focused Red then Green; shared OpenAI/Gemini bounded reader rejects declared oversize before reads, best-effort cancels, and preserves `IMAGE_TOO_LARGE` for missing/throwing/rejecting cancellation plus absent/understated Content-Length overflow without unsafe logs |
| R10-R1-F1 | S-10 different-key attach cross-swap inversion | focused Red 1/1 then Green; forward S-10 primitive override resolves OLD+NEW and locks both through the canonical helper before card mutation; bounded authenticated A-first/B-first cross-swaps require no `40P01` and exact swapped keys/counts/ready states |
| R10-R2-F1 | SECURITY DEFINER lifecycle caller authority | focused Red 1/1 then Green; guard trusts caller JWT service-role rather than function-owner `current_user`; real DB markers preserve owner resurrection rejection, service cleanup, untracked legacy update, and deleted attach denial |
| R10-R2-F2 | terminal outbox fault cannot suppress source release | focused Red 4/4 then Green across permanent/duplicate × claim/complete faults; durable failed outcome remains authoritative, unsafe fault details are not logged, source releases immediately, and stable event remains completable/reclaimable |
| R8-R1-F1 | disposable S-10 cluster-role immutability | focused Red then safety 17/17 Green; fail-closed role/membership prerequisites, mutation-free migration stream, real before/after catalog fingerprint equality on success/setup failure, source continuity, zero residue |
| R8-R1-F2 | authoritative sanitized teardown failure | focused drop-failure and residue-verification Red/Green; cleanup failure overrides simultaneous primary failure without URL/name disclosure, exact quality exit survives only verified cleanup |
| R8-R2-F1 | signal-safe authoritative teardown | focused signal rejection and residue-verification Red/Green; signal callback performs drop plus source/target/cluster verification, generic exit 1 wins on failure, verified cleanup preserves 130/143 |
| R8-R2-F2 | complete membership fingerprint | executable SQL contract and real local harness include `pg_auth_members.admin_option`, `inherit_option`, and `set_option` before/after all lifecycle paths |
| R12-F1 | source completion/cleanup serialization | exact-intent cleanup predicate plus two concurrent real PostgreSQL sessions preserve `ready` and return stale cleanup `P1008` |
| R12-F2 | malformed request/status boundary | actual prepare/complete/status handlers return 400 before RPC or Storage side effects |
| R12-F3 | bounded online migration | expand with lock/statement limits, compatibility trigger, SKIP LOCKED backfill, and separate constraint validation |
| R12-F4 | resource gate secret boundary | missing, blank, and mismatched configured/header secrets are rejected before resource work |
| R12-F5 | isolated quality databases | fresh/upgrade/failure use three distinct disposable targets with signal-safe teardown; local core results do not claim hosted schedule acceptance |
| R13-F1 | committed source-ready response loss | actual completion route + fresh PostgreSQL commit/reconcile returns 200, removes raw only, and retains the normalized ready source; malformed UUID is rejected before service access |
| R13-F2 | autocommit partial migration recovery | three injected boundaries leave the ledger empty and recover idempotently through backfill, validation, and one final ledger row |
| R13-F3 | partial-install function privilege safety | default PUBLIC execute is denied before the first core/schedule function and every interrupted SECURITY DEFINER surface remains non-public |
| R13-F4 | schedule Vault value validation | activation and invocation share canonical HTTPS project URL and nonblank secret validation in static and real local PostgreSQL gates |
| R13-F5 | run-scoped quality DB residue | strict names plus advisory leases remove inactive residue, retain active concurrent and malformed names, and fail closed on current-run residue |
| R14-F1 | canonical completion UUID | uppercase valid UUID is normalized once before DB/path/RPC/response use; unresolved lookup performs no mutation RPC or Storage side effect |
| R14-F2 | true statement-level autocommit recovery | `psql -f -` leaves and inspects each partial boundary in a new session, proves global default privilege safety, then converges through validate and one ledger row |
| R14-F3 | typed preview HMAC environment access | commit route has no direct environment read; typed helper trims values and missing/blank route calls fail safely before RPC |
| R15-F1 | atomic upload constraint replacement | one ALTER drops legacy/current names and adds S-11 NOT VALID checks; pre-swap interruption preserves both legacy checks in a new session before true-autocommit recovery |
| R15-F2 | readiness SSOT | v2.0.9/cycle 11 states hosted 7 not_run and merge blocked; local boundary E2E is complete while hosted full-system E2E remains incomplete |
| R16-F1 | committed diff whitespace gate | validated explicit ref/SHA or deterministic `origin/main` then `main` resolution produces a commit SHA; unresolved or unsafe input fails closed before `git diff --check <base>...HEAD`, with a separate worktree check |
| R16-F2 | uppercase UUID success boundary | actual prepared completion route canonicalizes once and uses lowercase UUID/path for query, write intent, Storage, ready reconciliation, raw cleanup, cleanup reconciliation, and response |
| R16-F3 | cycle-12 readiness SSOT | v2.0.10/cycle 12 retains hosted 7 not_run/exit 2 and merge blocked; prior R12 and cycle-8 approvals are explicitly historical |
| R17-F1 | strict diff-base identity | SHA-1 repository accepts only a full 40-hex commit ID as raw OID; symbolic/local/remote-tracking inputs must resolve to an existing full `refs/...` name, while abbreviated OIDs and revision expressions fail before resolution |
| R17-F2 | cycle-13 readiness SSOT | v2.0.11/cycle 13 retains hosted 7 not_run/exit 2 and merge blocked; all earlier review approvals remain historical |

## Change history

| Date | Version | Status | Changes |
|---|---|---|---|
| 2026-07-15 | 1.0.0 | implementation | Initial AC-to-code/test mapping |
| 2026-07-15 | 1.1.0 | quality_review | Reconciled current document versions and added CR-06, HI-19, HI-20, NR-17, and NR-18 executable evidence |
| 2026-07-15 | 1.1.1 | quality_review | Bound CR-06 evidence to real SSR cookies, direct local artifact/WASM serve, independent PID/resource measurement, and served provider maximum/timeout cases |
| 2026-07-15 | 1.1.2 | quality_review | Added exact failure HTTP contracts, decode-bomb/decode-failure CPU/RSS/deadline enforcement, and MD-22 commit 503 evidence |
| 2026-07-15 | 1.2.0 | quality_review | Mapped F-01〜F-13 to focused local evidence and fail-closed real/resource/DB/Deno gates without promoting not_run to pass |
| 2026-07-15 | 1.3.0 | quality_review | Mapped F-14〜F-18 to strict duplicate status, served endpoint binding, exact terminal logs, bounded conflict read, and tracked Storage mutation evidence |
| 2026-07-15 | 1.4.0 | quality_review | Mapped P3-01/P3-02 to DB-confirmed terminal logging, safe recoverable observability, and portrait/landscape extreme-aspect codec/worker/DB evidence |
| 2026-07-15 | 1.5.0 | quality_review | Mapped review attempt 1 F1〜F3 to entrypoint fault handling, terminal claim identity, and served recoverable runtime correlation |
| 2026-07-15 | 1.6.0 | quality_review | Mapped review attempt 2 F1〜F5 to actual handler, deployment attestations/correlation, poison logs, duplicate compensation, and current 23/127/10 inventory |
| 2026-07-15 | 1.7.0 | quality_review | Mapped fresh remediation cycle 4 F1〜F4 to strict failure taxonomy, confirmed poison ACK, durable delete_pending retry, cleanup auth, and current 23/139/10 inventory |
| 2026-07-15 | 1.8.0 | quality_review | Mapped review attempt 1 R5-F1〜F3 to durable log outbox, cleanup UUID fencing, source/raw first-run recovery, and current 23/142/10 inventory |
| 2026-07-15 | 1.9.0 | quality_review | Mapped review attempt 2 R6-F1〜F5 to DB-clock claims, source intent, entity cleanup, complete expiry, reattach rejection, and current 23/147/10 inventory |
| 2026-07-15 | 2.0.0 | quality_review | Mapped bounded cycle 5 R7-F1〜F6 and current 23/153/10 inventory; real/resource/DB/Deno remain fail-closed |
| 2026-07-15 | 2.0.1 | quality_review | Mapped cycle 5 review-attempt-1 R8-F1 and current 23/154/10 inventory; shared reference/S-10 attach/cleanup concurrency gate added |
| 2026-07-15 | 2.0.2 | quality_review | Mapped cycle 5 review-attempt-2 R9-F1 and current 23/155/10 inventory; reference metadata and deadlock gates added |
| 2026-07-16 | 2.0.3 | quality_review | Mapped bounded cycle 6 R10-F1/F2 and current 23/162/10 inventory; complete/attach concurrency and provider cancellation classification added |
| 2026-07-16 | 2.0.4 | quality_review | Mapped cycle 6 review-attempt-1 R10-R1-F1 and current 23/163/10 inventory; S-10 OLD+NEW attach override and cross-swap gates added |
| 2026-07-16 | 2.0.5 | quality_review | Mapped cycle 6 review-attempt-2 R10-R2-F1/F2 and current 23/168/10 inventory; JWT lifecycle authority and terminal outbox/source-release isolation added |
| 2026-07-16 | 2.0.6 | remediation | Mapped R12-F1–F5 and current 23/189/10 inventory; local DB/race evidence is separated from still-unrun hosted gates |
| 2026-07-16 | 2.0.7 | remediation | Mapped R13-F1–F5 and current 23/195/10 inventory; response-loss, autocommit, privilege, schedule, and residue evidence added while hosted gates remain not_run |
| 2026-07-16 | 2.0.8 | remediation | Mapped R14-F1–F3 and current 23/198/10 inventory; true autocommit, global default privilege, canonical UUID, and typed preview-secret evidence added |
| 2026-07-16 | 2.0.9 | remediation | Mapped R15-F1/F2 and current 23/200/10 inventory; atomic constraint swap and hosted merge-blocked readiness SSOT added |
| 2026-07-16 | 2.0.10 | implementation_review | Cycle 12 adds committed base...HEAD whitespace validation and uppercase prepared success-path boundary proof; hosted 7 remain not_run/exit 2 and merge blocked |
| 2026-07-16 | 2.0.11 | implementation_review | Cycle 13 restricts raw diff bases to full SHA-1 commits and ref inputs to existing refs; hosted 7 remain not_run/exit 2 and merge blocked |
