// S-21 Phase 2: s14_remote_commit_import に p_mnemonics を足す migration の SQL 契約テスト。
// `migration-contract.test.ts` / `claim-mnemonic-slots-migration-contract.test.ts` と同じ
// 「migration SQL をテキストとして読んで断定する」方式（DB 適用は行わない）。
// 設計根拠: specs/stories/S-21-mcp-auto-mnemonic/design.md D5 / D8。

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(process.cwd(), "../supabase/migrations");
const S21_MIGRATION_FILE = "20260727000000_s21_remote_commit_mnemonics.sql";
const S14_MIGRATION_FILE = "20260720000004_s14_remote_commit_allows_client_rotation.sql";

const ARGS_8 = "(text,text,text,text,text,text,jsonb,text)";
const ARGS_9 = "(text,text,text,text,text,text,jsonb,text,jsonb)";

const readSql = (file: string): string => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
// -- 行コメントを除いた実行 SQL だけを対象にする（コメント中の語句を誤検知しない）
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");
const normalizeSql = (sql: string): string => stripComments(sql).replace(/\s+/g, " ").toLowerCase();

const s21Sql = readSql(S21_MIGRATION_FILE);
const normalized = normalizeSql(s21Sql);

describe("S-21 s14_remote_commit_import migration contract", () => {
	// 検証項目 1: 9 引数版が p_mnemonics jsonb DEFAULT NULL を持つ
	it("p_mnemonics jsonb DEFAULT NULL を持つ 9 引数版を定義する", () => {
		expect(normalized).toContain("create function public.s14_remote_commit_import(");
		expect(normalized).toContain("p_mnemonics jsonb default null )");
		expect(normalized).toContain(
			"returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp"
		);
		// 既存 8 引数を並び替えない（DEFAULT 付き引数は末尾のみ）
		expect(normalized).toContain(
			"p_client_id text, p_session_id text, p_idempotency_key text, " +
				"p_import_request_hash text, p_generation_request_hash text, p_preview_token text, " +
				"p_request jsonb, p_card_reservation_key text, p_mnemonics jsonb default null )"
		);
	});

	// 検証項目 2: DROP(8 引数) + CREATE(9 引数) と、同一ファイル内での owner / 権限再宣言
	it("8 引数版を DROP し、同一 migration 内で owner と権限を再宣言する", () => {
		expect(normalized).toContain(
			`drop function if exists public.s14_remote_commit_import${ARGS_8};`
		);
		expect(normalized).toContain(
			`alter function public.s14_remote_commit_import${ARGS_9} owner to s10_migration_owner;`
		);
		expect(normalized).toContain(
			`revoke all on function public.s14_remote_commit_import${ARGS_9} from public, anon, authenticated, service_role;`
		);
		expect(normalized).toContain(
			`grant execute on function public.s14_remote_commit_import${ARGS_9} to authenticated;`
		);
		// CREATE OR REPLACE は引数追加では置換にならず overload が残るため使わない
		expect(normalized).not.toContain("create or replace function public.s14_remote_commit_import");
		// DROP → CREATE → OWNER → REVOKE → GRANT の順
		const order = [
			"drop function if exists public.s14_remote_commit_import",
			"create function public.s14_remote_commit_import(",
			"alter function public.s14_remote_commit_import",
			"revoke all on function public.s14_remote_commit_import",
			"grant execute on function public.s14_remote_commit_import",
		].map((fragment) => normalized.indexOf(fragment));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order]).toEqual([...order].sort((left, right) => left - right));
	});

	// 検証項目 3: service_role には EXECUTE を与えない（S-14 の境界維持）
	it("service_role へ EXECUTE を与えない", () => {
		expect(normalized).not.toContain("to service_role");
		expect(normalized).not.toContain(
			"grant execute on function public.s14_remote_commit_import" + " to service_role"
		);
	});

	// 検証項目 4: card_mnemonics への owner スコープ upsert（status='approved'）
	it("card_mnemonics へ status='approved' で upsert する", () => {
		expect(normalized).toContain(
			"insert into public.card_mnemonics ( owner_user_id, illustration_key, slots, explanation, status ) " +
				"values ( actor_id, resolved_key, mnemonic_row.slots, mnemonic_row.explanation, 'approved' )"
		);
		expect(normalized).toContain(
			"on conflict (owner_user_id, illustration_key) do update set slots = excluded.slots, " +
				"explanation = excluded.explanation, status = 'approved', updated_at = now();"
		);
		expect(normalized).toContain("if jsonb_typeof(p_mnemonics) <> 'array' then");
		expect(normalized).toContain("if p_mnemonics is not null then");
	});

	// 検証項目 5: illustration_key は materialize 済み行から owner スコープで解決し、解決不能は CONTINUE
	it("illustration_key を owner スコープの job JOIN illustrations で解決し、解決不能は CONTINUE する", () => {
		expect(normalized).toContain("select ill.illustration_key into resolved_key");
		expect(normalized).toContain("from public.ai_import_concept_jobs as jobs");
		expect(normalized).toContain(
			"join public.illustrations as ill on ill.id = jobs.illustration_id"
		);
		expect(normalized).toContain("where jobs.batch_id = target_batch_id");
		expect(normalized).toContain("and jobs.owner_user_id = actor_id");
		expect(normalized).toContain("and jobs.concept_id = mnemonic_row.concept_id");
		expect(normalized).toContain("and ill.owner_user_id = actor_id");
		expect(normalized).toContain("if resolved_key is null then continue; end if;");
		// Next 側で illustration_key を組み立てないことの裏返し
		expect(normalized).not.toContain("'s11:'");
	});

	// 検証項目 6: owner は actor_id のみ。payload から owner を読まない
	it("owner に actor_id のみを使い p_mnemonics から owner を読まない", () => {
		expect(normalized).toContain(
			"actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);"
		);
		expect(normalized).not.toMatch(/->>\s*'owner/u);
		expect(normalized).not.toMatch(/->\s*'owner/u);
		expect(normalized).not.toContain("owner_user_id = mnemonic_row");
		// payload から読むキーは conceptId / slots / explanation の 3 つだけ
		const readKeys = [...normalized.matchAll(/entry\.value\s*->>?\s*'([a-z]+)'/gu)].map(
			(match) => match[1]
		);
		expect([...new Set(readKeys)].sort()).toEqual(["conceptid", "explanation", "slots"]);
	});

	// 検証項目 7: S-14 の検証順序と quota 契約を保持する（回帰防止）
	it("preview token 検証 / generation hash 検証 / units=0 の reservation を保持する", () => {
		expect(normalized).toContain("kanji-everyday:remote-mcp:preview:v2");
		expect(normalized).toContain("extensions.hmac(");
		expect(normalized).toContain(
			"lower(preview_payload ->> 'userid') is distinct from lower(actor_id::text)"
		);
		expect(normalized).toContain(
			"p_generation_request_hash is distinct from expected_generation_hash"
		);
		expect(normalized).toContain(
			"perform public.reserve_provider_usage_internal( actor_id, p_card_reservation_key, " +
				"'card_generation', 'remote_mcp', p_generation_request_hash, 0, null, null, null, " +
				"statement_timestamp() );"
		);
		const previewIndex = normalized.indexOf("kanji-everyday:remote-mcp:preview:v2");
		const hashIndex = normalized.indexOf("p_generation_request_hash is distinct from");
		const existingBatchIndex = normalized.indexOf(
			"where batches.owner_user_id = actor_id and batches.idempotency_key = p_idempotency_key"
		);
		const reservationIndex = normalized.indexOf("perform public.reserve_provider_usage_internal(");
		const mnemonicIndex = normalized.indexOf("insert into public.card_mnemonics");
		expect(previewIndex).toBeLessThan(hashIndex);
		expect(hashIndex).toBeLessThan(existingBatchIndex);
		expect(existingBatchIndex).toBeLessThan(reservationIndex);
		expect(reservationIndex).toBeLessThan(mnemonicIndex);
	});

	// 検証項目 8: 認証・検証部分を S-14 から一字一句持ち込む（本体の書き換え事故防止）
	it("actor 導出から generation hash 検証までを 20260720000004 から一字一句持ち込む", () => {
		const region = (sql: string): readonly string[] => {
			const lines = sql.split("\n");
			const start = lines.findIndex((line) =>
				line.startsWith("  actor_id := public.ai_s14_remote_mcp_actor(")
			);
			const end = lines.findIndex(
				(line, index) => index > start && line.startsWith("  IF EXISTS (")
			);
			expect(start).toBeGreaterThan(0);
			expect(end).toBeGreaterThan(start);
			return lines.slice(start, end);
		};
		expect(region(s21Sql)).toEqual(region(readSql(S14_MIGRATION_FILE)));
	});

	// 検証項目 9: timestamp prefix が既存 migration と衝突しない
	it("timestamp prefix 20260727000000 が既存 migration 内で一意である", () => {
		const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
		const prefix = S21_MIGRATION_FILE.slice(0, 14);
		expect(files).toContain(S21_MIGRATION_FILE);
		expect(files.filter((file) => file.startsWith(prefix))).toEqual([S21_MIGRATION_FILE]);
		expect(prefix > "20260726000000").toBe(true);
	});
});
