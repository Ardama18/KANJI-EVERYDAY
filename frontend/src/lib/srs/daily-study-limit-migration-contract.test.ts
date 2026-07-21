import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260721000000_s17_daily_study_limit.sql"
);

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").toLowerCase();

describe("S-17 daily study limit migration contract", () => {
	it("decks.daily_study_limit を default 20 と 1〜100 CHECK 制約付きで追加する", () => {
		const sql = normalizeSql(readFileSync(MIGRATION_PATH, "utf8"));

		expect(sql).toContain(
			"alter table public.decks add column daily_study_limit integer not null default 20"
		);
		expect(sql).toContain("constraint decks_daily_study_limit_check");
		expect(sql).toContain("check (daily_study_limit between 1 and 100)");
	});

	it("review_states と study_sessions の既存行を更新・削除しない", () => {
		const sql = normalizeSql(readFileSync(MIGRATION_PATH, "utf8"));

		for (const tableName of ["review_states", "study_sessions"]) {
			expect(sql).not.toMatch(
				new RegExp(`\\b(update|delete from|truncate)\\s+(public\\.)?${tableName}\\b`)
			);
		}
	});
});
