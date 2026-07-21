import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Database, Json } from "@/types/database";

const MIGRATION_PATH = resolve(
	process.cwd(),
	"../supabase/migrations/20260721000000_s16_card_mnemonics.sql"
);
const SEED_PATH = resolve(process.cwd(), "../supabase/seed.sql");

const readSql = (path: string): string => readFileSync(path, "utf8");
const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").toLowerCase();

describe("S-16A card_mnemonics migration contract", () => {
	// 検証項目 1: テーブル・全列・UNIQUE・CHECK 定義（AC-2/AC-3）
	it("テーブルと全列・UNIQUE・CHECK 制約を定義する", () => {
		const sql = normalizeSql(readSql(MIGRATION_PATH));

		expect(sql).toContain("create table public.card_mnemonics");
		expect(sql).toContain("id uuid primary key default gen_random_uuid()");
		expect(sql).toContain(
			"owner_user_id uuid not null references auth.users (id) on delete cascade"
		);
		expect(sql).toContain("illustration_key text not null");
		expect(sql).toContain("slots jsonb not null");
		expect(sql).toContain("explanation jsonb not null");
		expect(sql).toContain("status text not null default 'approved'");
		expect(sql).toContain("created_at timestamptz not null default now()");
		expect(sql).toContain("updated_at timestamptz not null default now()");

		expect(sql).toContain(
			"constraint card_mnemonics_owner_illustration_key_unique unique (owner_user_id, illustration_key)"
		);
		expect(sql).toContain(
			"constraint card_mnemonics_status_check check (status in ('draft', 'approved'))"
		);
	});

	// 検証項目 2: RLS 有効化と select/insert/update の owner ポリシー（AC-1）
	it("RLS を有効化し owner スコープの select/insert/update ポリシーを定義する", () => {
		const sql = normalizeSql(readSql(MIGRATION_PATH));

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

	// 検証項目 3: BEFORE UPDATE トリガーが update_updated_at_column を実行（AC-4）
	it("set_card_mnemonics_updated_at BEFORE UPDATE トリガーが既存関数を実行する", () => {
		const sql = normalizeSql(readSql(MIGRATION_PATH));

		expect(sql).toContain(
			"create trigger set_card_mnemonics_updated_at before update on public.card_mnemonics for each row execute function public.update_updated_at_column()"
		);
		// 既存関数を再定義しない
		expect(sql).not.toContain("create or replace function public.update_updated_at_column");
		expect(sql).not.toContain("create function public.update_updated_at_column");
	});

	// 検証項目 4: authenticated への SELECT/INSERT/UPDATE grant
	it("authenticated ロールへ SELECT/INSERT/UPDATE を grant する", () => {
		const sql = normalizeSql(readSql(MIGRATION_PATH));

		expect(sql).toContain(
			"grant select, insert, update on table public.card_mnemonics to authenticated"
		);
	});

	// 検証項目 5: 既存テーブルを変更しない
	it("card_mnemonics 以外のテーブルへ ALTER/UPDATE/DELETE/DROP しない", () => {
		const sql = normalizeSql(readSql(MIGRATION_PATH));

		const existingTables = [
			"users_profile",
			"decks",
			"cards",
			"deck_cards",
			"review_states",
			"study_sessions",
			"illustrations",
			"card_tags",
			"tags",
		];

		for (const table of existingTables) {
			expect(sql).not.toMatch(new RegExp(`\\balter table\\s+(public\\.)?${table}\\b`));
			expect(sql).not.toMatch(
				new RegExp(`\\b(update|delete from|truncate|drop table)\\s+(public\\.)?${table}\\b`)
			);
		}
	});

	// 検証項目 6: seed が「見」を status 'approved' で正本形の slots/explanation 付きで挿入（AC-5）
	it("seed が「見」の card_mnemonics を正本形で冪等 INSERT する", () => {
		const seed = readSql(SEED_PATH);

		expect(seed).toContain("INSERT INTO public.card_mnemonics");
		expect(seed).toContain("'00000000-0000-4000-8000-000000000001'::uuid");
		expect(seed).toContain(
			'\'{"kanji":"見","isSingleKanji":true,"shapeHint":{"part":"下の「見」","picture":"目"},"meaningHint":"見る・気づく","story":"目で見たものが頭の中で光って記憶に残る"}\'::jsonb'
		);
		expect(seed).toContain(
			'\'{"summary":"目で見たものが、頭の中で光って記憶に残る。","mappings":[{"part":"下の「見」","meaning":"目で見る"},{"part":"上の光","meaning":"頭の中で気づき、記憶する"},{"part":"目から光へ伸びる線","meaning":"見た情報が記憶になる"}]}\'::jsonb'
		);
		expect(seed).toContain("ON CONFLICT (owner_user_id, illustration_key) DO UPDATE");

		// status 'approved' が INSERT に含まれる
		const normalizedSeed = normalizeSql(seed);
		expect(normalizedSeed).toContain("insert into public.card_mnemonics");
		expect(normalizedSeed).toContain("'approved'");

		// seed は末尾 COMMIT の直前に置かれる
		const insertIndex = seed.indexOf("INSERT INTO public.card_mnemonics");
		const commitIndex = seed.lastIndexOf("COMMIT;");
		expect(insertIndex).toBeGreaterThan(-1);
		expect(commitIndex).toBeGreaterThan(insertIndex);
	});
});

// 検証項目 7: Database 型が期待する列型を持つ（型レベル assert、FR-5）
describe("S-16A card_mnemonics Database 型", () => {
	type Row = Database["public"]["Tables"]["card_mnemonics"]["Row"];
	type Insert = Database["public"]["Tables"]["card_mnemonics"]["Insert"];

	type Expect<T extends true> = T;
	type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

	// Row の各列型を型レベルで固定する
	type _RowSlots = Expect<Equals<Row["slots"], Json>>;
	type _RowExplanation = Expect<Equals<Row["explanation"], Json>>;
	type _RowStatus = Expect<Equals<Row["status"], string>>;
	type _RowId = Expect<Equals<Row["id"], string>>;
	type _RowIllustrationKey = Expect<Equals<Row["illustration_key"], string>>;
	type _RowOwner = Expect<Equals<Row["owner_user_id"], string>>;
	type _RowCreatedAt = Expect<Equals<Row["created_at"], string>>;
	type _RowUpdatedAt = Expect<Equals<Row["updated_at"], string>>;

	// Insert では生成列が optional
	type _InsertSlots = Expect<Equals<Insert["slots"], Json>>;
	type _InsertExplanation = Expect<Equals<Insert["explanation"], Json>>;

	it("Row が slots/explanation を Json、status を string で公開する（実行時参照で型検査を確定）", () => {
		const row: Row = {
			id: "00000000-0000-4000-8000-000000000009",
			owner_user_id: "00000000-0000-4000-8000-000000000001",
			illustration_key: "見",
			slots: { kanji: "見" },
			explanation: { summary: "s" },
			status: "approved",
			created_at: "2026-07-21T00:00:00Z",
			updated_at: "2026-07-21T00:00:00Z",
		};

		expect(row.status).toBe("approved");
		// 型 alias を利用側で参照して unused エラーを避けつつ型検査を強制する
		const assertions: [
			_RowSlots,
			_RowExplanation,
			_RowStatus,
			_RowId,
			_RowIllustrationKey,
			_RowOwner,
			_RowCreatedAt,
			_RowUpdatedAt,
			_InsertSlots,
			_InsertExplanation,
		] = [true, true, true, true, true, true, true, true, true, true];
		expect(assertions.every(Boolean)).toBe(true);
	});
});
