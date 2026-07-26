# Changelog

All notable changes to this project are documented in this file.

## [0.6.0.0] - 2026-07-26

### Added

- Added the Remote MCP `get_daily_study_status` tool so authorized TimeCoin clients can read only the signed-in user's JST daily study completion state.
- Added transport-independent daily study status aggregation with owner-scoped deck, deck-card, and review-state reads capped at one query each.
- Added S-22 story artifacts and focused unit, MCP contract, service, route, and real-database coverage for strict input, owner isolation, output shape, and safe error handling.

### Changed

- Updated MCP tool descriptors, server listings, and service mocks to include the tenth Remote MCP tool without changing existing tool contracts.
- Adjusted local quality gates so current S-11 evidence and post-S-10 seed data can be checked against the present schema.

### Verification

- Passed focused `get_daily_study_status` Vitest coverage against local Supabase: 5 files passed, 1 skipped, 56 tests passed, 18 skipped.
- Passed S-11 core-only real-database compatibility coverage: 1 file passed, 2 skipped, 256 tests passed, 22 skipped.
- Passed quality database unit and harness checks, release contract tests, full quality gate, build, ordinary Vitest, and `git diff --check`.

## [0.5.0.0] - 2026-07-21

### Added

- Added a deck-level daily study limit so each deck can cap the number of unique cards shown in a day.
- Added deck detail controls for editing the daily study limit, with owner-scoped validation and clear success or failure feedback.
- Added deck-wide study status on deck list and detail screens so future scheduled cards remain visible even when `New / Learn / Due` are all zero.

### Changed

- Changed study session creation to build queues within the remaining daily deck limit, preserving `Due -> Learn -> New` priority and keeping `new_limit_per_day` as the new-card-only cap.
- Changed deck detail behavior so the start action is disabled when today's remaining study slot is exhausted.

### Verification

- Passed S-17 focused Vitest coverage: 10 files, 82 tests.
- Passed full `npm run check` from `frontend/` with `S10_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`: 87 files passed, 1 skipped, 976 tests passed, 22 skipped.
- Passed `npm run build` from `frontend/` and `git diff --check`.

## [0.4.0.0] - 2026-07-20

### Added

- Added a first-use deck creation form on `/decks` so users with no decks can create their registration target before adding AI cards.
- Added the Remote MCP `create_deck` tool so ChatGPT and other external AI clients can create an owner-scoped deck before calling `preview_card_import` and `commit_card_import`.
- Added shared deck-name validation for UI and MCP deck creation, covering empty names, overlong names, and control or invisible control characters.

### Changed

- Updated the Remote MCP tool contract from eight tools to nine tools, preserving the existing AI card import, status, management, and undo flow.
- Updated the AI card import runbook with the first-user `list_decks` empty-state flow: `create_deck` → `preview_card_import` → `commit_card_import` → `get_import_status`.

### Verification

