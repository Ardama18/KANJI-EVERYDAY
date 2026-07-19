import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "../supabase/migrations/20260719000001_s13_ai_card_management_undo.sql"),
	"utf8"
);

describe("S-13 forward migration contract", () => {
	it("wraps every schema and privilege change in one explicit transaction", () => {
		expect(migration.trimStart().indexOf("BEGIN;")).toBeLessThan(migration.indexOf("CREATE INDEX"));
		expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
	});
	it("uses a forward migration and the AI owner/private predicate", () => {
		expect(migration).toContain("ai_s13_assert_managed_card");
		expect(migration).toContain("items.status = 'finalized'");
		expect(migration).toContain("batches.source IN ('app_ai', 'remote_mcp')");
	});

	it("uses one packed-claims actor helper for every public management RPC", () => {
		expect(migration).toContain("CREATE OR REPLACE FUNCTION public.ai_s13_authenticated_actor()");
		expect(migration).toContain("current_setting('request.jwt.claims',true)");
		expect(migration).not.toContain("current_setting('request.jwt.claim.role'");
		expect(migration).not.toContain("current_setting('request.jwt.claim.sub'");
		expect(
			migration.match(/actor_id\s*:?=\s*public\.ai_s13_authenticated_actor\(\)/gu)
		).toHaveLength(9);
		expect(migration).toContain("REVOKE ALL ON FUNCTION public.ai_s13_authenticated_actor()");
		for (const signature of [
			"public.list_ai_managed_cards",
			"public.update_imported_card(uuid,jsonb,timestamptz)",
			"public.delete_private_card(uuid,timestamptz)",
			"public.set_card_decks(uuid,uuid[])",
			"public.set_card_tags(uuid,uuid[])",
			"public.set_card_tag_names(uuid,text[])",
			"public.set_card_illustration(uuid,uuid)",
			"public.bulk_delete_imported_cards(jsonb)",
			"public.undo_import(uuid)",
		]) {
			expect(migration).toContain(signature);
		}
	});

	it("rejects an explicit null list limit before executing the query", () => {
		expect(migration).toContain("IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100");
	});

	it("bulk validates and locks all cards before active and lifecycle checks", () => {
		const cardsLock = migration.indexOf("FOREACH target_id IN ARRAY target_ids LOOP");
		const active = migration.indexOf(
			"PERFORM public.ai_assert_card_inactive(target_id,p_owner_user_id)"
		);
		const lifecycle = migration.indexOf(
			"PERFORM public.ai_s11_lock_illustration_lifecycle(illustration_ids)",
			active
		);
		const deletion = migration.indexOf("DELETE FROM public.cards c WHERE c.id=ANY(target_ids)");
		expect(cardsLock).toBeGreaterThan(-1);
		expect(cardsLock).toBeLessThan(active);
		expect(active).toBeLessThan(lifecycle);
		expect(lifecycle).toBeLessThan(deletion);
	});

	it("keeps tombstone DELETE active and adds no review-state undo rejection", () => {
		expect(migration).not.toContain(
			"ai_enable_internal_context()\n  DELETE FROM public.cards c WHERE c.id=ANY(target_ids)"
		);
		const undoPrefix = migration.slice(
			migration.indexOf("CREATE FUNCTION public.undo_import_internal")
		);
		expect(undoPrefix).not.toContain("review_states");
		expect(undoPrefix).toContain("i.status='finalized'");
		expect(undoPrefix).toContain("i.user_edited_at IS NOT NULL");
		expect(undoPrefix).not.toContain("SET user_edited_at");
	});

	it("uses a deterministic lateral illustration selection so one card stays one row", () => {
		expect(migration).toContain("LEFT JOIN LATERAL");
		expect(migration).toContain("ORDER BY candidate.id");
		expect(migration).toContain("LIMIT 1");
	});

	it("uses cards -> lifecycle -> items for both undo and bulk delete", () => {
		const undo = migration.slice(migration.indexOf("CREATE FUNCTION public.undo_import_internal"));
		const lifecycle = undo.indexOf("ai_s11_lock_illustration_lifecycle");
		expect(undo.indexOf("FOR UPDATE;")).toBeLessThan(lifecycle);
		expect(lifecycle).toBeLessThan(undo.indexOf("ORDER BY i.id FOR UPDATE", lifecycle));
		expect(undo).toContain("locked_card_ids IS DISTINCT FROM candidate_card_ids");
	});

	it("rejects active S-11 jobs and terminalizes completed jobs during undo", () => {
		const undo = migration.slice(migration.indexOf("CREATE FUNCTION public.undo_import_internal"));
		const jobLock = undo.indexOf("FROM public.ai_import_concept_jobs AS jobs");
		const cardLock = undo.indexOf("FROM public.cards AS cards");
		const activeCheck = undo.indexOf("jobs.state IN ('queued','processing')");
		const itemUndo = undo.indexOf("SET status='undone',result_card_id=NULL");
		const jobUndo = undo.indexOf("SET state='undone',claim_token=NULL");
		expect(jobLock).toBeGreaterThan(-1);
		expect(jobLock).toBeLessThan(cardLock);
		expect(activeCheck).toBeGreaterThan(jobLock);
		expect(activeCheck).toBeLessThan(itemUndo);
		expect(jobUndo).toBeGreaterThan(itemUndo);
		expect(undo).toContain("jobs.state IN ('succeeded','failed')");
	});

	it("locks import items before deck and tag relation targets", () => {
		const decks = migration.slice(
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_decks_internal"),
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_tags_internal")
		);
		const tags = migration.slice(
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_tags_internal"),
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_tag_names_internal")
		);
		const tagNames = migration.slice(
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_tag_names_internal"),
			migration.indexOf("CREATE OR REPLACE FUNCTION public.set_card_tag_names(")
		);
		const targets = ["FROM public.decks d", "FROM public.tags t", "FOREACH tag_name"];
		for (const [index, body] of [decks, tags, tagNames].entries()) {
			const active = body.indexOf("ai_assert_card_inactive");
			const itemLock = body.indexOf("FROM public.ai_import_items i");
			const targetLock = body.indexOf(targets[index] ?? "unreachable");
			expect(active).toBeGreaterThan(-1);
			expect(active).toBeLessThan(itemLock);
			expect(itemLock).toBeLessThan(targetLock);
		}
	});

	it("does not grant internal helpers to application roles", () => {
		const revoke = migration.slice(
			migration.indexOf("REVOKE ALL ON FUNCTION public.ai_s13_authenticated_actor()"),
			migration.indexOf("FROM PUBLIC, anon, authenticated, service_role")
		);
		expect(revoke).toContain("public.ai_s13_assert_managed_card(uuid,uuid)");
		expect(revoke).toContain("public.undo_import_internal(uuid,uuid)");
		expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_ai_managed_cards");
	});
});
