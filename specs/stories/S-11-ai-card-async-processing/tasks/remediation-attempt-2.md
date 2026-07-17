# Fresh remediation attempt 2 of maximum 3

- [x] F-14: `DUPLICATE_EXISTING` is accepted by the shared safe terminal status contract while malformed/unknown codes remain rejected
- [x] F-15: configured provider endpoint and binding are validated fail-closed and connected to the served worker; official provider endpoints remain the default
- [x] F-16: provider permanent, retry-exhausted, and Storage permanent terminal paths emit exactly one safe `worker_failure` log
- [x] F-17: existing-illustration conflict reads enforce the 10 MiB declared and streamed limits before materialization
- [x] F-18: S-11 managed illustration paths deny owner INSERT/UPDATE/DELETE while legacy owner paths and service-role lifecycle remain compatible
- [x] SSOT: requirements/ADR/design/plan/traceability/operations/meta synchronized with remediation attempt 2 contracts
- [x] Verification: S-11 inventory, S-10 regression, lint, typecheck, build, diff check, and fail-closed real/fresh/resource/Deno gates recorded truthfully
