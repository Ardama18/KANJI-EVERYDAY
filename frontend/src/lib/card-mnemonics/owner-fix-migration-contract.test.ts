import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const OWNER_FIX_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260724000000_s16_card_mnemonics_owner_fix.sql"
);
const S16A_MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260721000001_s16_card_mnemonics.sql"
);

const readSql = (path: string): string => readFileSync(path, "utf8");
// -- 行コメントを除いた実行 SQL だけを対象にする（コメント中の語句を誤検知しない）
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");
const normalizeSql = (sql: string): string => stripComments(sql).replace(/\s+/g, " ").toLowerCase();

describe("issue #55 card_mnemonics owner-fix migration contract", () => {
	// 検証項目 1: 新 migration が owner を s10_migration_owner に変更する（受入 1/4）
	it("card_mnemonics の owner を s10_migration_owner に変更する", () => {
		const sql = normalizeSql(readSql(OWNER_FIX_MIGRATION_PATH));

		expect(sql).toContain("alter table public.card_mnemonics owner to s10_migration_owner");
	});

	// 検証項目 2: owner 変更のみで grant/RLS/trigger/制約を触らない（受入 3）
	it("owner 変更のみで grant/policy/trigger/table を再定義・削除しない", () => {
		const sql = normalizeSql(readSql(OWNER_FIX_MIGRATION_PATH));

		expect(sql).not.toContain("create policy");
		expect(sql).not.toContain("drop policy");
		expect(sql).not.toContain("create trigger");
		expect(sql).not.toContain("drop trigger");
		expect(sql).not.toContain("create table");
		expect(sql).not.toContain("drop table");
		expect(sql).not.toContain("revoke");
		expect(sql).not.toContain("grant");
		expect(sql).not.toContain("enable row level security");
		expect(sql).not.toContain("disable row level security");
		// 既存データを変換・削除しない
		expect(sql).not.toContain("update public.card_mnemonics");
		expect(sql).not.toContain("delete from public.card_mnemonics");
		expect(sql).not.toContain("truncate");
	});

	// 検証項目 3: card_mnemonics 以外のテーブルへ owner 変更を波及させない
	it("card_mnemonics 以外のテーブル owner を変更しない", () => {
		const sql = normalizeSql(readSql(OWNER_FIX_MIGRATION_PATH));

		const ownerAlters = sql.match(/alter table\s+\S+\s+owner to/g) ?? [];
		expect(ownerAlters).toEqual(["alter table public.card_mnemonics owner to"]);
	});
});

describe("issue #55 S-16A card_mnemonics 既存契約の回帰防止", () => {
	// 検証項目 4: S-16A の authenticated grant が維持される（受入 3, S-16F 表示読み取り）
	it("authenticated への SELECT/INSERT/UPDATE grant が維持される", () => {
		const sql = normalizeSql(readSql(S16A_MIGRATION_PATH));

		expect(sql).toContain(
			"grant select, insert, update on table public.card_mnemonics to authenticated"
		);
	});

	// 検証項目 5: S-16A の RLS policy が維持される（受入 3）
	it("RLS 有効化と owner スコープの select/insert/update policy が維持される", () => {
		const sql = normalizeSql(readSql(S16A_MIGRATION_PATH));

		expect(sql).toContain("alter table public.card_mnemonics enable row level security");
		expect(sql).toContain(
			"create policy card_mnemonics_select_owner on public.card_mnemonics for select using (auth.uid() = owner_user_id)"
		);
		expect(sql).toContain(
			"create policy card_mnemonics_insert_owner on public.card_mnemonics for insert with check (auth.uid() = owner_user_id)"
		);
		expect(sql).toContain(
			"create policy card_mnemonics_update_owner on public.card_mnemonics for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id)"
		);
	});
});