- Passed targeted S-16 Vitest coverage: 7 files, 39 tests.
- Passed `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, `git diff --check`, and confirmed `supabase/migrations/` has no changes.
- Confirmed `npm --prefix frontend run check` still requires existing `S10_TEST_DATABASE_URL` real-database configuration for unrelated S-10/S-13 DB suites; the S-16 targeted unit and contract gates passed.

## [0.3.0.0] - 2026-07-19

### Added

- Added an OAuth-protected Remote MCP endpoint so external AI clients can connect with user consent and operate only through an authenticated, owner-scoped card workflow.
- Added Japanese consent and connection-management screens for reviewing, approving, denying, and revoking external AI access.
- Added eight fixed MCP tools for deck listing, AI card preview/commit/status, AI card listing, editing, deletion, and import undo.
- Added S-14 Supabase forward migrations for authenticated Remote MCP wrappers, preview-token verification, private runtime config, and isolated real-database contract coverage.

### Changed

- Shared AI import and AI card management orchestration now runs through transport-independent application services used by both existing UI routes/actions and Remote MCP adapters.
- Hardened Supabase server-client construction so public auth routes and build-time rendering do not require server-only environment variables.

### Fixed

- Preserved existing app AI preview-token compatibility while adding Remote MCP preview tokens bound to the verified owner and OAuth client.
- Made MCP metadata and route handling fail closed when Remote MCP configuration is disabled or incomplete.
- Kept Vercel frontend deployment self-contained by removing runtime imports from repository paths outside the frontend package.

### Verification

- Passed `npm run lint`, `npm run typecheck`, and `npm run build` from `frontend/`.
- Passed `npm run check` from `frontend/` against disposable isolated DB `s14_gate_ship_*`: 83 files, 947 tests passed, 9 intentional skips.
- Confirmed linked Hosted Supabase staging migrations are up to date with `npx supabase db push --dry-run --linked`.
- Confirmed the current Vercel preview smoke for `/login`, MCP protected-resource metadata, unauthenticated MCP 401, GET 405, and invalid Origin 403. Claude and ChatGPT live-client gates remain separate release checks.

## [0.2.0.0] - 2026-07-19

### Added

- Guardians and teachers can now create private R1/W1 kanji cards from a text instruction or uploaded source image, review the generated drafts, and register the selected cards from the deck screen.
- Added editable generation previews, per-card exclusion, warning confirmation, partial-success reporting, and reload-safe import tracking so a failed card does not hide cards that were registered successfully.
- Added OpenAI generation, moderation, source-image lifecycle handling, strict output validation, and service-role-only commit paths that preserve owner isolation and the provider quota already consumed.

### Fixed

- Kept reading and writing edits paired when the AI draft list changes, so a preview never combines values from different cards.
- Allowed users to exclude generated cards before registration without invalidating the original generation quota reservation.
- Enlarged the deck return link to a keyboard- and touch-friendly target while preserving the existing layout.

### Verification

- Passed the complete local frontend gate: 58 test files, 794 passing tests, and 9 intentional skips, plus lint, type checking, and a production build.
- Added and passed 20 S-12 unit tests, 17 integration tests, 7 journey contracts, an isolated real-database gate, and browser checks for text, image, keyboard-only, exclusion, partial-success, and reload flows.
- Recorded S-11 Hosted7 and scheduled-cleanup acceptance from the candidate-bound release evidence; S-12 browser/HTTP/hosted-database E2E remains a separate gate.

## [0.1.0.0] - 2026-07-14

### Added

- Added the shared foundation for AI-created private R1/W1 cards, including strict request validation, Unicode normalization, owner-scoped duplicate detection, canonical request hashing, and expiring preview signatures.
- Added atomic database operations for quota reservation, import commit, upload registration, per-card finalization and failure handling, private card editing and deletion, tag/deck/illustration updates, and batch undo.
- Added owner-only RLS, direct-write restrictions, active-study protection, review-state reset rules, JST daily limits, idempotency controls, and stable public error codes for app and Remote MCP callers.
- Added generated Supabase types for the import tables and RPCs so later Queue, OpenAI UI, and Remote MCP stories can use one typed contract.

### Changed

- Changed card uniqueness from global uniqueness to public-card uniqueness plus owner-scoped private-card uniqueness, while preserving existing public seed cards and deck references.
- Updated session and illustration action boundaries so database contracts remain server-action compatible and imported cards follow the same study and illustration rules as existing cards.

### Fixed

- Prevented transaction-local import privileges from leaking after finalization, private cards from contaminating seed reruns, and TypeScript/PostgreSQL drift in UUID, Unicode, tag ordering, and canonical hash behavior.
- Hardened concurrent quota, finalize, undo, relation-edit, migration rollback, and lock-order behavior so retries do not double-consume limits or leave partial records.

### Verification

- Added 32 unit tests, 62 database integration contracts, and 13 end-to-end database workflow contracts, including isolated fresh-install, upgrade, and failure-injection jobs.
