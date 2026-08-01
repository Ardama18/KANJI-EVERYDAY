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
const S29_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260801000000_s29_safer_deck_delete_with_sessions.sql"
);
const S02_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260223000000_s02_schema_rls.sql"
);
const DATABASE_TYPES_PATH = resolve(process.cwd(), "src/types/database.ts");
const DECK_ACTIONS_PATH = resolve(process.cwd(), "src/actions/deck-actions.ts");
const SESSION_ACTIONS_PATH = resolve(process.cwd(), "src/actions/session-actions.ts");

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").toLowerCase();

describe("S-29 safer deck logical delete migration contract", () => {
	it("adds a deleted_at tombstone column and active-deck owner query index", () => {
		const sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));
		const typesSource = readFileSync(DATABASE_TYPES_PATH, "utf8");

		expect(sql).toContain("alter table public.decks add column deleted_at timestamptz");
		expect(sql).toContain("where deleted_at is null");
		expect(typesSource).toContain("deleted_at: string | null");
		expect(typesSource).toContain("deleted_at?: string | null");
	});

	it("keeps physical DELETE closed and moves normal owner delete to the S-29 RPC", () => {
		const sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));
		const s29Sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));

		expect(sql).not.toContain("create policy decks_delete_owner");
		expect(sql).not.toContain("grant delete on table public.decks to authenticated");
		expect(sql).not.toMatch(/\bdelete\s+from\s+public\.decks\b/);
		expect(sql).toContain("drop policy if exists decks_update_owner on public.decks");
		expect(sql).toContain("for update");
		expect(sql).toContain("using ((select auth.uid()) = owner_user_id and deleted_at is null)");
		expect(sql).toContain("with check ((select auth.uid()) = owner_user_id)");
		expect(sql).toContain("grant update (deleted_at) on table public.decks to authenticated");
		expect(s29Sql).toContain("revoke update (deleted_at) on table public.decks from authenticated");
		expect(s29Sql).toContain(
			"grant update (finished_at, current_card_id, revealed) on table public.study_sessions to s10_migration_owner"
		);
		expect(s29Sql).toContain(
			"create or replace function public.delete_deck_with_closed_sessions(p_deck_id uuid)"
		);
		expect(s29Sql).toContain(
			"grant execute on function public.delete_deck_with_closed_sessions(uuid) to authenticated"
		);
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

	it("drops the S-25 unfinished-session reject trigger and adds atomic close/delete RPC", () => {
		const sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));

		expect(sql).toContain(
			"drop trigger if exists guard_deck_logical_delete_active_session on public.decks"
		);
		expect(sql).toContain(
			"drop function if exists public.guard_deck_logical_delete_active_session()"
		);
		expect(sql).not.toContain("create function public.guard_deck_logical_delete_active_session()");
		expect(sql).not.toContain("errcode = 'p1007'");
		expect(sql).toContain(
			"create or replace function public.delete_deck_with_closed_sessions(p_deck_id uuid)"
		);
		expect(sql).toContain("security definer");
		expect(sql).toContain("set search_path = pg_catalog, pg_temp");
		expect(sql).toContain("actor_id := auth.uid()");
		expect(sql).toContain("if p_deck_id is null");
		expect(sql).toContain("decks.id = p_deck_id");
		expect(sql).toContain("decks.owner_user_id = actor_id");
		expect(sql).toContain("decks.deleted_at is null");
		expect(sql).toContain("for update");
		expect(sql).toContain("update public.study_sessions as sessions");
		expect(sql).toContain("sessions.finished_at is null");
		expect(sql).toContain("current_card_id = null");
		expect(sql).toContain("revealed = false");
		expect(sql).toContain("perform public.ai_enable_internal_context()");
		expect(sql).toContain("update public.decks as decks set deleted_at = deleted_at_value");
		expect(sql).toContain("perform public.ai_disable_internal_context()");
		expect(sql).toContain("closedsessioncount");
		expect(sql).toContain(
			"alter function public.delete_deck_with_closed_sessions(uuid) owner to s10_migration_owner"
		);
		expect(sql).toContain(
			"revoke all on function public.delete_deck_with_closed_sessions(uuid) from public, anon, authenticated, service_role"
		);
	});

	it("rejects direct deleted_at updates so clients cannot bypass session closing", () => {
		const sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));
		const triggerStart = sql.indexOf(
			"create or replace function public.s29_guard_deck_deleted_at_internal_update"
		);
		const deleteRpcStart = sql.indexOf(
			"create or replace function public.delete_deck_with_closed_sessions"
		);

		expect(triggerStart).toBeGreaterThan(-1);
		expect(triggerStart).toBeLessThan(deleteRpcStart);
		expect(sql).toContain("new.deleted_at is distinct from old.deleted_at");
		expect(sql).toContain("not coalesce(public.ai_internal_context_active(), false)");
		expect(sql).toContain("s-29 direct deck delete is not allowed");
		expect(sql).toContain(
			"create trigger s29_guard_deck_deleted_at_internal_update before update of deleted_at on public.decks"
		);
		expect(sql).toContain(
			"revoke all on function public.s29_guard_deck_deleted_at_internal_update() from public, anon, authenticated, service_role"
		);
	});

	it("hides deck memberships for tombstoned decks while keeping related rows physically retained", () => {
		const baseSql = normalizeSql(readFileSync(S02_MIGRATION_PATH, "utf8"));
		const s25Sql = normalizeSql(readFileSync(S25_MIGRATION_PATH, "utf8"));
		const s29Sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));
		const s29DeckDeleteFlowSql = s29Sql.slice(
			0,
			s29Sql.indexOf("create or replace function public.s29_guard_deck_cards_active_deck")
		);

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
		expect(s29DeckDeleteFlowSql).not.toMatch(
			/\b(delete from|truncate)\s+(public\.)?(decks|deck_cards|study_sessions|cards|review_states)\b/
		);
		expect(s29DeckDeleteFlowSql).not.toMatch(
			/\b(alter table|drop table)\s+(public\.)?(deck_cards|study_sessions|cards|review_states)\b/
		);
	});

	it("pins Database function type and AI/MCP active deck boundaries", () => {
		const s29Sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));
		const typesSource = readFileSync(DATABASE_TYPES_PATH, "utf8");

		expect(typesSource).toContain("delete_deck_with_closed_sessions");
		expect(typesSource).toContain("Args: { p_deck_id: string }");
		expect(s29Sql).toContain("create trigger s29_guard_deck_cards_active_deck");
		expect(s29Sql).toContain("public.validate_ai_import_preview");
		expect(s29Sql).toContain("public.s14_remote_validate_import_preview");
		expect(s29Sql).toContain("public.list_ai_managed_cards");
		expect(s29Sql).toContain("and deleted_at is null");
		expect(s29Sql).toContain("and decks.deleted_at is null");
		expect(s29Sql).toContain("and d.deleted_at is null");
	});

	it("rejects tombstoned AI import commit deck targets before import batch creation", () => {
		const s29Sql = normalizeSql(readFileSync(S29_MIGRATION_PATH, "utf8"));
		const commitStart = s29Sql.indexOf("create or replace function public.commit_import_internal");
		const wrapperStart = s29Sql.indexOf(
			"create or replace function public.commit_generated_import_async"
		);
		const enforceStart = s29Sql.indexOf(
			"create or replace function public.enforce_import_batch_deck_owner"
		);
		const batchInsert = s29Sql.indexOf("insert into public.ai_import_batches", commitStart);

		expect(commitStart).toBeGreaterThan(-1);
		expect(wrapperStart).toBeGreaterThan(-1);
		expect(enforceStart).toBeGreaterThan(-1);
		expect(batchInsert).toBeGreaterThan(commitStart);

		const commitBeforeBatch = s29Sql.slice(commitStart, batchInsert);
		expect(commitBeforeBatch).toContain("prepared #>> '{deck,mode}' = 'id'");
		expect(commitBeforeBatch).toContain("where decks.id = (prepared #>> '{deck,id}')::uuid");
		expect(commitBeforeBatch).toContain("and decks.owner_user_id = p_actor_user_id");
		expect(commitBeforeBatch).toContain("and decks.deleted_at is null");
		expect(commitBeforeBatch).toContain("prepared #>> '{deck,mode}' = 'name'");
		expect(commitBeforeBatch).toContain("public.ai_normalize_key_text(decks.name)");
		expect(commitBeforeBatch).toContain("and decks.deleted_at is null");
		expect(commitBeforeBatch).toContain("public.ai_raise_import_error('deck_not_found')");
		expect(commitBeforeBatch).toContain("existing_batch.target_deck_id is not null");
		expect(commitBeforeBatch).toContain("existing_batch.auto_created_deck_id is not null");
		expect(commitBeforeBatch).toContain(
			"where decks.id = coalesce(existing_batch.target_deck_id, existing_batch.auto_created_deck_id)"
		);

		const setDecksStart = s29Sql.indexOf(
			"create or replace function public.set_card_decks_internal"
		);
		expect(setDecksStart).toBeGreaterThan(-1);
		expect(setDecksStart).toBeLessThan(enforceStart);
		const setDecksBody = s29Sql.slice(setDecksStart, enforceStart);
		const setDecksCurrentReturn = setDecksBody.indexOf(
			"if current_ids is not distinct from target_ids"
		);
		const setDecksTargetLock = setDecksBody.indexOf("from public.decks as target_decks");
		const setDecksTargetCount = setDecksBody.indexOf("select count(*) into locked_count");
		expect(setDecksTargetLock).toBeGreaterThan(-1);
		expect(setDecksTargetCount).toBeGreaterThan(setDecksTargetLock);
		expect(setDecksTargetCount).toBeLessThan(setDecksCurrentReturn);
		expect(setDecksBody).toContain("target_decks.deleted_at is null");
		expect(setDecksBody).toContain("d.deleted_at is null");
		expect(setDecksBody).toContain("public.ai_raise_import_error('deck_not_found')");

		const enforceBody = s29Sql.slice(enforceStart, commitStart);
		expect(enforceBody).toContain("new.target_deck_id is not null");
		expect(enforceBody).toContain("where decks.id = new.target_deck_id");
		expect(enforceBody).toContain("and decks.deleted_at is null");
		expect(enforceBody).toContain("new.auto_created_deck_id is not null");
		expect(enforceBody).toContain("where decks.id = new.auto_created_deck_id");
		expect(enforceBody).toContain("and decks.deleted_at is null");

		const wrapperReservationUpdate = s29Sql.indexOf(
			"update public.ai_quota_reservations set units=final_card_count",
			wrapperStart
		);
		const wrapperBeforeQuotaUpdate = s29Sql.slice(wrapperStart, wrapperReservationUpdate);
		expect(wrapperReservationUpdate).toBeGreaterThan(wrapperStart);
		expect(wrapperBeforeQuotaUpdate).toContain("prepared #>> '{deck,mode}' = 'id'");
		expect(wrapperBeforeQuotaUpdate).toContain("and decks.deleted_at is null");
		expect(wrapperBeforeQuotaUpdate).toContain("prepared #>> '{deck,mode}' = 'name'");
		expect(wrapperBeforeQuotaUpdate).toContain("public.ai_raise_import_error('deck_not_found')");
	});
});
