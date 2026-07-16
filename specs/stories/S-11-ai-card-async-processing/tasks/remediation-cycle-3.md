# Fresh remediation cycle 3 (new authorized cycle; attempt 1 of maximum 3)

- [x] P3-01 Red: focused DB-confirmed terminal vs recoverable/ambiguous worker logging tests fail for the intended reason
- [x] P3-01 Green: `worker_failure` is emitted exactly once only after DB-confirmed terminal failure; safe recoverable observability preserves retry/ACK/fencing
- [x] P3-02 Red: portrait and landscape valid extreme-aspect inputs expose the normalized short-edge rejection
- [x] P3-02 Green: actual codec/worker contract accepts aspect-preserving PNG output below 64px short edge while retaining input validation and output long-edge bounds
- [x] SSOT: requirements/ADR/design/plan/traceability/operations/meta synchronized with cycle 3 executable contracts
- [x] Verification: focused/local suites green and unavailable real/resource/DB/Deno gates remain honest `not_run`/exit 2

## Independent review attempt 1 findings

- [x] F1 Red: worker entrypoint read/claim/ACK/WASM/config faults expose invocation-level terminal logging
- [x] F1 Green: invocation-level faults emit only allowlisted `worker_recoverable`
- [x] F2 Red: delayed claim A can reconcile claim B's terminal failure as its own
- [x] F2 Green: persisted terminal message/token identity binds failure reconciliation and prevents duplicate terminal logs
- [x] F3 Red: configured runtime gate omits recoverable served evidence and terminal/recoverable counts
- [x] F3 Green: fail-closed real gate requires a separately served recoverable probe and exact event correlation/counts
- [x] Review-attempt-1 SSOT/meta synchronization
- [x] Review-attempt-1 full local verification and honest unavailable-gate results

## Independent review attempt 2 findings (final remediation before attempt 3/3)

- [x] F1 Red: actual handler exposes missing/blank secret and adjacent setup faults outside the safe boundary
- [x] F1 Green: trimmed non-empty worker secret validation and all setup faults are inside one safe recoverable boundary while auth denials remain 401
- [x] F2 Red: served recoverable evidence accepts unrelated logs and unverifiable deployment artifacts
- [x] F2 Green: immutable main/recoverable artifact digests and invocation correlation bind exactly one recoverable event and zero failures
- [x] F3 Red: malformed and missing-job poison deliveries ACK without safe observability
- [x] F3 Green: poison deliveries preserve ACK and emit exactly one safe correlated `worker_poison` event with zero terminal failures
- [x] F4 Red: post-upload duplicate finalization is collapsed to internal terminal failure and lacks immediate durable-orphan compensation
- [x] F4 Green: strict duplicate outcome, durable orphan confirmation, immediate best-effort deletion, response-loss reconciliation, and cleanup fallback are covered
- [x] F5 SSOT/meta: current versus historical inventory and review-attempt-2 executable contracts are synchronized
- [x] Review-attempt-2 full local verification and honest unavailable-gate results
