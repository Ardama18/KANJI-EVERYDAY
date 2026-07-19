# Changelog

All notable changes to this project are documented in this file.

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
