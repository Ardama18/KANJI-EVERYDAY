import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(process.cwd(), "../supabase/migrations");
const MIGRATION_FILE = "20260726000000_s20_ai_card_mnemonic_edit.sql";
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILE);
const S29_MIGRATION_PATH = resolve(
	MIGRATIONS_DIR,
	"20260801000000_s29_safer_deck_delete_with_sessions.sql"
);
const SIGNATURE =
	"public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)";

const migration = readFileSync(MIGRATION_PATH, "utf8");
const s29Migration = readFileSync(S29_MIGRATION_PATH, "utf8");
const normalizeSql = (sql: string): string => sql.replace(/\s+/gu, " ").toLowerCase();
const normalized = normalizeSql(migration);
const s29Normalized = normalizeSql(s29Migration);

describe("S-20 list_ai_managed_cards projection migration contract", () => {
	// 同一 prefix の migration は `supabase db push` に黙って読み飛ばされる
	it("owns its timestamp prefix and sorts after the S-16H migration it follows", () => {
		const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
		const prefix = MIGRATION_FILE.slice(0, 14);

		expect(files).toContain(MIGRATION_FILE);
		expect(files.filter((file) => file.startsWith(prefix))).toEqual([MIGRATION_FILE]);
		expect(prefix > "20260725000000").toBe(true);
	});

	// AC-9 の土台: 同一シグネチャの CREATE OR REPLACE のみで、DROP も新しい書き込み口も作らない
	it("replaces the RPC in place without dropping it or adding a write entry point", () => {
		expect(migration.trimStart().startsWith("--")).toBe(true);
		expect(migration).toContain("BEGIN;");
		expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);

		expect(normalized).toContain(
			normalizeSql(`CREATE OR REPLACE FUNCTION public.list_ai_managed_cards(
				p_limit integer DEFAULT 20,
				p_cursor_created_at timestamptz DEFAULT NULL,
				p_cursor_id uuid DEFAULT NULL,
				p_deck_id uuid DEFAULT NULL,
				p_tag_id uuid DEFAULT NULL,
				p_source text DEFAULT NULL,
				p_created_from timestamptz DEFAULT NULL,
				p_created_to timestamptz DEFAULT NULL
			) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp`)
		);
		expect(normalized).not.toContain("drop function");
		// ADR-013 decision 1: no new RPC and no new table-level grant for writing.
		expect(migration.match(/CREATE (OR REPLACE )?FUNCTION/gu)).toHaveLength(1);
		expect(normalized).not.toContain("grant select, insert, update on table");
		expect(normalized).not.toContain("create policy");
		expect(normalized).not.toContain("alter table");
	});

	// 射影の 3 点 (design §2.2 (a)(b)(c)) と owner 述語
	it("projects the illustration key, the owner-scoped mnemonic, and the shared card count", () => {
		expect(normalized).toContain("i.id as item_id, c.illustration_key");

		expect(normalized.match(/left join lateral/gu)).toHaveLength(3);
		expect(normalized).toContain("from public.card_mnemonics m where m.owner_user_id = actor_id");
		expect(normalized).toContain("and m.illustration_key = s.illustration_key");
		expect(normalized).toContain(
			"select count(*)::integer as shared_count from public.cards sibling where sibling.owner_user_id = actor_id"
		);
		expect(normalized).toContain("and s.illustration_key is not null");
		expect(normalized).toContain("and sibling.illustration_key = s.illustration_key");

		expect(normalized).toContain("'illustrationkey', e.illustration_key");
		expect(normalized).toContain("'mnemonic', e.mnemonic");
		expect(normalized).toContain("'mnemonicsharedcardcount', coalesce(e.shared_count, 0)");

		// 既存の illustration LATERAL と hasMore は変更しない
		expect(normalized).toContain("order by candidate.id limit 1");
		expect(normalized).toContain("'hasmore', (select count(*) > p_limit from selected)");
	});

	// AC-9: owner が s10_migration_owner のまま、authenticated の EXECUTE も維持される
	it("AC-9: re-issues the owner and the authenticated-only EXECUTE grant", () => {
		expect(normalized).toContain(
			normalizeSql(`ALTER FUNCTION ${SIGNATURE} OWNER TO s10_migration_owner;`)
		);
		expect(normalized).toContain(
			normalizeSql(
				`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC, anon, authenticated, service_role;`
			)
		);
		expect(normalized).toContain(
			normalizeSql(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO authenticated;`)
		);
		// REVOKE が GRANT より前でなければ authenticated の EXECUTE が消える
		expect(normalized.indexOf("revoke all on function")).toBeLessThan(
			normalized.indexOf("grant execute on function")
		);
		expect(normalized).not.toContain("to service_role;");
		expect(normalized).not.toContain("to anon;");
	});

	it("S-29: replacement keeps deleted decks out of list validation, filters, and enriched deck lists", () => {
		expect(s29Normalized).toContain("create or replace function public.list_ai_managed_cards");
		expect(s29Normalized).toContain("where d.id = p_deck_id");
		expect(s29Normalized).toContain("and d.owner_user_id = actor_id");
		expect(s29Normalized).toContain("and d.deleted_at is null");
		expect(s29Normalized).toContain("where dc.card_id = c.id");
		expect(s29Normalized).toContain("and dc.deck_id = p_deck_id");
		expect(s29Normalized).toContain("where dc.card_id = s.id");
		expect(s29Normalized).toContain("and d.deleted_at is null), '[]'::jsonb) as decks");
	});
});
