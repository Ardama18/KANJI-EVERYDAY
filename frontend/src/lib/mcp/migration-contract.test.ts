import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
	process.cwd(),
	"../supabase/migrations/20260719000002_s14_remote_mcp_authenticated_wrappers.sql"
);
const runtimeConfigMigrationPath = resolve(
	process.cwd(),
	"../supabase/migrations/20260719000003_s14_remote_mcp_runtime_config.sql"
);
const remoteCommitClientRotationMigrationPath = resolve(
	process.cwd(),
	"../supabase/migrations/20260720000004_s14_remote_commit_allows_client_rotation.sql"
);
const s29SaferDeckDeleteMigrationPath = resolve(
	process.cwd(),
	"../supabase/migrations/20260801000000_s29_safer_deck_delete_with_sessions.sql"
);

async function readMigration(): Promise<string> {
	return await readFile(migrationPath, "utf8");
}

async function readRuntimeConfigMigration(): Promise<string> {
	return await readFile(runtimeConfigMigrationPath, "utf8");
}

async function readRemoteCommitClientRotationMigration(): Promise<string> {
	return await readFile(remoteCommitClientRotationMigrationPath, "utf8");
}

async function readS29SaferDeckDeleteMigration(): Promise<string> {
	return await readFile(s29SaferDeckDeleteMigrationPath, "utf8");
}

describe("S-14 remote MCP migration contract", () => {
	it("derives its authenticated actor from packed JWT claims without auth-table access", async () => {
		const sql = await readMigration();
		expect(sql).toContain("request.jwt.claims");
		expect(sql).toContain("claims ->> 'role' IS DISTINCT FROM 'authenticated'");
		expect(sql).toContain("claims ->> 'client_id' IS DISTINCT FROM p_expected_client_id");
		expect(sql).toContain("claims ->> 'session_id' IS DISTINCT FROM p_expected_session_id");
		expect(sql).not.toMatch(/\bauth\./u);
	});

	it("keeps remote import wrappers authenticated-only and internals unreachable", async () => {
		const sql = await readMigration();
		expect(sql).toContain("public.ai_s14_enqueue_import_internal");
		expect(sql).toContain("public.ai_s14_import_status_internal");
		expect(sql).toContain("public.s14_remote_commit_import");
		expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
		expect(sql).toContain("TO authenticated");
		expect(sql).not.toContain("TO service_role;");
	});

	it("pins definer functions and remote commit source before queue work", async () => {
		const sql = await readMigration();
		expect(sql).toContain("SET search_path = pg_catalog, pg_temp");
		expect(sql).toContain("OWNER TO s10_migration_owner");
		expect(sql).toContain("'remote_mcp'");
		expect(sql).toContain("public.reserve_provider_usage_internal(");
		expect(sql).toContain("public.ai_s14_enqueue_import_internal(");
		expect(sql.indexOf("WHERE batches.owner_user_id = actor_id")).toBeLessThan(
			sql.indexOf("public.reserve_provider_usage_internal(")
		);
	});

	it("requires the database-side preview HMAC boundary before remote commit side effects", async () => {
		const sql = await readMigration();
		expect(sql).toContain("current_setting('app.ai_preview_hmac_secret', true)");
		expect(sql).toContain("extensions.hmac(");
		expect(sql).toContain("kanji-everyday:remote-mcp:preview:v2");
		expect(sql).toContain("p_preview_token text");
		expect(sql).not.toContain("p_preview_secret");
	});

	it("supports Hosted Supabase preview HMAC config without ALTER ROLE custom GUC", async () => {
		const sql = await readRuntimeConfigMigration();
		expect(sql).toContain("s14_private.remote_mcp_runtime_config");
		expect(sql).toContain("public.s14_remote_preview_hmac_secret()");
		expect(sql).toContain("config.key = 'ai_preview_hmac_secret'");
		expect(sql).toContain("current_setting('app.ai_preview_hmac_secret', true)");
		expect(sql).toContain("REVOKE ALL ON TABLE s14_private.remote_mcp_runtime_config");
		expect(sql).toContain("OWNER TO s10_migration_owner");
		expect(sql).not.toMatch(/^\s*ALTER\s+ROLE\b/imu);
	});

	it("allows remote preview tokens to survive OAuth client rotation at commit", async () => {
		const sql = await readRemoteCommitClientRotationMigration();
		expect(sql).toContain("CREATE OR REPLACE FUNCTION public.s14_remote_commit_import");
		expect(sql).toContain("kanji-everyday:remote-mcp:preview:v2");
		expect(sql).toContain(
			"lower(preview_payload ->> 'userId') IS DISTINCT FROM lower(actor_id::text)"
		);
		expect(sql).not.toContain(
			"lower(preview_payload ->> 'clientId') IS DISTINCT FROM lower(p_client_id)"
		);
		expect(sql).toContain("p_generation_request_hash IS DISTINCT FROM expected_generation_hash");
		expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.s14_remote_commit_import");
	});

	it("keeps remote preview write-free while checking owner deck, upload, and existing-card boundaries", async () => {
		const sql = await readMigration();
		expect(sql).toContain("jsonb_array_length(p_items) NOT BETWEEN 1 AND 50");
		expect(sql).toContain("uploads.usage_scope = 'card_illustration'");
		expect(sql).toContain("'DUPLICATE_EXISTING'");
		expect(sql).toContain("-- Preview is intentionally write-free.");
	});

	it("provides one authenticated wrapper for an atomic composite card update", async () => {
		const sql = await readMigration();
		expect(sql).toContain("public.s14_remote_update_ai_card");
		expect(sql).toContain("public.update_imported_card_internal(");
		expect(sql).toContain("public.set_card_decks_internal(");
		expect(sql).toContain("public.set_card_tags_internal(");
		expect(sql).toContain("public.set_card_tag_names_internal(");
		expect(sql).toContain("public.set_card_illustration_internal(");
	});

	it("persists login continuation state server-side and consumes it exactly once", async () => {
		const sql = await readMigration();
		expect(sql).toContain("s14_private.oauth_consent_states");
		expect(sql).toContain("ALTER SCHEMA s14_private OWNER TO s10_migration_owner");
		expect(sql).toContain("public.s14_create_oauth_consent_state");
		expect(sql).toContain("public.s14_consume_oauth_consent_state");
		expect(sql).toContain("DELETE FROM s14_private.oauth_consent_states");
		expect(sql).toContain("TO anon, authenticated");
	});

	it("S-29: remote preview and deck patch internals reject tombstoned decks inside SECURITY DEFINER SQL", async () => {
		const sql = await readS29SaferDeckDeleteMigration();
		const normalized = sql.replace(/\s+/gu, " ").toLowerCase();

		expect(normalized).toContain(
			"create or replace function public.s14_remote_validate_import_preview"
		);
		expect(normalized).toContain("and decks.deleted_at is null");
		expect(normalized).toContain("create trigger s29_guard_deck_cards_active_deck");
		expect(normalized).toContain("before insert or update of deck_id on public.deck_cards");
		expect(normalized).toContain("public.ai_raise_import_error('deck_not_found')");
	});
});
