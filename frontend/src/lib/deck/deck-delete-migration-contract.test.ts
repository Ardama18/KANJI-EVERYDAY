import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const S25_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260728000000_s25_deck_delete.sql"
);
const S25_SELECT_POLICY_FIX_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260729000000_s25_deck_delete_select_policy_fix.sql"
);
const S02_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260223000000_s02_schema_rls.sql"
);
const DATABASE_TYPES_PATH = resolve(process.cwd(), "src/types/database.ts");
const DECK_ACTIONS_PATH = resolve(process.cwd(), "src/actions/deck-actions.ts");
const SESSION_ACTIONS_PATH = resolve(process.cwd(), "src/actions/session-actions.ts");

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").toLowerCase();

describe("S-25 deck logical delete migration contract", () => {
	it("adds a deleted_at tombstone column and active-deck owner query index", () => {
		const sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));
		const typesSource = readFileSync(DATABASE_TYPES_PATH, "utf8");

		expect(sql).toContain("alter table public.decks add column deleted_at timestamptz");
		expect(sql).toContain("where deleted_at is null");
		expect(typesSource).toContain("deleted_at: string | null");
		expect(typesSource).toContain("deleted_at?: string | null");
	});

	it("keeps physical DELETE closed and allows only owner-scoped logical delete by UPDATE", () => {
		const sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));

		expect(sql).not.toContain("create policy decks_delete_owner");
		expect(sql).not.toContain("grant delete on table public.decks to authenticated");
		expect(sql).not.toMatch(/\bdelete\s+from\s+public\.decks\b/);
		expect(sql).toContain("drop policy if exists decks_update_owner on public.decks");
		expect(sql).toContain("for update");
		expect(sql).toContain("using ((select auth.uid()) = owner_user_id and deleted_at is null)");
		expect(sql).toContain("with check ((select auth.uid()) = owner_user_id)");
		expect(sql).toContain("grant update (deleted_at) on table public.decks to authenticated");
	});

	it("keeps owner SELECT broad enough for tombstone UPDATE while app reads filter active decks", () => {
		const fixSql = normalizeSql(readFileSync(S25_SELECT_POLICY_FIX_MIGRATION_PATH, "utf8"));
		const deckActionsSource = readFileSync(DECK_ACTIONS_PATH, "utf8");
		const sessionActionsSource = readFileSync(SESSION_ACTIONS_PATH, "utf8");

		expect(fixSql).toContain("drop policy if exists decks_select_owner on public.decks");
		expect(fixSql).toContain("create policy decks_select_owner on public.decks for select");
		expect(fixSql).toContain("using ((select auth.uid()) = owner_user_id)");
		expect(fixSql).not.toContain(
			"using ((select auth.uid()) = owner_user_id and deleted_at is null)"
		);
		expect(deckActionsSource).toContain('.is("deleted_at", null)');
		expect(sessionActionsSource).toContain('.is("deleted_at", null)');
	});

	it("guards logical deletion while an unfinished study session exists", () => {
		const sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));

		expect(sql).toContain("create function public.guard_deck_logical_delete_active_session()");
		expect(sql).toContain("security definer");
		expect(sql).toContain("set search_path = pg_catalog, pg_temp");
		expect(sql).toContain("old.deleted_at is null and new.deleted_at is not null");
		expect(sql).toContain("from public.study_sessions as sessions");
		expect(sql).toContain("sessions.deck_id = old.id");
		expect(sql).toContain("sessions.user_id = old.owner_user_id");
		expect(sql).toContain("sessions.finished_at is null");
		expect(sql).toContain("errcode = 'p1007'");
		expect(sql).toContain(
			"alter function public.guard_deck_logical_delete_active_session() owner to s10_migration_owner"
		);
		expect(sql).toContain(
			"revoke all on function public.guard_deck_logical_delete_active_session() from public, anon, authenticated, service_role"
		);
		expect(sql).toContain(
			"create trigger guard_deck_logical_delete_active_session before update of deleted_at on public.decks for each row execute function public.guard_deck_logical_delete_active_session()"
		);
	});

	it("hides deck memberships for tombstoned decks while keeping related rows physically retained", () => {
		const baseSql = normalizeSql(readFileSync(S02_MIGRATION_PATH, "utf8"));
		const s25Sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));

		expect(s25Sql).toContain(
			"drop policy if exists deck_cards_select_owner_deck on public.deck_cards"
		);
		expect(s25Sql).toContain(
			"drop policy if exists deck_cards_insert_owner_deck on public.deck_cards"
		);
		expect(s25Sql).toContain(
			"drop policy if exists deck_cards_update_owner_deck on public.deck_cards"
		);
		expect(s25Sql).toContain("decks.deleted_at is null");
		expect(baseSql).toContain(
			"deck_id uuid not null references public.decks (id) on delete cascade"
		);
		expect(s25Sql).not.toMatch(
			/\b(delete from|truncate)\s+(public\.)?(decks|deck_cards|study_sessions|cards|review_states)\b/
		);
		expect(s25Sql).not.toMatch(
			/\b(alter table|drop table)\s+(public\.)?(deck_cards|study_sessions|cards|review_states)\b/
		);
	});
});
