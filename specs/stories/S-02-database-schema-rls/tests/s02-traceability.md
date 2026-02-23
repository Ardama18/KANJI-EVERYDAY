# S-02 Traceability Report

- Story: `S-02-database-schema-rls`
- Last Updated: 2026-02-23
- Requirements: `specs/stories/S-02-database-schema-rls/requirements.md`
- ADR: `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- Design: `specs/stories/S-02-database-schema-rls/design.md`

## AC/E2E Traceability Matrix

| ID | Requirement / Rule | Implementation Evidence | Integration Evidence | E2E Evidence | Status |
|---|---|---|---|---|---|
| AC-01 | 7テーブル契約（PK/FK/NOT NULL/DEFAULT/CHECK/INDEX） | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-01` | `database-schema-rls.e2e.test.ts` - `E2E-01` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-02 | `pgcrypto` 有効化 + `gen_random_uuid()` 利用可能 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-02` | `database-schema-rls.e2e.test.ts` - `E2E-01` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-03 | `users_profile` / `decks` / `illustrations` の `updated_at` 自動更新 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-03` | `database-schema-rls.e2e.test.ts` - `E2E-01` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-04 | 7/7テーブルでRLS有効 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-04` | `database-schema-rls.e2e.test.ts` - `E2E-01` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-05 | `cards public` は全員SELECT可/書き込み不可 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-05` | `database-schema-rls.e2e.test.ts` - `E2E-02` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-06 | `cards private` はownerのみ書き込み/削除可 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-06` | `database-schema-rls.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-07 | `illustrations` は private + owner scoped | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-07` | `database-schema-rls.e2e.test.ts` - `E2E-04` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-08 | `users_profile/decks/deck_cards/review_states/study_sessions` owner-only | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-08` | `database-schema-rls.e2e.test.ts` - `E2E-04` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-09 | 明示DELETE未定義操作は default deny | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-09` | `database-schema-rls.e2e.test.ts` - `E2E-03` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-10 | Storage `illustrations` private + owner scoped | `supabase/migrations/*_s02_storage_illustrations.sql` | `database-schema-rls.int.test.ts` - `AC-10` | `database-schema-rls.e2e.test.ts` - `E2E-04` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-11 | `illustrations.illustration_key` 非UNIQUE維持 | `supabase/migrations/*_s02_schema_rls.sql` | `database-schema-rls.int.test.ts` - `AC-11` | `database-schema-rls.e2e.test.ts` - `E2E-01` | Blocked (sandbox: DB connection to `127.0.0.1:54322` denied) |
| AC-12 | 型生成結果を `frontend/src/types/database.ts` に固定 | `frontend/src/types/database.ts` / `frontend/src/lib/supabase/{server,client}.ts` | `database-schema-rls.int.test.ts` - `AC-12` | `database-schema-rls.e2e.test.ts` - `E2E-05` | Partial (frontend checks passed, DB runtime checks blocked) |

## Final Run Log

| Command | Purpose | Result |
|---|---|---|
| `supabase db reset` | migration + seed reset | Blocked (`supabase: command not found`) |
| `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.e2e.test.ts` | E2E-01〜05検証 | Blocked (`npx` network denied). Fallback `frontend/node_modules/.bin/vitest --config /tmp/s02-vitest.config.mjs` executed; DB connection denied by sandbox |
| `npx vitest run specs/stories/S-02-database-schema-rls/tests/database-schema-rls.int.test.ts` | AC-01〜12回帰検証 | Blocked (`npx` network denied). Fallback `frontend/node_modules/.bin/vitest --config /tmp/s02-vitest.config.mjs` executed; DB connection denied by sandbox |
| `npm --prefix frontend run lint` | frontend lint | Passed |
| `npm --prefix frontend run typecheck` | frontend typecheck | Passed |
| `npm --prefix frontend run test` | frontend test | Passed |
| `/quality-fixer` | 最終品質ゲート | Blocked (`.claude/skills/quality-fixer/scripts/quality-check.sh` not found). Fallback `npm --prefix frontend run check` passed |

## Plan Rule Evidence

- Rule: 「統合テストは各Phase内で実行」  
  Evidence: `database-schema-rls.int.test.ts` のAC-01〜AC-12実装済み + 最終Phaseで全件再実行ログを残す。
- Rule: 「E2Eは最終Phaseでのみ実行」  
  Evidence: `database-schema-rls.e2e.test.ts` でScenario 1〜5を最終Phaseで実行し、最終ログに記録する。
